import { bumpBlood } from "@lifeweb/db";
import { addToStack, dropCharacterTag, grantTagSlugs } from "@lifeweb/db/lib/tagWrites";
import { moveParty, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import { UserError } from "@/lib/actionResult";

// The per-type behaviour of a Request: how a GM's Undo reverses it, and which
// fields (if any) a GM can Edit. Adding a new RequestType means adding one
// entry here and one entry in RequestPanel.js's section map — nothing else in
// the adjudication surface needs to change.
//
// Every function here runs INSIDE a prisma transaction and reads only
// `request.effect` — the snapshot of what was actually applied. It must never
// re-derive from live state, or a GM edit (or any later transaction by the
// player) silently corrupts the reversal.
//
// `applyEdit` returns `{ effect, note, changed }`. `changed` is whether this
// call actually moved something — a real edit — as opposed to a Confirm that
// only stamped gmNotes/reviewedAt. The caller (resolveRequestImpl in
// actions.js) uses it to decide EDITED vs. leaving the player's own status
// alone.

// --- shared primitives ------------------------------------------------

// Moves a party's balance by a signed delta, and REFUSES rather than going
// negative.
//
// The check and the subtraction used to be separate statements with a whole
// server action between them: read the balance, compare, and some lines later
// decrement. Prisma runs READ COMMITTED, so two requests firing at the same
// moment — two tabs, a double-click, a flaky connection retrying — both read
// the same balance, both passed, and both subtracted. Ten ⬢ sent twice left
// the sender at −10 and the recipient up 20, and it worked on faction silos
// too.
//
// So the write IS the check: a conditional updateMany that matches only while
// the balance still covers the amount, and a count of 0 means it didn't. Every
// caller runs inside a $transaction, so the throw rolls back the tag grant,
// the Request row and the audit entry along with it. The friendly pre-checks
// in the request actions are kept for their better wording; this is the
// enforcement underneath them.
//
// The primitive itself lives in db/lib/resourceTransfer.js — the turn-end
// push (CommonJS, no Next.js request context) needs the exact same clamp, so
// this is a thin delegate that maps InsufficientResourcesError to the
// friendlier UserError wording this surface has always used.
export async function moveResources(tx, party, delta) {
  const character = party?.kind === "character";
  try {
    await moveParty(tx, party, delta);
  } catch (err) {
    if (!(err instanceof InsufficientResourcesError)) throw err;
    throw new UserError(
      character
        ? `${party.name ?? "That character"} no longer has ${err.amount} ⬢.`
        : `The ${party?.name ?? "faction"} Silo no longer has ${err.amount} ⬢.`,
    );
  }
}

export async function creditResources(tx, party, amount, ctx) {
  if (!party || !amount) return;
  await moveResources(tx, party, amount);
  if (party.kind === "faction") {
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
  await moveResources(tx, party, -amount);
  if (party.kind === "faction") {
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
//
// Lives in db/lib/tagWrites.js now, beside dropCharacterTag and for the same
// reason: the staged-push pass grants tags at turn end. Re-exported below.
export { addToStack };

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

// Also moved down to db/lib/tagWrites.js — db/lib/tagOps.js fires the
// treated-wound aftermath (Tag.removesInto) on a GM removal, and db/ cannot
// import web/. Re-exported so every caller here keeps its import.
export { grantTagSlugs };

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
      if (next === previous) return { effect, note: "No changes.", changed: false };

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
      return { effect, note: `Tag Points ${previous} -> ${next}.`, changed: true };
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
        // Positive delta = the GM decided it should have cost more, so the
        // sign is flipped for moveResources. Raising a cost past what the
        // player still holds refuses rather than driving them negative — the
        // GM sees the shortfall and can pick a number that fits.
        await moveResources(tx, { kind: "character", id: request.characterId }, -delta);
        notes.push(`Resource cost ${effect.resourcesSpent ?? 0} -> ${nextSpend}.`);
        effect.resourcesSpent = nextSpend;
      }

      if (edits.removeTag && effect.tagId && !effect.tagRemovedByGm) {
        // Only what this request added comes off — a stack the player built
        // over several requests keeps whatever the others put there.
        //
        // The `!effect.tagRemovedByGm` guard is what stops a second Confirm
        // taking a second unit. The flag was already being written below and
        // already honoured by undo(); it just wasn't read here, and
        // resolveRequest allows unlimited confirms. HEAL_CHARACTER.applyEdit
        // has had this exact guard all along.
        await dropCharacterTag(tx, request.characterId, effect.tagId, effect.quantity ?? 1);
        notes.push(`Removed ${formatStack(effect.tagName, effect.quantity)}.`);
        effect.tagRemovedByGm = true;
        // If this Add was a chain upgrade, it displaced the held lower tier;
        // taking the upgrade off the sheet brings that tier back. Flagged on
        // the effect so a later Undo doesn't restore it a second time.
        for (const snapshot of effect.replaced ?? []) {
          await restoreCharacterTag(tx, request.characterId, snapshot);
        }
        if (effect.replaced?.length) {
          notes.push(
            `Restored ${effect.replaced.map((r) => r.tagName ?? "a replaced tier").join(", ")}.`,
          );
          effect.replacedRestored = true;
        }
      }

      return { effect, note: notes.join(" ") || "No changes.", changed: notes.length > 0 };
    },
    async undo(tx, request, ctx) {
      const { tagId, tagName, resourcesSpent, quantity, replaced = [] } = request.effect;
      if (tagId && !request.effect.tagRemovedByGm) {
        await dropCharacterTag(tx, request.characterId, tagId, quantity ?? 1);
      }
      if (!request.effect.replacedRestored) {
        for (const snapshot of replaced) {
          await restoreCharacterTag(tx, request.characterId, snapshot);
        }
      }
      if (resourcesSpent) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { resources: { increment: resourcesSpent } },
        });
      }
      const restoredNote =
        !request.effect.replacedRestored && replaced.length
          ? `, restored ${replaced.map((r) => r.tagName ?? "a replaced tier").join(", ")},`
          : "";
      return `Removed ${formatStack(tagName, quantity)}${restoredNote} and refunded ${resourcesSpent ?? 0} ⬢.`;
    },
  },

  // The /store checkout — one request for a whole cart. Tags were granted
  // and tagPoints deducted at purchase time; there's nothing to edit
  // line-by-line (prices are the catalog's, not the player's claim), so the
  // only GM verdict is Undo: the whole cart comes back off and the points
  // are refunded. A partial return is a GM microaction on the Dev Panel,
  // not a request edit.
  BUY_TAGS: {
    editableFields: [],
    async applyEdit(tx, request) {
      return { effect: { ...request.effect }, note: "No changes.", changed: false };
    },
    async undo(tx, request) {
      const { items = [], totalPoints = 0, replaced = [] } = request.effect;
      for (const item of items) {
        await dropCharacterTag(tx, request.characterId, item.tagId, 1);
      }
      // A chain upgrade took the lower tier off the sheet at purchase time;
      // an exact inverse puts it back with its original source and expiry.
      for (const snapshot of replaced) {
        await restoreCharacterTag(tx, request.characterId, snapshot);
      }
      if (totalPoints) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { tagPoints: { increment: totalPoints } },
        });
      }
      const restoredNote = replaced.length
        ? `, restored ${replaced.map((r) => r.tagName ?? "a replaced tier").join(", ")}`
        : "";
      return `Returned ${items.length} tag(s)${restoredNote} and refunded ${totalPoints} Tag Point(s).`;
    },
  },

  REMOVE_TAG: {
    editableFields: ["resourcesSpent"],
    async applyEdit(tx, request, edits) {
      const effect = { ...request.effect };
      const nextSpend = clampNonNegative(edits.resourcesSpent, effect.resourcesSpent);
      const delta = nextSpend - (effect.resourcesSpent ?? 0);
      if (delta === 0) return { effect, note: "No changes.", changed: false };
      await moveResources(tx, { kind: "character", id: request.characterId }, -delta);
      const note = `Resource cost ${effect.resourcesSpent ?? 0} -> ${nextSpend}.`;
      effect.resourcesSpent = nextSpend;
      return { effect, note, changed: true };
    },
    async undo(tx, request) {
      const { restore, tagName, resourcesSpent, granted = [] } = request.effect;
      // The removal's aftermath (Tag.removesInto) comes back off first —
      // same `added: 0 means it was already theirs` rule as CONSUME_TAG.
      for (const g of granted) {
        if (g.tagId && g.added > 0) await dropCharacterTag(tx, request.characterId, g.tagId, g.added);
      }
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
      const { restore, tagName, granted = [], resourcesGranted, cleared } = request.effect;
      for (const g of granted) {
        // `added: 0` means the character already held that tag and this
        // request left it alone — taking it away now would confiscate
        // something it never gave.
        if (g.tagId && g.added > 0) await dropCharacterTag(tx, request.characterId, g.tagId, g.added);
      }
      if (restore?.tagId) await restoreCharacterTag(tx, request.characterId, restore);
      // Eating a proper meal clears a noble's Disappointed on the spot
      // (requestActions.js#consumeTagRequestImpl) — so undoing the meal puts
      // it back, off the same kind of snapshot `restore` uses.
      if (cleared?.tagId) await restoreCharacterTag(tx, request.characterId, cleared);
      // The Resources half (Purse, Supply Kit) — debited back off the exact
      // snapshot, never re-derived from the tag's current catalog value.
      if (resourcesGranted) {
        await debitResources(tx, { kind: "character", id: request.characterId }, resourcesGranted, {
          note: `Undo of consume request ${request.id}`,
        });
      }
      const took = granted.filter((g) => g.added > 0).map((g) => formatStack(g.tagName, g.added));
      const notes = [];
      if (took.length) notes.push(`took back ${took.join(", ")}`);
      if (cleared?.tagId) notes.push(`re-applied ${cleared.tagName ?? "Disappointed"}`);
      if (resourcesGranted) notes.push(`took back ${resourcesGranted} ⬢`);
      return notes.length
        ? `Restored ${tagName ?? "the tag"} and ${notes.join(", ")}.`
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

      // Same guard as ADD_TAG.applyEdit: without it a second Confirm calls
      // dropCharacterTag again, and because this one passes no quantity it
      // deletes the whole row — confiscating a Drained the player picked up
      // from somewhere else in the meantime, which this request never granted.
      if (edits.removeDrained && effect.drainedTagId && !effect.drainedRemovedByGm) {
        await dropCharacterTag(tx, effect.targetCharacterId, effect.drainedTagId);
        notes.push(`Cleared Drained from ${effect.targetName ?? "the target"}.`);
        effect.drainedRemovedByGm = true;
      }

      return { effect, note: notes.join(" ") || "No changes.", changed: notes.length > 0 };
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
      if (next === previous) return { effect, note: "No changes.", changed: false };
      await moveBlood(tx, next - previous);
      effect.bloodDelta = next;
      return { effect, note: `Blood ${previous} -> ${next}.`, changed: true };
    },
    async undo(tx, request) {
      const { bloodDelta, targetName, killed } = request.effect;
      await moveBlood(tx, -(bloodDelta ?? 0));
      return killed
        ? `Drew back ${bloodDelta ?? 0} blood. ${targetName ?? "The target"} stays dead — revive them by hand if that was wrong.`
        : `Drew back ${bloodDelta ?? 0} blood.`;
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
      // The aftermath the treatment granted (Tag.removesInto) comes off with
      // it — no cure, no cast — behind the same flag.
      if (edits.restoreHealedTag && effect.restore?.tagId && !effect.tagRestoredByGm) {
        for (const g of effect.granted ?? []) {
          if (g.tagId && g.added > 0) await dropCharacterTag(tx, effect.targetCharacterId, g.tagId, g.added);
        }
        await restoreCharacterTag(tx, effect.targetCharacterId, effect.restore);
        notes.push(`Put ${effect.tagName ?? "the affliction"} back on ${effect.targetName ?? "the patient"}.`);
        effect.tagRestoredByGm = true;
      }

      return { effect, note: notes.join(" ") || "No changes.", changed: notes.length > 0 };
    },
    async undo(tx, request, ctx) {
      const { resourcesSpent, payer, restore, targetCharacterId, targetName, tagName, tagRestoredByGm, granted = [] } =
        request.effect;
      if (resourcesSpent) {
        await creditResources(tx, payer, resourcesSpent, { ...ctx, note: `Undo of heal request ${request.id}` });
      }
      if (restore?.tagId && targetCharacterId && !tagRestoredByGm) {
        // The aftermath the treatment granted comes off before the affliction
        // goes back on — same `added: 0` rule as CONSUME_TAG.
        for (const g of granted) {
          if (g.tagId && g.added > 0) await dropCharacterTag(tx, targetCharacterId, g.tagId, g.added);
        }
        await restoreCharacterTag(tx, targetCharacterId, restore);
      }
      return `Put ${tagName ?? "the affliction"} back on ${targetName ?? "the patient"} and refunded ${resourcesSpent ?? 0} ⬢ to ${payer?.name ?? "the payer"}.`;
    },
  },

  // A player-initiated rename. Nothing numeric to re-score, so Undo is the
  // only lever: put the previous honorific/first/last name (and the composed
  // `name`) back. Undo does NOT re-run the Discord role/nickname sync — no
  // network call may run inside this transaction (ARCHITECTURE.md §5) — so
  // Discord catches up the next time the player saves their Bio form, which
  // always re-syncs off the live DB name regardless of what changed.
  //
  // Older Request rows, from before renaming stopped costing a Mulligan
  // Potion, carry a `potionTagId`/`potionRestore` in their effect — undoing
  // one of those also gives the potion back, same idiom as CONSUME_TAG. New
  // requests carry neither key, so that step is skipped for them.
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
      return potionTagId
        ? `Restored the previous name (${previous?.name ?? "—"}) and gave back the Mulligan Potion.`
        : `Restored the previous name (${previous?.name ?? "—"}).`;
    },
  },

  // System-filed, not player-initiated — see db/lib/cavingPass.js. Same
  // apply-first-review-after shape as every other request, so a GM's Undo on
  // a Caving Die find works exactly like Undo on anything else.
  CAVING_LOOT: {
    editableFields: [],
    async undo(tx, request) {
      const { tagId, tagName, added } = request.effect;
      if (tagId && added > 0) await dropCharacterTag(tx, request.characterId, tagId, added);
      return `Took back ${formatStack(tagName, added)}.`;
    },
  },

  // --- The Depot (docs/systemdocs/DEPOT.md) ---------------------------
  // All three are wholesale between the Merchant and an orbital station that
  // is not a party in the game, so there is only ever ONE side to reverse —
  // no counterparty balance, no SiloTransaction. None is editable: ⬢ and
  // stock move together in one transaction, and a GM nudging the price on a
  // completed sale would leave the two out of step with no way back. Undo is
  // the whole correction, and it is exact because every number comes off the
  // snapshot rather than from re-reading a catalog price that may since have
  // been re-tuned.
  DEPOT_BUY: {
    editableFields: [],
    async undo(tx, request) {
      const { tagId, tagName, added, total } = request.effect;
      // `added` is what actually landed, which is not `quantity` for a
      // non-stackable tag he already held — grantTagSlugs' rule, and the
      // reason Undo may only ever take back what this request really put on
      // the sheet.
      //
      // The goods have to still BE there. dropCharacterTag returns quietly on
      // a missing row and takes only what remains from a short stack, so
      // refunding unconditionally would mint ⬢: buy 5 Sweets for 25, hand 3 to
      // a Docker, undo, and 25 ⬢ comes back for 2 units returned. Refuse
      // instead — the same posture DEPOT_SELL takes when the proceeds are
      // already spent. A GM who still wants it reversed can settle the
      // difference from the Dev Panel.
      if (tagId && added > 0) {
        const held = await tx.characterTag.findUnique({
          where: { characterId_tagId: { characterId: request.characterId, tagId } },
        });
        if ((held?.quantity ?? 0) < added) {
          throw new UserError(
            `${formatStack(tagName, added)} is no longer on their sheet — it has been spent, sold or handed on. Undo would refund ${total} ⬢ for goods that can't come back.`,
          );
        }
        await dropCharacterTag(tx, request.characterId, tagId, added);
      }
      await moveResources(tx, { kind: "character", id: request.characterId }, total);
      return `Returned ${formatStack(tagName, added)} to the Depot and refunded ${total} ⬢.`;
    },
  },

  DEPOT_SELL: {
    editableFields: [],
    async undo(tx, request) {
      const { tagName, total, restore, quantity } = request.effect;
      // Debit first. If he has already spent the proceeds this throws and
      // rolls the whole undo back, rather than handing the goods back for
      // free — the same posture TRANSFER_RESOURCES takes.
      await moveResources(tx, { kind: "character", id: request.characterId }, -total);
      if (restore?.tagId) {
        await restoreCharacterTag(tx, request.characterId, { ...restore, quantity });
      }
      return `Bought ${formatStack(tagName, quantity)} back off the Depot for ${total} ⬢.`;
    },
  },

  DEPOT_CREDIT: {
    editableFields: [],
    async undo(tx, request) {
      const { direction, amount } = request.effect;
      const draw = direction === "DRAW";
      // A draw put ⬢ in his pocket and the same number on the tab; a repayment
      // did both in reverse. Undoing a draw can therefore fail on the ⬢ if he
      // has already spent them, which is correct: the debt is not forgivable
      // by an Undo he cannot fund.
      await moveResources(tx, { kind: "character", id: request.characterId }, draw ? -amount : amount);
      await tx.character.update({
        where: { id: request.characterId },
        data: { depotDebt: { [draw ? "decrement" : "increment"]: amount } },
      });
      return draw
        ? `Called back the ${amount} ⬢ draw and cleared it off the tab.`
        : `Re-advanced the ${amount} ⬢ repayment and put it back on the tab.`;
    },
  },

  // Looting a living, incapacitated target. `request.characterId` is the
  // looter; `effect.targetCharacterId` is the person it came off — the same
  // "subject differs from filer" shape HEAL_CHARACTER documents above. Undo
  // takes every tag back off the looter and restores it to the target with
  // its original source/expiry, and reverses the ⬢.
  LOOT_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, tags = [], amount } = request.effect;
      for (const t of tags) {
        if (!t.tagId) continue;
        await dropCharacterTag(tx, request.characterId, t.tagId, t.quantity ?? 1);
        if (targetCharacterId) await restoreCharacterTag(tx, targetCharacterId, t);
      }
      if (amount && targetCharacterId) {
        await moveResources(tx, { kind: "character", id: request.characterId }, -amount);
        await moveResources(tx, { kind: "character", id: targetCharacterId }, amount);
      }
      const took = tags.map((t) => formatStack(t.tagName, t.quantity));
      const notes = [];
      if (took.length) notes.push(took.join(", "));
      if (amount) notes.push(`${amount} ⬢`);
      return notes.length
        ? `Returned ${notes.join(" and ")} to ${targetName ?? "the target"}.`
        : `Nothing to return to ${targetName ?? "the target"}.`;
    },
  },

  // Moving a character who follows the filer. Undo puts `Character.zoneId`
  // back to `fromZoneId` — DB only. It does NOT re-run the Discord zone-role
  // swap, matching CHANGE_NAME's documented posture: no network call may run
  // inside this transaction (ARCHITECTURE.md §5), so the moved player's
  // Discord channel access catches up the next time THEY make an ordinary
  // Move, which always re-syncs off the live DB zone.
  MOVE_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, fromZoneId } = request.effect;
      if (targetCharacterId) {
        await tx.character.update({ where: { id: targetCharacterId }, data: { zoneId: fromZoneId ?? null } });
      }
      return `Moved ${targetName ?? "them"} back to their previous zone. Discord access is not re-synced by Undo — it catches up on their next Move.`;
    },
  },

  // Putting a body in the ground. Undo raises it again, and says out loud what
  // it cannot do: the Cursed role was lifted off a Discord account, and no
  // network call may run inside this transaction (ARCHITECTURE.md §5), so
  // re-cursing is a GM's manual role edit. Same posture MOVE_CHARACTER and
  // CHANGE_NAME already document for their Discord halves.
  BURY_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName } = request.effect;
      if (targetCharacterId) {
        await tx.character.update({ where: { id: targetCharacterId }, data: { buriedAt: null } });
      }
      return `${targetName ?? "The body"} is out of the ground and lootable again. The Cursed role is NOT restored — re-add it in Discord if you want the curse back.`;
    },
  },

  // A horse ride. Undo returns the rider AND the ride: a hop that no longer
  // happened must not have burnt the once-a-day, so fastTravelTurnId goes back
  // to whatever it was before rather than to null, which would hand a free
  // second ride to someone who had already used one earlier the same day.
  // Every passenger goes back too — they share the rider's fromZoneId, so one
  // updateMany covers all of them; they never had their own fastTravelTurnId
  // to restore in the first place (see fastTravelRequestImpl).
  FAST_TRAVEL: {
    editableFields: [],
    async undo(tx, request) {
      const { fromZoneId, fromZoneName, previousFastTravelTurnId, passengers } = request.effect;
      await tx.character.update({
        where: { id: request.characterId },
        data: { zoneId: fromZoneId ?? null, fastTravelTurnId: previousFastTravelTurnId ?? null },
      });
      if (passengers?.length) {
        await tx.character.updateMany({
          where: { id: { in: passengers.map((p) => p.id) } },
          data: { zoneId: fromZoneId ?? null },
        });
      }
      const passengerNote = passengers?.length
        ? ` ${passengers.map((p) => p.name).join(" and ")} went back too.`
        : "";
      return `Sent back to ${fromZoneName ?? "where they started"}, and the ride is theirs again.${passengerNote} Discord access is not re-synced by Undo — it catches up on their next Move.`;
    },
  },

  // A sent DM cannot be recalled, so this is the one request type whose real
  // effect Undo cannot touch. What it CAN give back is the day — the letter is
  // once-a-day, and a GM who decides it should not have happened should not
  // also be taking the sender's turn away. The note says so rather than
  // implying the message was retrieved.
  BIRD_MESSAGE: {
    editableFields: [],
    async undo(tx, request) {
      const { previousBirdTurnId, recipientName, birdMessageId, delivered } = request.effect;
      await tx.character.update({
        where: { id: request.characterId },
        data: { birdTurnId: previousBirdTurnId ?? null },
      });
      // Closes the reply window too: the letter is retracted as far as the
      // game is concerned, so an answer to it should not still be arriving.
      if (birdMessageId) {
        await tx.birdMessage
          .update({ where: { id: birdMessageId }, data: { replyDeadlineTurn: null } })
          .catch(() => {});
      }
      return `The bird is theirs again.${
        delivered
          ? ` ${recipientName ?? "They"} already read it — a sent message can't be taken back, and any reply is now closed.`
          : ""
      }`;
    },
  },

  BIND_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, tagId } = request.effect;
      if (targetCharacterId && tagId) await dropCharacterTag(tx, targetCharacterId, tagId);
      return `Cut ${targetName ?? "them"} loose.`;
    },
  },
  FREE_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName } = request.effect;
      // restoreCharacterTag takes the whole snapshot, so the tag goes back
      // with the source and expiry it had rather than a fresh full duration.
      if (targetCharacterId) await restoreCharacterTag(tx, targetCharacterId, request.effect);
      return `Put ${targetName ?? "them"} back in their bonds.`;
    },
  },
  HARM_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, tagId, tagName, killed } = request.effect;
      if (targetCharacterId && tagId) await dropCharacterTag(tx, targetCharacterId, tagId);
      // Undo never revives, the same rule FEED_PERSON documents — a death a
      // GM confirmed by hand is not something the request that flagged it
      // gets to take back.
      const parts = [];
      if (tagId) parts.push(`Healed ${formatStack(tagName, 1)} on ${targetName ?? "them"}.`);
      if (killed) parts.push("They stay dead — Undo does not revive.");
      return parts.length ? parts.join(" ") : `Nothing to reverse on ${targetName ?? "them"}.`;
    },
  },
};

// A GM can only ever set a non-negative amount; anything else is a typo, and
// silently letting a negative through would mint resources (or Tag Points).
// "Fine Meal x3" / "the Manor" — GM-facing note text for a possibly-stacked
// tag. Quantity 1 (or absent) reads as a plain name, so nothing changes for
// the ordinary case.
export function formatStack(tagName, quantity) {
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
