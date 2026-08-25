import { bumpBlood } from "@lifeweb/db";
import { dropCharacterTag } from "@lifeweb/db/lib/tagWrites";

// The per-type behaviour of a Request: how a GM's Undo reverses it, and which
// fields (if any) a GM can Edit. Adding a new RequestType means adding one
// entry here and one entry in RequestPanel.js's section map — nothing else in
// the adjudication surface needs to change.
//
// Every function here runs INSIDE a prisma transaction and reads only
// `request.effect` — the snapshot of what was actually applied. It must never
// re-derive from live state, or a GM edit (or any later transaction by the
// player) silently corrupts the reversal.

// --- shared primitives ------------------------------------------------

export async function creditResources(tx, party, amount, ctx) {
  if (!party || !amount) return;
  if (party.kind === "character") {
    await tx.character.update({ where: { id: party.id }, data: { resources: { increment: amount } } });
  } else if (party.kind === "faction") {
    await tx.faction.update({ where: { id: party.id }, data: { silo: { increment: amount } } });
    await tx.siloTransaction.create({
      data: {
        factionId: party.id,
        amount,
        actorDiscordUserId: ctx.actorDiscordUserId,
        actorCharacterId: ctx.actorCharacterId ?? null,
        actorName: ctx.actorName,
        note: ctx.note ?? null,
        turnNumber: ctx.turnNumber ?? null,
        turnPhase: ctx.turnPhase ?? null,
      },
    });
  }
}

export async function debitResources(tx, party, amount, ctx) {
  if (!party || !amount) return;
  if (party.kind === "character") {
    await tx.character.update({ where: { id: party.id }, data: { resources: { decrement: amount } } });
  } else if (party.kind === "faction") {
    await tx.faction.update({ where: { id: party.id }, data: { silo: { decrement: amount } } });
    await tx.siloTransaction.create({
      data: {
        factionId: party.id,
        amount: -amount,
        actorDiscordUserId: ctx.actorDiscordUserId,
        actorCharacterId: ctx.actorCharacterId ?? null,
        actorName: ctx.actorName,
        note: ctx.note ?? null,
        turnNumber: ctx.turnNumber ?? null,
        turnPhase: ctx.turnPhase ?? null,
      },
    });
  }
}

// Moves the Lifeweb's blood pool by a signed delta, re-clamped to 0-100.
// Every Lifeweb edit and undo goes through here so the pool can't be pushed
// out of range by an inverse that no longer fits (undoing +10 after a GM has
// already spent the pool down, say).
async function moveBlood(tx, delta) {
  if (!delta) return;
  await bumpBlood(tx, delta);
}

// --- stacks -----------------------------------------------------------
// A stackable tag is ONE CharacterTag row carrying a count, never N rows —
// @@unique([characterId, tagId]) stays, so every presence check elsewhere
// still reads "holds it or doesn't". These four are the only writers that
// know about quantity; everything else goes through them.

// Adds `quantity` of a tag, creating the row or incrementing an existing
// one. Non-stackable tags are pinned at 1 no matter what is asked for, so a
// caller that forgot to check `tag.stackable` can't mint a phantom stack.
export async function addToStack(tx, characterId, tagId, quantity, options = {}) {
  const { source = "GM_GRANT", expiresTurn = null, stackable = false } = options;
  const n = stackable ? Math.max(1, Math.trunc(quantity ?? 1)) : 1;
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId } },
  });
  if (!existing) {
    return tx.characterTag.create({
      data: { characterId, tagId, source, expiresTurn, quantity: n },
    });
  }
  if (!stackable) return existing;
  return tx.characterTag.update({
    where: { id: existing.id },
    data: { quantity: existing.quantity + n },
  });
}

// Restores a CharacterTag from a snapshot taken before it was removed. Uses
// an upsert because a player may well have re-acquired the tag by other means
// between the request and the GM getting to it — which is also why the
// update branch INCREMENTS rather than overwrites: the snapshot's quantity is
// what this request took away, not what the character ought to end up with.
export async function restoreCharacterTag(tx, characterId, snapshot) {
  const n = Math.max(1, Math.trunc(snapshot.quantity ?? 1));
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId: snapshot.tagId } },
  });
  if (existing) {
    return tx.characterTag.update({
      where: { id: existing.id },
      data: {
        quantity: existing.quantity + n,
        expiresTurn: snapshot.expiresTurn ?? null,
      },
    });
  }
  return tx.characterTag.create({
    data: {
      characterId,
      tagId: snapshot.tagId,
      source: snapshot.source ?? "GM_GRANT",
      expiresTurn: snapshot.expiresTurn ?? null,
      quantity: n,
    },
  });
}

// Removes `quantity` of a tag, deleting the row once nothing is left. Pass
// null (the default) to drop the whole holding however large the stack —
// that is what an ordinary, non-stackable tag always wants.
//
// Lives in db/lib now, because the bot needs it too: the GM `/heal` command
// drops afflictions through the same implementation. Imported and re-exported
// rather than `export ... from`, which would re-export without binding the
// name locally — this module calls it seven times itself.
export { dropCharacterTag };

// Grants a list of tag SLUGS to one character — what a consumed tag turns
// into (Tag.consumesInto: a meal becoming Ate Meal, a crate unpacking into
// its contents). Slugs rather than ids because that is what the catalog
// carries, specifically so a slug may REPEAT: listing one twice is the only
// way to ask for two of something.
//
// Returns the snapshot Undo needs — one entry per distinct slug, with
// `added` being what was ACTUALLY put on the sheet. That is 0 for a
// non-stackable tag the character already held, which is left entirely alone
// (expiry included: their existing one is the live truth, and clobbering it
// would silently extend or cut short something they already had). Undo may
// only take back what this request really added.
export async function grantTagSlugs(tx, characterId, slugs, turnNumber, durations = null) {
  if (!slugs?.length) return [];

  const owed = new Map();
  for (const slug of slugs) owed.set(slug, (owed.get(slug) ?? 0) + 1);

  const tags = await tx.tag.findMany({
    where: { slug: { in: [...owed.keys()] } },
    select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true },
  });
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]));

  const granted = [];
  for (const [slug, count] of owed) {
    // Unknown slugs are rejected at sync time (db/lib/syncTags.js), so this
    // can only be a row predating a catalog edit — skip it rather than fail
    // the whole request.
    const tag = tagBySlug.get(slug);
    if (!tag) continue;

    const existing = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId: tag.id } },
    });

    if (!existing) {
      // A granted tag with its own duration starts its clock now, which is
      // what makes a chain work (meal -> Ate Meal that the sweep clears).
      // Same absolute-turn expression as db/lib/hungerPass.js.
      //
      // A per-grant override (Tag.consumesIntoDurations, resolved by
      // web/lib/consumeGrants.js) wins over the tag's own duration, so one
      // status can outlast itself depending on what produced it — Bliss
      // leaves you High a turn longer than the raw fungus does.
      const durationTurns = durations?.[slug] ?? tag.defaultDurationTurns;
      const expiresTurn =
        turnNumber != null && durationTurns != null ? turnNumber + durationTurns : null;
      await tx.characterTag.create({
        data: {
          characterId,
          tagId: tag.id,
          source: "EVENT",
          quantity: tag.stackable ? count : 1,
          expiresTurn,
        },
      });
      granted.push({ tagId: tag.id, tagName: tag.name, added: tag.stackable ? count : 1 });
      continue;
    }

    if (tag.stackable) {
      await tx.characterTag.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + count },
      });
      granted.push({ tagId: tag.id, tagName: tag.name, added: count });
      continue;
    }

    granted.push({ tagId: tag.id, tagName: tag.name, added: 0 });
  }

  return granted;
}

// --- per-type handlers ------------------------------------------------

export const REQUEST_EFFECTS = {
  // Points already landed on Character.tagPoints. Undo takes them back even
  // if that drives the balance negative — deliberately, per the brief: if the
  // player already spent them, digging out is their problem, not a GM's.
  FULFILL_DESIRE: {
    editableFields: ["pointsAwarded"],
    // A GM re-scores the Desire: only the DELTA moves onto tagPoints. Writing
    // the whole award again would double-pay the player every time the panel
    // is Confirmed a second time.
    async applyEdit(tx, request, edits) {
      const effect = { ...request.effect };
      const previous = effect.pointsAwarded ?? 0;
      const next = clampNonNegative(edits.pointsAwarded, previous);
      if (next === previous) return { effect, note: "No changes." };

      // Stamped once, on the first edit: `pointsAwarded` is about to stop
      // being the player's number, and the panel still needs to show what they
      // originally claimed the Desire was worth.
      if (effect.playerClaimedPoints == null) effect.playerClaimedPoints = previous;

      await tx.character.update({
        where: { id: request.characterId },
        data: { tagPoints: { increment: next - previous } },
      });
      // Mirror it onto the Desire so the sheet and any later Undo agree with
      // what was actually paid out.
      if (effect.desireId) {
        await tx.desire.updateMany({ where: { id: effect.desireId }, data: { points: next } });
      }
      effect.pointsAwarded = next;
      return { effect, note: `Tag Points ${previous} -> ${next}.` };
    },
    async undo(tx, request, ctx) {
      const { desireId, pointsAwarded } = request.effect;
      if (pointsAwarded) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { tagPoints: { decrement: pointsAwarded } },
        });
      }
      if (desireId) {
        await tx.desire.updateMany({
          where: { id: desireId },
          data: { status: "ACTIVE", endedTurnNumber: null },
        });
      }
      return `Revoked ${pointsAwarded} Tag Point(s) and reopened the Desire.`;
    },
  },

  ADD_TAG: {
    editableFields: ["resourcesSpent", "removeTag"],
    async applyEdit(tx, request, edits, ctx) {
      const effect = { ...request.effect };
      const notes = [];

      const nextSpend = clampNonNegative(edits.resourcesSpent, effect.resourcesSpent);
      const delta = nextSpend - (effect.resourcesSpent ?? 0);
      if (delta !== 0) {
        // Positive delta = the GM decided it should have cost more.
        await tx.character.update({
          where: { id: request.characterId },
          data: { resources: { decrement: delta } },
        });
        notes.push(`Resource cost ${effect.resourcesSpent ?? 0} -> ${nextSpend}.`);
        effect.resourcesSpent = nextSpend;
      }

      if (edits.removeTag && effect.tagId) {
        // Only what this request added comes off — a stack the player built
        // over several requests keeps whatever the others put there.
        await dropCharacterTag(tx, request.characterId, effect.tagId, effect.quantity ?? 1);
        notes.push(`Removed ${formatStack(effect.tagName, effect.quantity)}.`);
        effect.tagRemovedByGm = true;
      }

      return { effect, note: notes.join(" ") || "No changes." };
    },
    async undo(tx, request, ctx) {
      const { tagId, tagName, resourcesSpent, quantity } = request.effect;
      if (tagId && !request.effect.tagRemovedByGm) {
        await dropCharacterTag(tx, request.characterId, tagId, quantity ?? 1);
      }
      if (resourcesSpent) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { resources: { increment: resourcesSpent } },
        });
      }
      return `Removed ${formatStack(tagName, quantity)} and refunded ${resourcesSpent ?? 0} ⬢.`;
    },
  },

  REMOVE_TAG: {
    editableFields: ["resourcesSpent"],
    async applyEdit(tx, request, edits) {
      const effect = { ...request.effect };
      const nextSpend = clampNonNegative(edits.resourcesSpent, effect.resourcesSpent);
      const delta = nextSpend - (effect.resourcesSpent ?? 0);
      if (delta === 0) return { effect, note: "No changes." };
      await tx.character.update({
        where: { id: request.characterId },
        data: { resources: { decrement: delta } },
      });
      const note = `Resource cost ${effect.resourcesSpent ?? 0} -> ${nextSpend}.`;
      effect.resourcesSpent = nextSpend;
      return { effect, note };
    },
    async undo(tx, request) {
      const { restore, tagName, resourcesSpent } = request.effect;
      if (restore?.tagId) await restoreCharacterTag(tx, request.characterId, restore);
      if (resourcesSpent) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { resources: { increment: resourcesSpent } },
        });
      }
      return `Restored ${formatStack(tagName, request.effect.quantity)} and refunded ${resourcesSpent ?? 0} ⬢.`;
    },
  },

  // Nothing numeric to re-score, so a GM's only lever is Undo: put the one
  // unit back with its original source and expiry, and take back exactly what
  // it became. Reads `granted` off the effect rather than re-deriving from
  // Tag.consumesInto, which may well have been edited in the catalog since.
  CONSUME_TAG: {
    editableFields: [],
    async undo(tx, request) {
      const { restore, tagName, granted = [] } = request.effect;
      for (const g of granted) {
        // `added: 0` means the character already held that tag and this
        // request left it alone — taking it away now would confiscate
        // something it never gave.
        if (g.tagId && g.added > 0) await dropCharacterTag(tx, request.characterId, g.tagId, g.added);
      }
      if (restore?.tagId) await restoreCharacterTag(tx, request.characterId, restore);
      const took = granted.filter((g) => g.added > 0).map((g) => formatStack(g.tagName, g.added));
      return took.length
        ? `Restored ${tagName ?? "the tag"} and took back ${took.join(", ")}.`
        : `Restored ${tagName ?? "the tag"}.`;
    },
  },

  TRANSFER_RESOURCES: {
    editableFields: [],
    async undo(tx, request, ctx) {
      const { from, to, amount } = request.effect;
      const noteCtx = { ...ctx, note: `Undo of transfer request ${request.id}` };
      await debitResources(tx, to, amount, noteCtx);
      await creditResources(tx, from, amount, noteCtx);
      return `Reversed ${amount} ⬢ from ${to?.name ?? "recipient"} back to ${from?.name ?? "source"}.`;
    },
  },

  TRANSFER_TAG: {
    editableFields: [],
    async undo(tx, request) {
      const { tagId, tagName, fromCharacterId, toCharacterId, restore, quantity } = request.effect;
      const n = quantity ?? 1;
      if (toCharacterId && tagId) await dropCharacterTag(tx, toCharacterId, tagId, n);
      if (fromCharacterId && tagId) {
        await restoreCharacterTag(tx, fromCharacterId, { tagId, ...(restore ?? {}), quantity: n });
      }
      return `Moved ${formatStack(tagName, quantity)} back to its original holder.`;
    },
  },

  // Both Lifeweb types edit and undo the SNAPSHOT delta, never the nominal
  // amount — the pool caps at 100, so a "+40" that only moved 10 must reverse
  // 10. db/lib/lifeweb.js#applyBlood is what produced that number.
  DONATE_BLOOD: {
    editableFields: ["bloodDelta", "removeDrained"],
    async applyEdit(tx, request, edits) {
      const effect = { ...request.effect };
      const notes = [];

      const previous = effect.bloodDelta ?? 0;
      const next = clampNonNegative(edits.bloodDelta, previous);
      if (next !== previous) {
        await moveBlood(tx, next - previous);
        notes.push(`Blood ${previous} -> ${next}.`);
        effect.bloodDelta = next;
      }

      if (edits.removeDrained && effect.drainedTagId) {
        await dropCharacterTag(tx, effect.targetCharacterId, effect.drainedTagId);
        notes.push(`Cleared Drained from ${effect.targetName ?? "the target"}.`);
        effect.drainedRemovedByGm = true;
      }

      return { effect, note: notes.join(" ") || "No changes." };
    },
    async undo(tx, request) {
      const { bloodDelta, targetCharacterId, targetName, drainedTagId, drainedRemovedByGm } = request.effect;
      await moveBlood(tx, -(bloodDelta ?? 0));
      if (drainedTagId && targetCharacterId && !drainedRemovedByGm) {
        await dropCharacterTag(tx, targetCharacterId, drainedTagId);
      }
      return `Drew back ${bloodDelta ?? 0} blood and cleared Drained from ${targetName ?? "the target"}.`;
    },
  },

  // Undo reverses the blood only. If a GM has already run the Kill button the
  // character stays dead — reviving them is a separate, deliberate act on
  // /gm/dev/characters/[characterId], not a side effect of undoing a request.
  FEED_PERSON: {
    editableFields: ["bloodDelta"],
    async applyEdit(tx, request, edits) {
      const effect = { ...request.effect };
      const previous = effect.bloodDelta ?? 0;
      const next = clampNonNegative(edits.bloodDelta, previous);
      if (next === previous) return { effect, note: "No changes." };
      await moveBlood(tx, next - previous);
      effect.bloodDelta = next;
      return { effect, note: `Blood ${previous} -> ${next}.` };
    },
    async undo(tx, request) {
      const { bloodDelta, targetName, killed } = request.effect;
      await moveBlood(tx, -(bloodDelta ?? 0));
      return killed
        ? `Drew back ${bloodDelta ?? 0} blood. ${targetName ?? "The target"} stays dead — revive them by hand if that was wrong.`
        : `Drew back ${bloodDelta ?? 0} blood.`;
    },
  },

  // Changing a locked-in Worst Fear. Nothing numeric moved, so a GM's only
  // lever is Undo: put the previous wording and its set-turn back. The first
  // set is NOT a request (see requestActions.js), so every row of this type
  // really is a change and previousText is always populated.
  //
  // Lossy in the same way SET_MOOD is: undoing the FIRST of two changes
  // clobbers the second one's text. That is the price of "Undo reads only
  // effect, never live state" (REQUESTS.md §2), and re-deriving from the
  // sheet is exactly what that rule forbids.
  CHANGE_WORST_FEAR: {
    editableFields: [],
    async undo(tx, request) {
      const { previousText, previousSetTurnNumber } = request.effect;
      await tx.character.update({
        where: { id: request.characterId },
        data: {
          worstFear: previousText ?? null,
          worstFearSetTurnNumber: previousSetTurnNumber ?? null,
        },
      });
      return previousText
        ? "Restored the previous Worst Fear."
        : "Cleared the Worst Fear — there wasn't one before this.";
    },
  },

  // The fear coming true: a flat penalty, never a ladder, so there is nothing
  // to re-score and editableFields is empty by design. The fear itself
  // PERSISTS — this request only moves Tag Points and stamps the cooldown.
  FULFILL_WORST_FEAR: {
    editableFields: [],
    async undo(tx, request) {
      const { pointsDeducted, fulfilledTurnNumber, previousLastFulfilledTurn } = request.effect;

      // Read off the snapshot rather than WORST_FEAR_PENALTY, so an old row
      // still reverses by what it actually took if that number is retuned.
      if (pointsDeducted) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { tagPoints: { increment: pointsDeducted } },
        });
      }

      // Only unwind the cooldown if this request is still the one that set
      // it. A player who claimed the fear again on a later turn owns the
      // stamp now, and blindly restoring our snapshot would hand them a free
      // extra claim. This reads live state to decide WHETHER the restore
      // still applies — never to recompute WHAT to restore, which is the
      // thing REQUESTS.md §2 forbids.
      const live = await tx.character.findUnique({
        where: { id: request.characterId },
        select: { worstFearLastFulfilledTurn: true },
      });
      if (live && live.worstFearLastFulfilledTurn === (fulfilledTurnNumber ?? null)) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { worstFearLastFulfilledTurn: previousLastFulfilledTurn ?? null },
        });
      }

      return `Refunded ${pointsDeducted ?? 0} Tag Point(s). The Worst Fear stands, unfulfilled.`;
    },
  },

  // The only type whose subject is a DIFFERENT character from the one who
  // filed it: `request.characterId` is the medic, `effect.targetCharacterId`
  // the patient. Every tag write below therefore takes the target's id — the
  // reflex to reach for request.characterId is wrong here.
  //
  // A heal is a SPEND, not a transfer: the cost leaves the payer and goes
  // nowhere, so only one side ever moves.
  HEAL_CHARACTER: {
    editableFields: ["resourcesSpent", "restoreHealedTag"],
    async applyEdit(tx, request, edits, ctx) {
      const effect = { ...request.effect };
      const notes = [];
      const noteCtx = { ...ctx, note: `Edit of heal request ${request.id}` };

      const previous = effect.resourcesSpent ?? 0;
      const next = clampNonNegative(edits.resourcesSpent, previous);
      if (next !== previous) {
        if (next < previous) await creditResources(tx, effect.payer, previous - next, noteCtx);
        else await debitResources(tx, effect.payer, next - previous, noteCtx);
        notes.push(`Cost ${previous} -> ${next} ⬢, ${effect.payer?.name ?? "the payer"} settled up.`);
        effect.resourcesSpent = next;
      }

      // "The treatment didn't take" — the affliction comes back but the
      // medicine was still bought. Flagged so Undo doesn't restore it twice.
      if (edits.restoreHealedTag && effect.restore?.tagId && !effect.tagRestoredByGm) {
        await restoreCharacterTag(tx, effect.targetCharacterId, effect.restore);
        notes.push(`Put ${effect.tagName ?? "the affliction"} back on ${effect.targetName ?? "the patient"}.`);
        effect.tagRestoredByGm = true;
      }

      return { effect, note: notes.join(" ") || "No changes." };
    },
    async undo(tx, request, ctx) {
      const { resourcesSpent, payer, restore, targetCharacterId, targetName, tagName, tagRestoredByGm } =
        request.effect;
      if (resourcesSpent) {
        await creditResources(tx, payer, resourcesSpent, { ...ctx, note: `Undo of heal request ${request.id}` });
      }
      if (restore?.tagId && targetCharacterId && !tagRestoredByGm) {
        await restoreCharacterTag(tx, targetCharacterId, restore);
      }
      return `Put ${tagName ?? "the affliction"} back on ${targetName ?? "the patient"} and refunded ${resourcesSpent ?? 0} ⬢ to ${payer?.name ?? "the payer"}.`;
    },
  },

  SET_MOOD: {
    editableFields: [],
    async undo(tx, request) {
      const { appliedTagId, previous } = request.effect;
      if (appliedTagId) await dropCharacterTag(tx, request.characterId, appliedTagId);
      if (previous?.tagId) await restoreCharacterTag(tx, request.characterId, previous);
      return previous?.tagId ? "Restored the previous mood." : "Cleared the mood back to Neutral.";
    },
  },

  // Drinking a Mulligan Potion. Nothing numeric to re-score, so Undo is the
  // only lever: put the previous honorific/first/last name (and the composed
  // `name`) back, and restore the one potion this took, same idiom as
  // CONSUME_TAG. Undo does NOT re-run the Discord role/nickname sync — no
  // network call may run inside this transaction (ARCHITECTURE.md §5) — so
  // Discord catches up the next time the player saves their Bio form, which
  // always re-syncs off the live DB name regardless of what changed.
  CHANGE_NAME: {
    editableFields: [],
    async undo(tx, request) {
      const { previous, potionTagId, potionRestore } = request.effect;
      await tx.character.update({
        where: { id: request.characterId },
        data: {
          honorific: previous?.honorific ?? null,
          firstName: previous?.firstName,
          lastName: previous?.lastName ?? null,
          name: previous?.name,
        },
      });
      if (potionTagId) {
        await restoreCharacterTag(tx, request.characterId, { tagId: potionTagId, ...potionRestore, quantity: 1 });
      }
      return `Restored the previous name (${previous?.name ?? "—"}) and gave back the Mulligan Potion.`;
    },
  },
};

// A GM can only ever set a non-negative amount; anything else is a typo, and
// silently letting a negative through would mint resources (or Tag Points).
// "Fine Meal x3" / "the Manor" — GM-facing note text for a possibly-stacked
// tag. Quantity 1 (or absent) reads as a plain name, so nothing changes for
// the ordinary case.
function formatStack(tagName, quantity) {
  const name = tagName ?? "the tag";
  return (quantity ?? 1) > 1 ? `${name} x${quantity}` : name;
}

function clampNonNegative(raw, fallback) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return fallback ?? 0;
  return n;
}

export function editableFieldsFor(type) {
  return REQUEST_EFFECTS[type]?.editableFields ?? [];
}
