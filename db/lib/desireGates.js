// Pure Desire-catalog gate evaluator. NO prisma import, NOT in the
// @lifeweb/db barrel — a client component will want this deep-path, same
// reason web/lib/characterCreation.js deep-imports db/lib/roleCapacity.js
// rather than pulling the whole package. Callers (server actions, the dev
// panel, character/page.js) load rows with prisma and pass plain objects.
//
// Input shapes:
//   templates: [{ id, slug, name, tier, families, onceEver, cooldownTurns,
//                 retired,
//                 requiresAnyTags: [{ id, name }],   // OR-of; empty/absent = no constraint
//                 requiresNotTags: [{ id, name }],   // NONE-of
//                 requiresAnyRoles: [{ slug, name }],
//                 requiresNotRoles: [{ slug, name }] }]
//     (Tags/roles carry a name alongside id/slug so a locked reason can
//     name them — "Requires the Dancer tag" — without this pure module
//     ever touching the DB itself.)
//   heldTags:  [{ id, slug, name, desireLocks }]   // desireLocks is the
//              shape normalized by db/lib/desireShapes.js: an array of
//              clauses, each { all } | { families } | { tiers, exceptFamilies? }
//   hiddenTagIds: Set<tagId>  // tag ids that gate a hidden category —
//              computed by the caller from TagGroup.requiredTagId gating.
//              This module has no DB, so it cannot compute this itself.
//   history:   the character's Desire rows: [{ id, templateId, slotIndex,
//               status, endedTurnNumber }]  (status: ACTIVE|FULFILLED|CANCELLED)
//   roleSlug:  the character's current Role.slug, or null
//   openTurnNumber: the currently open Turn.number
//
// Evaluation order (first match wins), exactly:
//   1. hidden   — fails a requires.anyTags gate whose gating tag id is in
//                 hiddenTagIds. WITHHELD from the returned payload entirely
//                 (see below) — never rendered dimmed. Getting this wrong
//                 leaks a hidden roster (Demoness, Bacchus).
//   2. locked   — fails an ungated requires clause, or caught by a held
//                 tag's desireLocks union. Reason is a short human string;
//                 for a requires-gated entry the reason must NEVER name a
//                 hidden tag (that IS the oracle the hidden rule forbids).
//   3. spent    — onceEver and a FULFILLED row already exists for this
//                 templateId, regardless of cooldown.
//   4. cooldown — a FULFILLED row exists and
//                 openTurnNumber < endedTurnNumber + (cooldownTurns ?? tier).
//                 Exactly at the boundary is AVAILABLE, not cooldown.
//   5. active   — an ACTIVE row already occupies a slot with this templateId.
//   6. available.
//
// evaluateDesireCatalog returns { visible, hidden } — `visible` is the
// array callers should ever pay out to a UI payload (one entry per
// non-hidden template: { template, state, reason, availableFromTurn }),
// `hidden` is the parallel bookkeeping (template ids only) for callers that
// need to know withholding happened without ever handing the shape back out.
function evaluateDesireCatalog({ templates, heldTags, hiddenTagIds, roleSlug, history, openTurnNumber }) {
  const heldTagIds = new Set((heldTags || []).map((t) => t.id));
  const hidden_ = hiddenTagIds instanceof Set ? hiddenTagIds : new Set(hiddenTagIds || []);
  const lockClauses = unionLockClauses(heldTags || []);
  const hist = history || [];

  const visible = [];
  const hidden = [];

  for (const template of templates || []) {
    if (template.retired) continue;

    const requiresResult = evalRequires(template, { heldTagIds, roleSlug, hiddenTagIds: hidden_ });

    if (requiresResult.hidden) {
      hidden.push(template.id);
      continue;
    }

    if (!requiresResult.ok) {
      visible.push({ template, state: "locked", reason: requiresResult.reason, availableFromTurn: null });
      continue;
    }

    const lockReason = lockedReasonForTemplate(template, lockClauses);
    if (lockReason) {
      visible.push({ template, state: "locked", reason: lockReason, availableFromTurn: null });
      continue;
    }

    const templateHistory = hist.filter((h) => h.templateId === template.id);
    const fulfilledRows = templateHistory.filter((h) => h.status === "FULFILLED");

    if (template.onceEver && fulfilledRows.length > 0) {
      visible.push({ template, state: "spent", reason: null, availableFromTurn: null });
      continue;
    }

    if (fulfilledRows.length > 0) {
      const lastFulfilled = fulfilledRows.reduce((latest, row) =>
        (row.endedTurnNumber ?? -Infinity) > (latest.endedTurnNumber ?? -Infinity) ? row : latest
      );
      const cooldownLength = template.cooldownTurns ?? template.tier;
      const availableFromTurn = (lastFulfilled.endedTurnNumber ?? 0) + cooldownLength;
      if (openTurnNumber < availableFromTurn) {
        visible.push({ template, state: "cooldown", reason: null, availableFromTurn });
        continue;
      }
    }

    const activeRow = templateHistory.find((h) => h.status === "ACTIVE");
    if (activeRow) {
      visible.push({ template, state: "active", reason: null, availableFromTurn: null });
      continue;
    }

    visible.push({ template, state: "available", reason: null, availableFromTurn: null });
  }

  return { visible, hidden };
}

// Checks requires.anyTags/anyRoles/notTags/notRoles — AND across the four
// keys, OR within each list, empty/absent list = no constraint. Returns
// { ok: true } | { ok: false, reason } | { hidden: true }.
function evalRequires(template, { heldTagIds, roleSlug, hiddenTagIds }) {
  const anyTags = template.requiresAnyTags || [];
  const notTags = template.requiresNotTags || [];
  const anyRoles = template.requiresAnyRoles || [];
  const notRoles = template.requiresNotRoles || [];

  // notTags / notRoles first — neither can ever trigger the hidden rule
  // (that rule only applies to a failed anyTags gate), so evaluating them
  // first just decides which "locked" reason wins when more than one
  // clause fails, which is harmless.
  const heldForbidden = notTags.find((t) => heldTagIds.has(t.id));
  if (heldForbidden) {
    return { ok: false, reason: `Locked by ${heldForbidden.name}` };
  }
  const heldForbiddenRole = roleSlug && notRoles.find((r) => r.slug === roleSlug);
  if (heldForbiddenRole) {
    return { ok: false, reason: `Locked by your ${heldForbiddenRole.name} role` };
  }

  if (anyTags.length > 0 && !anyTags.some((t) => heldTagIds.has(t.id))) {
    const gatesHidden = anyTags.some((t) => hiddenTagIds.has(t.id));
    if (gatesHidden) return { hidden: true };
    return { ok: false, reason: `Requires the ${anyTags[0].name} tag` };
  }

  if (anyRoles.length > 0 && (!roleSlug || !anyRoles.some((r) => r.slug === roleSlug))) {
    return { ok: false, reason: `Requires the ${anyRoles[0].name} role` };
  }

  return { ok: true };
}

// UNION across held tags' desireLocks arrays (each already the normalized
// db/lib/desireShapes.js shape), keeping each clause paired with the name
// of the tag that contributed it, so a lock hit can say "Locked by
// Alcoholic". Locks only ever add, never subtract.
function unionLockClauses(heldTags) {
  const pairs = [];
  for (const tag of heldTags) {
    if (Array.isArray(tag.desireLocks)) {
      for (const clause of tag.desireLocks) {
        pairs.push({ clause, sourceName: tag.name });
      }
    }
  }
  return pairs;
}

// { all: true } beats everything. { tiers, exceptFamilies }: locks a
// tier-matching template unless it shares a family with exceptFamilies.
// { families }: locks on any family overlap. Checked in that precedence
// order so an {all} clause always wins even if a families clause from a
// different tag would otherwise have matched first.
function lockedReasonForTemplate(template, pairs) {
  const templateFamilies = template.families || [];

  for (const { clause, sourceName } of pairs) {
    if (!clause.all) continue;
    const excepted = Array.isArray(clause.exceptFamilies) &&
      templateFamilies.some((f) => clause.exceptFamilies.includes(f));
    if (!excepted) return `Locked by ${sourceName}`;
  }
  for (const { clause, sourceName } of pairs) {
    if (!Array.isArray(clause.families)) continue;
    if (clause.families.some((f) => templateFamilies.includes(f))) return `Locked by ${sourceName}`;
  }
  for (const { clause, sourceName } of pairs) {
    if (!Array.isArray(clause.tiers)) continue;
    if (!clause.tiers.includes(template.tier)) continue;
    const excepted = Array.isArray(clause.exceptFamilies) &&
      templateFamilies.some((f) => clause.exceptFamilies.includes(f));
    if (!excepted) return `Locked by ${sourceName}`;
  }
  return null;
}

// "1–4" for a run of tiers with no gap, "1, 2, 5" otherwise. A gap is
// measured on the tier LADDER, not the integers — tier 6 doesn't exist
// (syncDesires.js#TIER_WHITELIST), so 2, 3, 4, 5, 7 is the unbroken run
// "2–7". Tiers arrive sorted from desireShapes.js.
const TIER_LADDER = [1, 2, 3, 4, 5, 7];
function formatTiers(tiers) {
  const steps = tiers.map((t) => TIER_LADDER.indexOf(t));
  const unbroken = steps.every((s, i) => s >= 0 && (i === 0 || s === steps[i - 1] + 1));
  return unbroken && tiers.length > 1 ? `${tiers[0]}–${tiers[tiers.length - 1]}` : tiers.join(", ");
}

// Every lock a character's held tags put on the catalog, as one sentence per
// clause: "Alcoholic shuts every Desire outside Alcohol at tiers 1–4." The
// picker drops locked rows outright (character/page.js), so without this a
// narrowed catalog would just look small — the player couldn't tell an
// Addiction was doing it. `familyNames` maps family key → display name
// (db/lib/desireFamilies.js); an unknown key falls back to itself.
function describeDesireLocks(heldTags, familyNames) {
  const name = (key) => familyNames?.get?.(key) ?? familyNames?.[key] ?? key;
  const list = (keys) => keys.map(name).join(", ");
  const notes = [];
  for (const { clause, sourceName } of unionLockClauses(heldTags || [])) {
    const except = Array.isArray(clause.exceptFamilies) ? ` outside ${list(clause.exceptFamilies)}` : "";
    if (clause.all) {
      notes.push(`${sourceName} shuts every Desire${except}.`);
    } else if (Array.isArray(clause.families)) {
      notes.push(`${sourceName} shuts ${list(clause.families)}.`);
    } else if (Array.isArray(clause.tiers)) {
      const tiers = clause.tiers.length === 1 ? `tier ${clause.tiers[0]}` : `tiers ${formatTiers(clause.tiers)}`;
      notes.push(`${sourceName} shuts every Desire${except} at ${tiers}.`);
    }
  }
  return notes;
}

// What opened a template to THIS character — the held tag(s) among its
// requires.anyTags and/or the role among its requires.anyRoles — as a short
// string ("Pacifist", "Innkeeper role", "Dancer · Minstrel role"), or null
// for a template open to everyone. Only ever call this for a template whose
// gate the character PASSES: the row is already theirs, so naming the gate
// leaks nothing (the same reasoning as PointBuy's "Requires:" line). Never
// call it for a locked or hidden one.
function unlockedBy(template, { heldTagIds, roleSlug }) {
  const parts = (template.requiresAnyTags || []).filter((t) => heldTagIds.has(t.id)).map((t) => t.name);
  const role = roleSlug && (template.requiresAnyRoles || []).find((r) => r.slug === roleSlug);
  if (role) parts.push(`${role.name} role`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Per-slot occupancy + cooldown. A slot is locked (cooling down) while
// openTurnNumber <= max(endedTurnNumber) + 1 over that slot's ended rows —
// i.e. there is a whole EMPTY TURN between ending one Desire and setting the
// next, whether the row ended by cancel or by fulfil. End it on turn N and
// the slot is shut for the rest of N, shut again for all of N+1, and open on
// N+2. The extra turn is deliberate (2026-09-02): one turn of lockout meant a
// player could end a Desire late in a turn and refill first thing next turn,
// which is barely a cooldown at all.
//
// Note this is one TURN, not one day — Turn.number increments twice a day
// (DAWN then DUSK), so the added lockout is 12 hours.
//
// `lockedUntilTurn` is literally the turn the slot reopens, because that is
// what the UI renders. Keep it that way.
function slotStates({ history, openTurnNumber, desireSlots }) {
  const hist = history || [];
  const slots = [];
  for (let slotIndex = 0; slotIndex < desireSlots; slotIndex++) {
    const rowsInSlot = hist.filter((h) => h.slotIndex === slotIndex);
    const active = rowsInSlot.find((h) => h.status === "ACTIVE") || null;
    const endedRows = rowsInSlot.filter((h) => h.status !== "ACTIVE" && h.endedTurnNumber != null);
    let lockedUntilTurn = null;
    if (endedRows.length > 0) {
      const maxEnded = Math.max(...endedRows.map((h) => h.endedTurnNumber));
      if (openTurnNumber <= maxEnded + 1) {
        lockedUntilTurn = maxEnded + 2;
      }
    }
    slots.push({ slotIndex, active, lockedUntilTurn });
  }
  return slots;
}

module.exports = {
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  unlockedBy,
  // Exported for db/lib/desireOrphans.js, which re-checks an already-ACTIVE
  // Desire's gate after a tag or role change. It deliberately does NOT go
  // through evaluateDesireCatalog: cooldown, onceEver and "a row is already
  // active" are all reasons a template isn't PICKABLE, and none of them means
  // a Desire the character already holds has become illegitimate.
  evalRequires,
};
