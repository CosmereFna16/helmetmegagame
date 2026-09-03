// Pure Desire-catalog gate evaluator. No prisma import, not in the
// @lifeweb/db barrel — deep-imported by client components and server
// actions, which pass plain objects.
// Order (first match wins): hidden, locked, spent, cooldown, available. A
// hidden state must be withheld entirely; a locked reason must never name a
// hidden tag (leaks Demoness).
function evaluateDesireCatalog({ templates, heldTags, hiddenTagIds, roleSlug, history, openTurnNumber, desireSlots = 2 }) {
  const heldTagIds = new Set((heldTags || []).map((t) => t.id));
  const hidden_ = hiddenTagIds instanceof Set ? hiddenTagIds : new Set(hiddenTagIds || []);
  const allClauses = unionLockClauses(heldTags || []);
  const globalClauses = allClauses.filter(({ clause }) => clause.slot == null);
  const scopedClauses = allClauses.filter(({ clause }) => clause.slot != null);
  const hist = history || [];

  // One reason-or-null per slot, from the scoped clauses only.
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

// Checks requires.anyTags/allTags/anyRoles/notTags/notRoles — AND across
// keys, OR within an `any` list, empty list = no constraint. Returns
// { ok: true } | { ok: false, reason } | { hidden: true }. requiresAnyOf
// (`requires.combine: or`) joins anyTags/anyRoles with OR instead.
function evalRequires(template, { heldTagIds, roleSlug, hiddenTagIds }) {
  const anyTags = template.requiresAnyTags || [];
  const allTags = template.requiresAllTags || [];
  const notTags = template.requiresNotTags || [];
  const anyRoles = template.requiresAnyRoles || [];
  const notRoles = template.requiresNotRoles || [];

  // notTags/notRoles never trigger the hidden rule (only a failed anyTags
  // gate can).
  const heldForbidden = notTags.find((t) => heldTagIds.has(t.id));
  if (heldForbidden) {
    return { ok: false, reason: `Locked by ${heldForbidden.name}` };
  }
  const heldForbiddenRole = roleSlug && notRoles.find((r) => r.slug === roleSlug);
  if (heldForbiddenRole) {
    return { ok: false, reason: `Locked by your ${heldForbiddenRole.name} role` };
  }

  // allTags never joins the requiresAnyOf OR; the sync refuses that combination.
  const missingAll = allTags.filter((t) => !heldTagIds.has(t.id));
  if (missingAll.length > 0) {
    if (missingAll.some((t) => hiddenTagIds.has(t.id))) return { hidden: true };
    return { ok: false, reason: `Requires the ${missingAll[0].name} tag` };
  }

  const holdsGatingTag = anyTags.some((t) => heldTagIds.has(t.id));
  const holdsGatingRole = Boolean(roleSlug) && anyRoles.some((r) => r.slug === roleSlug);

  // OR mode. An empty list must not satisfy the OR (that would open the
  // Desire to everyone); the sync refuses `combine: or` unless both lists
  // are populated.
  if (template.requiresAnyOf) {
    if (holdsGatingTag || holdsGatingRole) return { ok: true };
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

// Union across held tags' desireLocks arrays, each clause paired with the
// name of the tag that contributed it.
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

// `slot: "bottom"` binds the last slot only; an unscoped clause binds every
// slot. `slotIndex: null` means the slot-agnostic pass, where a scoped
// clause must never fire.
function clauseAppliesToSlot(clause, { slotIndex, desireSlots }) {
  if (clause.slot == null) return true;
  if (slotIndex == null) return false;
  if (clause.slot === "bottom") return slotIndex === desireSlots - 1;
  return false;
}

// { all: true } beats everything, then { families } (any overlap locks),
// then { tiers, exceptFamilies } (locks unless it shares an exceptFamily).
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

// "1–4" for a run with no gap on the tier ladder (tier 6 doesn't exist, so
// 2,3,4,5,7 is unbroken), "1, 2, 5" otherwise.
const TIER_LADDER = [1, 2, 3, 4, 5, 7];
function formatTiers(tiers) {
  const steps = tiers.map((t) => TIER_LADDER.indexOf(t));
  const unbroken = steps.every((s, i) => s >= 0 && (i === 0 || s === steps[i - 1] + 1));
  return unbroken && tiers.length > 1 ? `${tiers[0]}–${tiers[tiers.length - 1]}` : tiers.join(", ");
}

// Every lock a character's held tags put on the catalog, as one sentence per
// clause: "Alcoholic shuts your bottom Desire slot to everything outside
// Alcohol." `familyNames` maps family key -> display name.
function describeDesireLocks(heldTags, familyNames) {
  const name = (key) => familyNames?.get?.(key) ?? familyNames?.[key] ?? key;
  const list = (keys) => keys.map(name).join(", ");
  const notes = [];
  for (const { clause, sourceName } of unionLockClauses(heldTags || [])) {
    const except = Array.isArray(clause.exceptFamilies) ? ` outside ${list(clause.exceptFamilies)}` : "";
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

// The held tag that binds the bottom Desire slot (a character's Addiction).
// Returns { name } or null; at most one can be held.
function bottomSlotAddiction(heldTags) {
  for (const { clause, sourceName } of unionLockClauses(heldTags || [])) {
    if (clause.slot === "bottom") return { name: sourceName };
  }
  return null;
}

// What opened a template to this character, as a short string ("Pacifist",
// "Innkeeper role"), or null. Only call for a template whose gate the
// character passes — never a locked or hidden one.
function unlockedBy(template, { heldTagIds, roleSlug }) {
  const parts = [...(template.requiresAllTags || []), ...(template.requiresAnyTags || [])]
    .filter((t) => heldTagIds.has(t.id))
    .map((t) => t.name);
  const role = roleSlug && (template.requiresAnyRoles || []).find((r) => r.slug === roleSlug);
  if (role) parts.push(`${role.name} role`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// Per-slot lock: claiming a Desire shuts that slot until
// maxEnded + lockTurns + 1 (`lockTurns` is GameConfig.desireSlotLockTurns).
// A turn is 12 hours (DAWN then DUSK). `lastEnded` is the slot's most recent
// FULFILLED row; a row with null endedTurnNumber counts toward neither.
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
