// The audit log, in English.
//
// AuditLog.actionType is a free-form string chosen at each of ~20 call sites,
// and `details` is an untyped Json blob whose shape only that call site knows.
// The old /gm/audit printed both raw, which is why nobody read it. This module
// is the one place that knows what each pairing MEANS.
//
// Two rules govern everything below:
//
//   1. A renderer returns SEGMENTS, not a string. A sentence naming a
//      character, a tag and a Resources amount wants CharacterLink, a .chip and
//      the ⬢ glyph inline; flattening it to text would throw all three away.
//      AuditFeed/AuditInspector own how a segment draws; this file owns what
//      the segments are.
//
//   2. An unregistered actionType MUST still render. Adding one at a call site
//      is a one-line change in a server action, and nobody is going to think of
//      this file — so the fallback prettifies the string and derives a family
//      from its prefix. Never blank, never a throw. That also covers the
//      genuinely dynamic ones (`move_${mode}` in the turns desk).
//
// No Prisma, no server imports: AuditFeed is a client component.

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const t = (v) => ({ k: "t", v });
const em = (v) => ({ k: "em", v });
const chip = (v) => (v ? { k: "chip", v: String(v) } : null);
const mono = (v) => (v ? { k: "mono", v: String(v) } : null);
const zone = (v) => (v ? { k: "zone", v: String(v) } : null);
const actor = () => ({ k: "actor" });
const target = () => ({ k: "target" });

// A Resources amount. Per CLAUDE.md the glyph REPLACES the word, so this is
// never written beside one.
const res = (n) => (Number.isFinite(Number(n)) ? { k: "res", v: Number(n) } : null);

// "×3", omitted entirely at 1 — a quantity of one is the default and saying so
// is noise on every single tag line.
const qty = (n) => (Number(n) > 1 ? { k: "qty", v: Number(n) } : null);

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

// `prefix` is what the fallback matches on, so the order here matters: the
// first prefix that matches wins, and "superadmin_" has to beat nothing while
// "request_" has to beat nothing either. They do not overlap today; keep it
// that way rather than adding precedence rules.
export const AUDIT_FAMILIES = {
  request: { label: "Request", prefixes: ["request_", "desire_"] },
  move: { label: "Move", prefixes: ["move_", "caving_roll"] },
  gm: { label: "GM action", prefixes: ["gm_"] },
  staging: { label: "Staging", prefixes: ["staged_", "staging_"] },
  faction: { label: "Faction", prefixes: ["faction_"] },
  lifeweb: { label: "Lifeweb", prefixes: [] },
  membership: { label: "Membership", prefixes: ["member_", "player_"] },
  system: { label: "System", prefixes: ["turn_"] },
  superadmin: { label: "Superadmin", prefixes: ["superadmin_"] },
};

export const AUDIT_FAMILY_KEYS = Object.keys(AUDIT_FAMILIES);

// The quick date ranges. Here rather than beside the WHERE that consumes them
// (web/lib/auditQuery.js) because the filter rail is a client component, and
// that module imports Prisma — one shared constant would otherwise drag the
// whole data layer into the browser bundle.
export const DATE_PRESETS = {
  today: "Today",
  "24h": "Last 24h",
  turn: "This turn",
  "7d": "Last 7 days",
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------
//
// `d` is entry.details ?? {}. Every accessor below has to survive a null,
// a missing key and an old row written before a key existed — this table is
// read against years of history, not against today's call sites.
//
// `tone` is the StatusPill vocabulary (good / warn / bad / muted / accent /
// neutral) and defaults to neutral. `bad` is reserved for the genuinely
// destructive; see DESTRUCTIVE below.

const R = {
  // ---- Requests (web/lib/requests.js#logRequest — these carry `reason`) ----
  request_add_tag: (d) => [actor(), t("added"), chip(d.tagName), qty(d.quantity), t("for"), res(d.resourcesSpent)],
  request_remove_tag: (d) => [actor(), t("dropped"), chip(d.tagName), qty(d.quantity), t("for"), res(d.resourcesSpent)],
  request_consume_tag: (d) => [
    actor(), t("consumed"), chip(d.tagName),
    ...(d.granted?.length ? [t("for"), ...joinChips(d.granted)] : []),
    ...(d.resourcesGranted ? [t("and"), res(d.resourcesGranted)] : []),
  ],
  request_buy_tags: (d) => [
    actor(), t("bought"), ...joinChips(d.tags ?? []),
    ...(d.totalPoints ? [t(`for ${d.totalPoints} point${d.totalPoints === 1 ? "" : "s"}`)] : []),
  ],
  request_heal_character: (d) => [actor(), t("healed"), target(), ...effectTail(d)],
  request_move_character: (d, e) => [actor(), t("moved to"), zone(name(e, d.toZoneId))],
  request_change_name: (d) => [actor(), t("renamed from"), em(d.previousName), t("to"), em(d.name)],
  request_loot_character: (d) => [actor(), t("looted"), target(), ...effectTail(d)],
  request_loot_resources: (d) => [actor(), t("looted"), res(d.amount ?? d.resources), t("from"), target()],
  request_transfer_resources: (d) => [actor(), t("sent"), res(d.amount ?? d.resources), t("to"), target()],
  request_loot_tag: (d) => [actor(), t("looted"), chip(d.tagName), qty(d.quantity), t("from"), em(d.fromName)],
  request_transfer_tag: (d) => [actor(), t("gave"), chip(d.tagName), qty(d.quantity), t("to"), em(d.toName)],
  request_fulfill_desire: (d) => [actor(), t("fulfilled a Desire for"), points(d.pointsAwarded)],
  request_donate_blood: (d) => [actor(), t("donated blood to the Lifeweb"), ...bloodTail(d)],
  request_feed_person: (d) => [actor(), t("fed a person to the Lifeweb"), ...bloodTail(d)],
  request_feed_person_killed: (d) => [t("The Lifeweb took"), em(d.targetName), t("— fed by"), actor()],
  desire_set: (d) => [actor(), t("set a Desire worth"), points(d.points), ...(d.text ? [t("—"), em(quote(d.text))] : [])],
  desire_cancelled: () => [actor(), t("cancelled their Desire")],

  // ---- Request review, from the adjudication desk ----
  request_reviewed: (d) => [actor(), t("reviewed a"), em(typeWords(d.type)), t("request")],
  request_edited: (d) => [actor(), t("edited a"), em(typeWords(d.type)), t("request")],
  request_undone: (d) => [actor(), t("UNDID a"), em(typeWords(d.type)), t("request")],

  // ---- Moves ----
  move_submitted: (d) => [actor(), t("submitted a Move"), ...(d.labor ? [t("—"), em(d.labor)] : [])],
  move_confirmed: (d) => [
    actor(), t("confirmed their Move"),
    ...(d.diceRoll != null ? [t("— rolled"), em(String(d.diceRoll)), ...(d.diceModifier ? [em(signed(d.diceModifier))] : [])] : []),
  ],
  move_rejected: (d) => [actor(), t("rejected a Move"), ...(d.description ? [t("—"), em(quote(d.description))] : [])],
  // The three `move_${mode}` modes the adjudication desk writes — see the
  // mode allowlist in (desk)/gm/turns/actions.js. Any mode added there without
  // a line here still renders through the `move_` prefix fallback.
  move_solve: () => [actor(), t("solved a Move for"), target()],
  move_unsolve: () => [actor(), t("reopened a Move for"), target()],
  move_save: () => [actor(), t("edited a Move for"), target()],
  caving_roll_resolved: (d) => [
    actor(), t("resolved a Caving roll"),
    ...(d.die != null ? [t("— rolled"), em(String(d.die))] : []),
    ...(d.kind ? [chip(titleCase(d.kind))] : []),
  ],

  // ---- GM actions ----
  gm_character_applied: () => [actor(), t("edited"), target(), t("from the dev panel")],
  // The kill nulls nothing, but a LATER delete leaves the row with no target
  // to link — details.name is the snapshot that keeps the line readable.
  gm_character_killed: (d, e) => [actor(), t("killed"), e.target ? target() : em(d.name)],
  gm_character_revived: () => [actor(), t("revived"), target()],
  gm_character_deleted: (d) => [actor(), t("DELETED the character"), em(d.name)],
  gm_character_discord_resync: () => [actor(), t("resynced"), target(), t("with Discord")],
  // No possessives anywhere in this table: .audit-line lays segments out with
  // a gap, so "X" + "'s turn" renders as "X 's turn".
  gm_turn_spent: (d) => [actor(), t("spent a turn for"), target(), ...(d.turn ? [t(`on turn ${d.turn}`)] : [])],
  gm_turn_restored: () => [actor(), t("restored a turn for"), target()],
  gm_dm_sent: (d) => [actor(), t("DM'd"), target(), ...lengthTail(d)],
  // A DM reply's target is a Discord user, and a bare snowflake in a sentence
  // is worse than a gap — the inspector links the id under Details.
  gm_dm_reply: (d, e) => [
    actor(), t("replied to"), e.target ? target() : em("a player"), ...msgTail(d.message),
  ],
  gm_message_sent: (d) => [actor(), t("messaged"), recipients(d.recipientCount ?? d.characterIds?.length), ...msgTail(d.message)],
  gm_message_delivered: () => [actor(), t("delivered a message to"), target()],
  gm_message_delivery_failed: () => [actor(), t("could NOT deliver a message to"), target()],
  gm_bulk_tag_grant: (d) => [actor(), t("granted"), chip(d.tagName), t("to"), recipients(d.applied ?? d.characterIds?.length), ...failedTail(d)],
  gm_bulk_tag_revoke: (d) => [actor(), t("revoked"), chip(d.tagName), t("from"), recipients(d.applied ?? d.characterIds?.length), ...failedTail(d)],
  gm_bulk_move: (d) => [actor(), t("moved"), recipients(d.characterIds?.length), t("to"), zone(d.zoneName)],
  gm_heal: (d) => [actor(), t("healed"), target(), ...(d.tagNames?.length ? [t("of"), ...joinChips(d.tagNames)] : [])],
  gm_custom_tag_created: (d) => [actor(), t("created the custom tag"), chip(d.name)],
  gm_custom_tag_updated: (d) => [actor(), t("edited the custom tag"), chip(d.name)],
  gm_custom_tag_deleted: (d) => [actor(), t("deleted the custom tag"), chip(d.name)],
  gm_desire_set: (d) => [actor(), t("set a Desire for"), target(), t("worth"), points(d.points)],
  gm_desire_fulfilled: (d) => [actor(), t("fulfilled a Desire for"), target(), t("worth"), points(d.points)],
  gm_desire_cancelled: () => [actor(), t("cancelled the Desire of"), target()],
  gm_donated_lifeweb_blood: (d) => [actor(), t("donated blood for"), target(), ...bloodTail(d)],
  gm_fed_lifeweb_person: (d) => [actor(), t("fed a person to the Lifeweb"), ...bloodTail(d)],

  // ---- Staging (the adjudication desk's drafts, pushed at turn end) ----
  staged_message_created: (d) => [actor(), t("staged a"), em(kindWord(d.kind)), t("message for"), recipients(d.recipients?.length ?? d.recipients)],
  staged_message_updated: () => [actor(), t("edited a staged message")],
  staged_message_deleted: (d) => [actor(), t("deleted a staged"), em(kindWord(d.kind)), t("message")],
  staged_message_resent: (d) => [actor(), t("resent"), count(d.resent), t("staged messages"), ...(d.stillFailing ? [t(`— ${d.stillFailing} still failing`)] : [])],
  staged_effects_created: (d) => [actor(), t("staged effects on"), recipients(d.targets?.length ?? d.targets)],
  staged_effect_updated: () => [actor(), t("edited a staged effect")],
  staged_effects_deleted: (d) => [actor(), t("deleted"), count(d.count), t("staged effects")],
  staged_push_resolved: () => [t("The turn's staged effects and messages were pushed")],
  staged_push_delivery_failed: () => [t("A staged message failed to deliver at push")],
  staging_retargeted: (d) => [
    actor(), t("moved"), count((d.effects ?? 0) + (d.messages ?? 0)), t("staged rows to turn"), em(String(d.toTurnNumber ?? "?")),
  ],

  // ---- Factions ----
  faction_leader_set: () => [actor(), t("made"), target(), t("faction Leader")],
  faction_treasurer_assigned: () => [actor(), t("made"), target(), t("faction Treasurer")],
  faction_treasurer_revoked: () => [actor(), t("removed"), target(), t("as faction Treasurer")],
  faction_member_added: (d, e) => [actor(), t("added"), target(), t("to"), chip(name(e, d.factionId))],
  faction_member_removed: () => [actor(), t("removed"), target(), t("from their faction")],
  faction_deleted: (d) => [actor(), t("DELETED the faction"), chip(d.name)],

  // ---- Membership ----
  character_created: (d) => [
    actor(), t("created"), target(),
    ...(d.role ? [t("—"), chip(d.role)] : []),
    ...(d.faction ? [t("of"), chip(d.faction)] : []),
    ...(d.zone ? [t("in"), zone(d.zone)] : []),
  ],
  member_joined: (d) => [em(d.username ?? "Someone"), t("joined the guild")],
  member_left: (d) => [em(d.username ?? "Someone"), t("left the guild"), ...(d.characterName ? [t("—"), em(d.characterName)] : [])],
  player_topic_created: () => [actor(), t("opened a public topic")],
  player_thread_created: () => [actor(), t("opened a private thread")],
  thread_persistence_changed: () => [actor(), t("changed a thread's persistence")],

  // ---- System (actor is "system") ----
  turn_advanced: (d) => [
    t("Turn"), em(String(d.number ?? "?")), t("opened —"), em(titleCase(d.phase)),
    ...(d.weather ? [t("·"), em(titleCase(d.weather))] : []),
  ],
  turn_resume: () => [t("A half-finished turn advance was resumed")],
  turn_pass_failed: (d) => [t("A turn pass FAILED"), ...(d.pass ? [t("—"), em(d.pass)] : [])],
  hunger_resolved: () => [t("Hunger was charged for the turn")],
  default_moves_resolved: () => [t("Default Moves were filed for everyone who did not act")],
  catatonic_resolved: () => [t("Catatonic characters were resolved for the turn")],
  caving_resolved: () => [t("The Caving Die was rolled for everyone in the Depths")],
  tag_expiry_resolved: () => [t("Expiring tags were retired for the turn")],
  access_revoke_incomplete: () => [t("A channel access revoke did not complete")],

  // ---- Superadmin ----
  superadmin_turn_forced: (d) => [actor(), t("FORCED turn"), em(String(d.number ?? "?")), t("open")],
  superadmin_game_wipe: (d) => [actor(), t("started a GAME WIPE —"), count(d.characters), t("characters")],
  superadmin_game_wipe_finished: () => [actor(), t("finished the GAME WIPE")],
  superadmin_gm_zones_assigned: (d) => [
    actor(), t("seated a GM in"),
    ...(d.zoneNames?.length ? joinZones(d.zoneNames) : [t("no zone")]),
  ],
  // The single-zone predecessor, kept so the years of rows already written
  // under it still read.
  superadmin_gm_zone_assigned: (d, e) => [
    actor(), t("seated a GM in"), zone(name(e, d.zoneId)) ?? em("no zone"),
  ],
};

// A Move's review status is set from a `move_${mode}` template, so the modes
// beyond the two spelled out above arrive here as strings this file never saw.
// The fallback handles them; these are only the ones worth phrasing.

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

// Rows a GM scanning for "what went wrong" needs to find. Everything else is
// routine, and marking routine work as alarming would defeat the point.
const DESTRUCTIVE = new Set([
  "gm_character_deleted",
  "gm_character_killed",
  "faction_deleted",
  "gm_custom_tag_deleted",
  "gm_bulk_tag_revoke",
  "superadmin_game_wipe",
  "superadmin_game_wipe_finished",
  "superadmin_turn_forced",
  "request_undone",
  "request_feed_person_killed",
  "move_rejected",
  "staged_message_deleted",
  "staged_effects_deleted",
  "member_left",
]);

// Something did not work. Distinct from destructive: nobody chose it.
const WARNING = new Set([
  "gm_message_delivery_failed",
  "staged_push_delivery_failed",
  "turn_pass_failed",
  "access_revoke_incomplete",
]);

export function auditTone(actionType) {
  if (DESTRUCTIVE.has(actionType)) return "bad";
  if (WARNING.has(actionType)) return "warn";
  if (actionType?.startsWith("superadmin_")) return "accent";
  return "neutral";
}

export function isDestructive(actionType) {
  return DESTRUCTIVE.has(actionType) || WARNING.has(actionType);
}

// ---------------------------------------------------------------------------
// Families, including for types this file has never heard of
// ---------------------------------------------------------------------------

// Explicit overrides for the handful whose name does not carry their family.
const FAMILY_OVERRIDES = {
  request_donate_blood: "lifeweb",
  request_feed_person: "lifeweb",
  request_feed_person_killed: "lifeweb",
  gm_donated_lifeweb_blood: "lifeweb",
  gm_fed_lifeweb_person: "lifeweb",
  character_created: "membership",
  thread_persistence_changed: "membership",
  hunger_resolved: "system",
  default_moves_resolved: "system",
  catatonic_resolved: "system",
  caving_resolved: "system",
  tag_expiry_resolved: "system",
  access_revoke_incomplete: "system",
};

export function auditFamily(actionType) {
  if (!actionType) return "system";
  if (FAMILY_OVERRIDES[actionType]) return FAMILY_OVERRIDES[actionType];
  for (const [key, fam] of Object.entries(AUDIT_FAMILIES)) {
    if (fam.prefixes.some((p) => actionType.startsWith(p))) return key;
  }
  return "system";
}

// The known action types per family, for the filter's WHERE clause. Anything
// unknown is caught by the prefix branch beside it — see buildAuditWhere.
export function knownTypesInFamily(family) {
  return Object.keys(R).filter((k) => auditFamily(k) === family);
}

export function familyPrefixes(family) {
  return AUDIT_FAMILIES[family]?.prefixes ?? [];
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

// `entry` is the flat DTO built in the audit page — see that file. It carries
// `names`, a plain id -> name object covering tags, factions and zones, so a
// renderer can turn a bare id in `details` into a word.
export function describeAudit(entry) {
  const type = entry?.actionType ?? "";
  const details = entry?.details && typeof entry.details === "object" ? entry.details : {};
  const render = R[type];

  let segments;
  if (render) {
    try {
      segments = render(details, entry);
    } catch {
      // A row written years ago under a different payload shape must not take
      // the page down with it. Fall through to the prettified name.
      segments = null;
    }
  }
  if (!segments) segments = fallback(type, entry);

  return {
    family: auditFamily(type),
    familyLabel: AUDIT_FAMILIES[auditFamily(type)].label,
    tone: auditTone(type),
    segments: segments.filter(Boolean),
  };
}

// "request_add_tag" -> "Request add tag". Deliberately plain: it should read
// as an unregistered type rather than pass for a real sentence.
export function prettifyActionType(actionType) {
  if (!actionType) return "Unknown action";
  const words = actionType.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function fallback(type, entry) {
  const head = [actor(), t("—"), em(prettifyActionType(type))];
  // Naming the target still tells a GM who a strange row is about, which is
  // most of what they came for.
  return entry?.target ? [...head, t("on"), target()] : head;
}

// ---------------------------------------------------------------------------
// Small shared shapes
// ---------------------------------------------------------------------------

function joinChips(list) {
  const out = [];
  list.forEach((v, i) => {
    if (i > 0) out.push(t(i === list.length - 1 ? "and" : ","));
    out.push(chip(v));
  });
  return out;
}

function joinZones(list) {
  const out = [];
  list.forEach((v, i) => {
    if (i > 0) out.push(t(i === list.length - 1 ? "and" : ","));
    out.push(zone(v));
  });
  return out;
}

// Request effects are a free-form delta object; surface the two keys that
// appear across all of them and leave the rest to the inspector.
function effectTail(d) {
  const bits = [];
  if (Number.isFinite(Number(d.resources))) bits.push(t("—"), res(d.resources));
  if (d.tagNames?.length) bits.push(t("—"), ...joinChips(d.tagNames));
  return bits;
}

function bloodTail(d) {
  const delta = d.bloodDelta ?? d.amount;
  return Number.isFinite(Number(delta)) ? [t("—"), em(`${signed(delta)} Blood`)] : [];
}

function msgTail(message) {
  if (!message) return [];
  return [t("—"), em(quote(truncate(message, 90)))];
}

function lengthTail(d) {
  return Number.isFinite(Number(d.length)) ? [t(`— ${d.length} characters`)] : [];
}

function failedTail(d) {
  return d.failed?.length ? [t(`— ${d.failed.length} failed`)] : [];
}

function recipients(n) {
  const count = Number(n);
  if (!Number.isFinite(count)) return t("several characters");
  return em(`${count} character${count === 1 ? "" : "s"}`);
}

function count(n) {
  return em(String(Number.isFinite(Number(n)) ? n : "?"));
}

function points(n) {
  const v = Number(n);
  return em(Number.isFinite(v) ? `${v} point${v === 1 ? "" : "s"}` : "points");
}

// A bare id out of `details` turned into its name, using the lookup the page
// built. Falls back to nothing rather than to a cuid — a raw id in a sentence
// is worse than a gap, and the inspector shows it anyway.
function name(entry, id) {
  if (!id) return null;
  return entry?.names?.[id] ?? null;
}

function kindWord(kind) {
  return kind === "PUBLIC" ? "public" : "private";
}

function typeWords(type) {
  return type ? String(type).replace(/_/g, " ").toLowerCase() : "";
}

function titleCase(v) {
  if (!v) return "";
  return String(v)
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function signed(n) {
  const v = Number(n);
  return v > 0 ? `+${v}` : String(v);
}

function quote(v) {
  return `“${String(v).trim()}”`;
}

function truncate(v, max) {
  const s = String(v).trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
