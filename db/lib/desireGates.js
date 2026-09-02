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
//              clauses, each { all } | { families } | { tiers, exceptFamilies? },
//              any of which may carry { slot: "bottom" }.
//   hiddenTagIds: Set<tagId>  // tag ids that gate a hidden category —
//              computed by the caller from TagGroup.requiredTagId gating.
//              This module has no DB, so it cannot compute this itself.
//   history:   the character's Desire rows: [{ id, templateId, slotIndex,
//               status, endedTurnNumber, text, points }]
//               (status: ACTIVE|FULFILLED|CANCELLED — ACTIVE is legacy, see
//               the schema comment on DesireStatus)
//   roleSlug:  the character's current Role.slug, or null
//   openTurnNumber: the currently open Turn.number
//   desireSlots: GameConfig.desireSlots, needed to know which index is the
//               BOTTOM slot a `slot: "bottom"` clause binds.
//
// Evaluation order (first match wins), exactly:
//   1. hidden   — fails a requires.anyTags gate whose gating tag id is in
//                 hiddenTagIds. WITHHELD from the returned payload entirely
//                 (see below) — never rendered dimmed. Getting this wrong
//                 leaks a hidden roster (Demoness, Bacchus).
//   2. locked   — fails an ungated requires clause, or caught by a held
//                 tag's UNSCOPED desireLocks union. Reason is a short human
//                 string; for a requires-gated entry the reason must NEVER
//                 name a hidden tag (that IS the oracle the hidden rule
//                 forbids).
//   3. spent    — onceEver and a FULFILLED row already exists for this
//                 templateId, regardless of cooldown.
//   4. cooldown — a FULFILLED row exists and
//                 openTurnNumber < endedTurnNumber + (cooldownTurns ?? tier).
//                 Exactly at the boundary is AVAILABLE, not cooldown.
//   5. available.
//
// There used to be a sixth state, `active`, for "a row already occupies a
// slot with this templateId". The 2026-09-02 retroactive rework removed
// setting a Desire, so no row is ever ACTIVE and nothing can be in flight.
//
// SLOT-SCOPED locks are the one thing that does NOT collapse into `state`,
// because the same template can be open in one slot and shut in another.
// Every visible entry carries `slotLocks: [reasonOrNull per slot]`, filled
// only from clauses carrying `slot: "bottom"`. A caller that drops `locked`
// rows (character/page.js does) still has to consult slotLocks for the slot
// the player is actually claiming into.
//
// evaluateDesireCatalog returns { visible, hidden } — `visible` is the
// array callers should ever pay out to a UI payload (one entry per
// non-hidden template: { template, state, reason, availableFromTurn,
// slotLocks }), `hidden` is the parallel bookkeeping (template ids only) for
// callers that need to know withholding happened without ever handing the
// shape back out.
function evaluateDesireCatalog({ templates, heldTags, hiddenTagIds, roleSlug, history, openTurnNumber, desireSlots = 2 }) {
  const heldTagIds = new Set((heldTags || []).map((t) => t.id));
  const hidden_ = hiddenTagIds instanceof Set ? hiddenTagIds : new Set(hiddenTagIds || []);
  const allClauses = unionLockClauses(heldTags || []);
  const globalClauses = allClauses.filter(({ clause }) => clause.slot == null);
  const scopedClauses = allClauses.filter(({ clause }) => clause.slot != null);
  const hist = history || [];

  // One reason-or-null per slot, from the scoped clauses only. Computed even
  // for a locked/spent/cooldown row so the shape is uniform.
  const slotLocksFor = (template) =>
    Array.from({ length: desireSlots }, (_, slotIndex) =>
      lockedReasonForTemplate(template, scopedClauses, { slotIndex, desireSlots }),
    );

  const visible = [];
  const hidden = [];

  for (const template of templates || []) {
    if (template.retired) continue;

    const requiresResult = evalRequires(template, { heldTagIds, roleSlug, hiddenTagIds: hidden_ });

    if (requiresResult.hidden) {
      hidden.push(template.id);
      continue;
    }

    const slotLocks = slotLocksFor(template);
    const push = (state, reason, availableFromTurn) =>
      visible.push({ template, state, reason, availableFromTurn, slotLocks });

    if (!requiresResult.ok) {
      push("locked", requiresResult.reason, null);
      continue;
    }

    const lockReason = lockedReasonForTemplate(template, globalClauses, { slotIndex: null, desireSlots });
    if (lockReason) {
      push("locked", lockReason, null);
      continue;
    }

    const templateHistory = hist.filter((h) => h.templateId === template.id);
    const fulfilledRows = templateHistory.filter((h) => h.status === "FULFILLED");

    if (template.onceEver && fulfilledRows.length > 0) {
      push("spent", null, null);
      continue;
    }

    if (fulfilledRows.length > 0) {
      const lastFulfilled = fulfilledRows.reduce((latest, row) =>
        (row.endedTurnNumber ?? -Infinity) > (latest.endedTurnNumber ?? -Infinity) ? row : latest
      );
      const cooldownLength = template.cooldownTurns ?? template.tier;
      const availableFromTurn = (lastFulfilled.endedTurnNumber ?? 0) + cooldownLength;
      if (openTurnNumber < availableFromTurn) {
        push("cooldown", null, availableFromTurn);
        continue;
      }
    }

    push("available", null, null);
  }

  return { visible, hidden };
}

// Checks requires.anyTags/anyRoles/notTags/notRoles — AND across the four
// keys, OR within each list, empty/absent list = no constraint. Returns
// { ok: true } | { ok: false, reason } | { hidden: true }.
//
// The ONE exception to "AND across the keys" is requiresAnyOf (YAML
// `requires.combine: or`), which joins anyTags and anyRoles with OR so that
// either alone opens the Desire. notTags/notRoles are never part of that —
// a forbidden pairing is not something an OR may open.
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

  const holdsGatingTag = anyTags.some((t) => heldTagIds.has(t.id));
  const holdsGatingRole = Boolean(roleSlug) && anyRoles.some((r) => r.slug === roleSlug);

  // OR mode. An EMPTY list must not be what satisfies the OR: under AND an
  // empty list means "no constraint", and carrying that reading over here
  // would open the Desire to everyone. The sync refuses `combine: or` unless
  // both lists are populated, so this is belt and braces.
  if (template.requiresAnyOf) {
    if (holdsGatingTag || holdsGatingRole) return { ok: true };
    // The hidden rule still outranks the reason string: naming a hidden tag
    // is the oracle it exists to prevent.
    if (anyTags.some((t) => hiddenTagIds.has(t.id))) return { hidden: true };
    return {
      ok: false,
      reason: `Requires the ${anyTags[0].name} tag or the ${anyRoles[0].name} role`,
    };
  }

  if (anyTags.length > 0 && !holdsGatingTag) {
    const gatesHidden = anyTags.some((t) => hiddenTagIds.has(t.id));
    if (gatesHidden) return { hidden: true };
    return { ok: false, reason: `Requires the ${anyTags[0].name} tag` };
  }

  if (anyRoles.length > 0 && !holdsGatingRole) {
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

// Whether a clause reaches the slot being checked. `slot: "bottom"` binds the
// LAST slot only; an unscoped clause binds every slot. `slotIndex: null` means
// "not asking about a slot" — used for the slot-agnostic pass, where a scoped
// clause must never fire.
function clauseAppliesToSlot(clause, { slotIndex, desireSlots }) {
  if (clause.slot == null) return true;
  if (slotIndex == null) return false;
  if (clause.slot === "bottom") return slotIndex === desireSlots - 1;
  return false;
}

// { all: true } beats everything. { tiers, exceptFamilies }: locks a
// tier-matching template unless it shares a family with exceptFamilies.
// { families }: locks on any family overlap. Checked in that precedence
// order so an {all} clause always wins even if a families clause from a
// different tag would otherwise have matched first.
function lockedReasonForTemplate(template, pairs, scope = { slotIndex: null, desireSlots: 2 }) {
  const templateFamilies = template.families || [];
  const inScope = pairs.filter(({ clause }) => clauseAppliesToSlot(clause, scope));

  for (const { clause, sourceName } of inScope) {
    if (!clause.all) continue;
    const excepted = Array.isArray(clause.exceptFamilies) &&
      templateFamilies.some((f) => clause.exceptFamilies.includes(f));
    if (!excepted) return `Locked by ${sourceName}`;
  }
  for (const { clause, sourceName } of inScope) {
    if (!Array.isArray(clause.families)) continue;
    if (clause.families.some((f) => templateFamilies.includes(f))) return `Locked by ${sourceName}`;
  }
  for (const { clause, sourceName } of inScope) {
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
// clause: "Alcoholic shuts your bottom Desire slot to everything outside
// Alcohol." The picker drops locked rows outright (character/page.js), so
// without this a narrowed catalog would just look small — the player couldn't
// tell an Addiction was doing it. `familyNames` maps family key → display name
// (db/lib/desireFamilies.js); an unknown key falls back to itself.
function describeDesireLocks(heldTags, familyNames) {
  const name = (key) => familyNames?.get?.(key) ?? familyNames?.[key] ?? key;
  const list = (keys) => keys.map(name).join(", ");
  const notes = [];
  for (const { clause, sourceName } of unionLockClauses(heldTags || [])) {
    const except = Array.isArray(clause.exceptFamilies) ? ` outside ${list(clause.exceptFamilies)}` : "";
    // A scoped clause names the slot it binds instead of speaking for the
    // whole catalog — this is the sentence that tells a player their
    // Addiction only costs them one slot.
    if (clause.slot === "bottom") {
      if (clause.all) {
        notes.push(`${sourceName} shuts your bottom Desire slot to everything${except}.`);
      } else if (Array.isArray(clause.families)) {
        notes.push(`${sourceName} shuts ${list(clause.families)} in your bottom Desire slot.`);
      } else if (Array.isArray(clause.tiers)) {
        const tiers = clause.tiers.length === 1 ? `tier ${clause.tiers[0]}` : `tiers ${formatTiers(clause.tiers)}`;
        notes.push(`${sourceName} shuts your bottom Desire slot${except} at ${tiers}.`);
      }
      continue;
    }
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

// The held tag that binds the bottom Desire slot — i.e. the character's
// Addiction, found by the shape of what it does rather than by its tag group,
// so the panel's "Addiction: Alcoholic" caption follows the data. Returns
// { name } or null. At most one can be held (every Addiction is
// `exclusive: true` in its group), so the first hit wins.
function bottomSlotAddiction(heldTags) {
  for (const { clause, sourceName } of unionLockClauses(heldTags || [])) {
    if (clause.slot === "bottom") return { name: sourceName };
  }
  return null;
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

// Per-slot lock. A Desire is claimed retroactively straight into a slot, which
// shuts that slot for `lockTurns` whole turns afterwards:
//
//     locked while  openTurnNumber <= maxEnded + lockTurns
//     reopens on    maxEnded + lockTurns + 1
//
// Claim on turn N with the default lockTurns of 2 and the slot is shut for the
// rest of N, shut through N+1 and N+2, and open on N+3. `lockTurns` is
// GameConfig.desireSlotLockTurns, live-editable from /gm/dev; the pre-2026-09-02
// hardcoded behaviour was lockTurns: 1.
//
// Note this is one TURN, not one day — Turn.number increments twice a day
// (DAWN then DUSK), so each turn of lockout is 12 hours.
//
// `lockedUntilTurn` is literally the turn the slot reopens, because that is
// what the UI renders. Keep it that way.
//
// `lastEnded` is the slot's most recent ended row, which the panel prints as
// "Last: <text>" — a claim is over the moment it lands, so this is the only
// thing a slot ever has to show. A row with a null endedTurnNumber (a revoked
// or undone claim) is deliberately excluded from BOTH: it neither locks the
// slot nor counts as the last thing that happened in it.
function slotStates({ history, openTurnNumber, desireSlots, lockTurns = 2 }) {
  const hist = history || [];
  const slots = [];
  for (let slotIndex = 0; slotIndex < desireSlots; slotIndex++) {
    const endedRows = hist.filter((h) => h.slotIndex === slotIndex && h.endedTurnNumber != null);
    let lockedUntilTurn = null;
    let lastEnded = null;
    if (endedRows.length > 0) {
      const maxEnded = Math.max(...endedRows.map((h) => h.endedTurnNumber));
      if (openTurnNumber <= maxEnded + lockTurns) {
        lockedUntilTurn = maxEnded + lockTurns + 1;
      }
      lastEnded =
        endedRows
          .filter((h) => h.status === "FULFILLED")
          .reduce((latest, row) => (latest == null || row.endedTurnNumber > latest.endedTurnNumber ? row : latest), null);
    }
    slots.push({ slotIndex, lockedUntilTurn, lastEnded });
  }
  return slots;
}

module.exports = {
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  bottomSlotAddiction,
  unlockedBy,
  evalRequires,
};
