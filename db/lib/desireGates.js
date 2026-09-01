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
    return { ok: false, reason: `Requires a ${anyRoles[0].name} role` };
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

// Per-slot occupancy + cooldown. A slot is locked (cooling down) while
// openTurnNumber <= max(endedTurnNumber) over that slot's ended rows —
// i.e. available again strictly the turn AFTER the highest ended turn in
// that slot, whether the row ended by cancel or by fulfil.
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
      if (openTurnNumber <= maxEnded) {
        lockedUntilTurn = maxEnded + 1;
      }
    }
    slots.push({ slotIndex, active, lockedUntilTurn });
  }
  return slots;
}

module.exports = {
  evaluateDesireCatalog,
  slotStates,
  // Exported for db/lib/desireOrphans.js, which re-checks an already-ACTIVE
  // Desire's gate after a tag or role change. It deliberately does NOT go
  // through evaluateDesireCatalog: cooldown, onceEver and "a row is already
  // active" are all reasons a template isn't PICKABLE, and none of them means
  // a Desire the character already holds has become illegitimate.
  evalRequires,
};
