import { bumpBlood } from "@lifeweb/db";
import { addToStack, dropCharacterTag, grantTagSlugs, addToRoomStack, dropRoomTag } from "@lifeweb/db/lib/tagWrites";
import { moveParty, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import { UserError } from "@/lib/actionResult";

// Per-type behaviour of a Request: how a GM's Undo reverses it, and which
// fields (if any) a GM can Edit. Every function runs INSIDE a prisma
// transaction and reads only `request.effect`, never live state.

// --- shared primitives ------------------------------------------------

// Moves a party's balance by a signed delta and REFUSES rather than going
// negative — the write IS the check, a conditional update that only matches
// while the balance still covers the amount, safe under concurrent requests.
export async function moveResources(tx, party, delta) {
  try {
    await moveParty(tx, party, delta);
  } catch (err) {
    if (!(err instanceof InsufficientResourcesError)) throw err;
    if (party?.kind === "room") throw new UserError(`${party.name ?? "That room"} no longer holds ${err.amount} ⬢. ‡`);
    throw new UserError(`${party?.name ?? "That character"} no longer has ${err.amount} ⬢.`);
  }
}

// `ctx` used to feed the Silo ledger; it is accepted and ignored so the
// call sites read the same. A party of a kind moveParty doesn't know (an old
// row naming a faction Silo) is a silent no-op.
export async function creditResources(tx, party, amount) {
  if (!party || !amount) return;
  await moveResources(tx, party, amount);
}

export async function debitResources(tx, party, amount) {
  if (!party || !amount) return;
  await moveResources(tx, party, -amount);
}

async function moveBlood(tx, delta) {
  if (!delta) return;
  await bumpBlood(tx, delta);
}

// --- stacks -----------------------------------------------------------
// A stackable tag is ONE CharacterTag row carrying a count, never N rows.
// These four are the only writers that know about quantity.

export { addToStack };

// Restores a CharacterTag from a snapshot taken before removal. Uses an
// upsert since the player may have re-acquired it elsewhere; the update
// branch INCREMENTS rather than overwrites, since the snapshot quantity is
// what this request took away, not the character's total.
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

export { dropCharacterTag };
export { grantTagSlugs };
export { addToRoomStack, dropRoomTag };

// --- party-shaped tag moves ------------------------------------------
// A TRANSFER_TAG end is a character or a Room stash (CARRY.md); these two
// branch on `party.kind` so the undo never has to.

// Takes `quantity` of a tag off a party. A room's decrement is the check
// (two players can pull the same stack in the same tick); a character's
// holding was snapshotted when the request was filed.
export async function takeTagFrom(tx, party, tagId, quantity) {
  if (!party?.id || !tagId) return;
  if (party.kind === "room") {
    const ok = await dropRoomTag(tx, party.id, tagId, quantity);
    if (!ok) throw new UserError(`${party.name ?? "That room"} no longer holds that. ‡`);
    return;
  }
  await dropCharacterTag(tx, party.id, tagId, quantity);
}

// Puts a snapshot { tagId, quantity, expiresTurn, source } back on a party.
// Both branches INCREMENT and re-assert the snapshot's clock, so a stash-
// then-undo can't launder an expiry.
export async function giveTagTo(tx, party, snapshot) {
  if (!party?.id || !snapshot?.tagId) return;
  if (party.kind === "room") {
    await addToRoomStack(tx, party.id, snapshot.tagId, snapshot.quantity ?? 1, {
      expiresTurn: snapshot.expiresTurn ?? null,
    });
    return;
  }
  await restoreCharacterTag(tx, party.id, snapshot);
}

// --- per-type handlers ------------------------------------------------

export const REQUEST_EFFECTS = {
  FULFILL_DESIRE: {
    editableFields: ["pointsAwarded"],
    async applyEdit(tx, request, edits) {
      const effect = { ...request.effect };
      const previous = effect.pointsAwarded ?? 0;
      const next = clampNonNegative(edits.pointsAwarded, previous);
      if (next === previous) return { effect, note: "No changes.", changed: false };

      if (effect.playerClaimedPoints == null) effect.playerClaimedPoints = previous;

      await tx.character.update({
        where: { id: request.characterId },
        data: { tagPoints: { increment: next - previous } },
      });
      if (effect.desireId) {
        await tx.desire.updateMany({ where: { id: effect.desireId }, data: { points: next } });
      }
      effect.pointsAwarded = next;
      return { effect, note: `Tag Points ${previous} -> ${next}.`, changed: true };
    },
    async undo(tx, request) {
      const { desireId, pointsAwarded } = request.effect;
      if (pointsAwarded) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { tagPoints: { decrement: pointsAwarded } },
        });
      }
      if (desireId) {
        // Closed as CANCELLED with endedTurnNumber cleared — only an ended
        // row carrying a turn number locks a slot (desireGates.js#slotStates).
        await tx.desire.updateMany({
          where: { id: desireId },
          data: { status: "CANCELLED", endedTurnNumber: null },
        });
      }
      return `Revoked ${pointsAwarded} Tag Point(s) and released the slot.`;
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
        await moveResources(tx, effect.payer ?? { kind: "character", id: request.characterId }, -delta);
        notes.push(`Resource cost ${effect.resourcesSpent ?? 0} -> ${nextSpend}.`);
        effect.resourcesSpent = nextSpend;
      }

      if (edits.removeTag && effect.tagId && !effect.tagRemovedByGm) {
        // The `!tagRemovedByGm` guard stops a second Confirm from taking a
        // second unit off a stack the player built via other requests too.
        await dropCharacterTag(tx, request.characterId, effect.tagId, effect.quantity ?? 1);
        notes.push(`Removed ${formatStack(effect.tagName, effect.quantity)}.`);
        effect.tagRemovedByGm = true;
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
    async undo(tx, request) {
      const { tagId, tagName, resourcesSpent, quantity, replaced = [], payer = null, projectId = null } = request.effect;
      if (tagId && !request.effect.tagRemovedByGm) {
        await dropCharacterTag(tx, request.characterId, tagId, quantity ?? 1);
      }
      if (!request.effect.replacedRestored) {
        for (const snapshot of replaced) {
          await restoreCharacterTag(tx, request.characterId, snapshot);
        }
      }
      // A Craft row names who paid (docs/systemdocs/CRAFTING.md); an older
      // Add Tag row charged the character themselves.
      if (resourcesSpent) {
        await moveResources(tx, payer ?? { kind: "character", id: request.characterId }, resourcesSpent);
      }
      if (projectId) {
        await tx.craftProject.updateMany({ where: { id: projectId }, data: { status: "CANCELLED" } });
      }
      const restoredNote =
        !request.effect.replacedRestored && replaced.length
          ? `, restored ${replaced.map((r) => r.tagName ?? "a replaced tier").join(", ")},`
          : "";
      const refundNote = resourcesSpent ? ` and refunded ${resourcesSpent} ⬢ to ${payer?.name ?? "them"}` : "";
      return `Removed ${formatStack(tagName, quantity)}${restoredNote}${refundNote}.`;
    },
  },

  // The /store checkout. Prices are the catalog's, not the player's claim,
  // so the only GM verdict is Undo: the whole cart comes back off.
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
    // Destroy charges nothing; the edit path stays for rows filed when Remove
    // Tag still took a ⬢ spend.
    editableFields: [],
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

  CONSUME_TAG: {
    editableFields: [],
    async undo(tx, request) {
      const { restore, tagName, granted = [], resourcesGranted, cleared } = request.effect;
      for (const g of granted) {
        // added: 0 means the character already held the tag and this
        // request left it alone — nothing to take back.
        if (g.tagId && g.added > 0) await dropCharacterTag(tx, request.characterId, g.tagId, g.added);
      }
      if (restore?.tagId) await restoreCharacterTag(tx, request.characterId, restore);
      if (cleared?.tagId) await restoreCharacterTag(tx, request.characterId, cleared);
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

  // Either end may be a character or a Room stash. Rows filed before rooms
  // existed carry only the character ids, so `from`/`to` are synthesized
  // from those and nothing needs backfilling.
  TRANSFER_TAG: {
    editableFields: [],
    async undo(tx, request) {
      const e = request.effect;
      const n = e.quantity ?? 1;
      const from = e.from ?? (e.fromCharacterId ? { kind: "character", id: e.fromCharacterId, name: e.fromName } : null);
      const to = e.to ?? (e.toCharacterId ? { kind: "character", id: e.toCharacterId, name: e.toName } : null);
      if (to && e.tagId) await takeTagFrom(tx, to, e.tagId, n);
      if (from && e.tagId) await giveTagTo(tx, from, { tagId: e.tagId, ...(e.restore ?? {}), quantity: n });
      return `Moved ${formatStack(e.tagName, e.quantity)} back to ${from?.name ?? "its original holder"}.`;
    },
  },

  // Both Lifeweb types edit and undo the SNAPSHOT delta, never the nominal
  // amount — the pool caps at 100, so a "+40" that only moved 10 must
  // reverse 10 (db/lib/lifeweb.js#applyBlood).
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

  // Undo reverses the blood only — a character killed by hand stays dead.
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

  // `request.characterId` is the medic, `effect.targetCharacterId` the
  // patient — every tag write below takes the target's id.
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

      // A PENDING gambit heal never took the affliction off — it filed a Move
      // and left the patient exactly as they were — so there is nothing to put
      // back, and putting it back would hand them a second copy.
      if (edits.restoreHealedTag && effect.restore?.tagId && !effect.pending && !effect.tagRestoredByGm) {
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
      const {
        resourcesSpent,
        payer,
        restore,
        targetCharacterId,
        targetName,
        tagName,
        tagRestoredByGm,
        pending,
        granted = [],
      } = request.effect;
      if (resourcesSpent) {
        await creditResources(tx, payer, resourcesSpent, { ...ctx, note: `Undo of heal request ${request.id}` });
      }
      // A pending gambit attempt took nothing off, so there is nothing to put
      // back; only the fee is returned. The Move it filed stays — a GM who
      // wants that back uses Reject, the same rule Craft's auto-Actions follow.
      if (restore?.tagId && targetCharacterId && !pending && !tagRestoredByGm) {
        for (const g of granted) {
          if (g.tagId && g.added > 0) await dropCharacterTag(tx, targetCharacterId, g.tagId, g.added);
        }
        await restoreCharacterTag(tx, targetCharacterId, restore);
      }
      return pending
        ? `Called off the attempt on ${targetName ?? "the patient"}'s ${tagName ?? "affliction"} and refunded ${resourcesSpent ?? 0} ⬢ to ${payer?.name ?? "the payer"}.`
        : `Put ${tagName ?? "the affliction"} back on ${targetName ?? "the patient"} and refunded ${resourcesSpent ?? 0} ⬢ to ${payer?.name ?? "the payer"}.`;
    },
  },

  // Undo does NOT re-run the Discord role/nickname sync — no network call
  // may run inside this transaction (ARCHITECTURE.md §5); it catches up on
  // the player's next Bio save.
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

  CAVING_LOOT: {
    editableFields: [],
    async undo(tx, request) {
      const { tagId, tagName, added } = request.effect;
      if (tagId && added > 0) await dropCharacterTag(tx, request.characterId, tagId, added);
      return `Took back ${formatStack(tagName, added)}.`;
    },
  },

  // --- The Depot (docs/systemdocs/DEPOT.md) ---------------------------
  // Wholesale with an orbital station, not a party in the game — one side
  // only to reverse, and none of the three is editable.
  DEPOT_BUY: {
    editableFields: [],
    async undo(tx, request) {
      const { tagId, tagName, added, total } = request.effect;
      // Refuse if the goods aren't still there — refunding unconditionally
      // would mint ⬢ for units already spent, sold, or handed on.
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
      // Debit first — if the proceeds are already spent this throws and
      // rolls the whole undo back rather than handing the goods back free.
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

  // `request.characterId` is the looter; `effect.targetCharacterId` the
  // person looted.
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

  // Undo puts Character.locationId (and the zoneId denormalized off it)
  // back — DB only, no Discord role swap (ARCHITECTURE.md §5); it catches up
  // on the player's next Move.
  MOVE_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, fromLocationId, fromZoneId } = request.effect;
      if (targetCharacterId) {
        await tx.character.update({
          where: { id: targetCharacterId },
          data: { locationId: fromLocationId ?? null, zoneId: fromZoneId ?? null },
        });
      }
      return `Moved ${targetName ?? "them"} back to where they were. Discord access is not re-synced by Undo — it catches up on their next Move. ‡`;
    },
  },

  // Undo raises the body. The Cursed role was lifted off a Discord account,
  // and no network call may run inside this transaction — re-cursing is a
  // manual GM role edit.
  BURY_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, corpseTagId, corpseTagName, source } = request.effect;
      if (targetCharacterId) {
        await tx.character.update({ where: { id: targetCharacterId }, data: { buriedAt: null } });
      }
      // Burying consumes the corpse tag now, so an Undo has to put the body
      // back where it was taken FROM (CORPSES.md). Guarded on corpseTagId:
      // rows filed before corpses existed carry neither field and still undo
      // cleanly. The auto-filed Routine is deliberately left spent, which is
      // what ADD_TAG's undo already does for a craft.
      if (corpseTagId && source) {
        await giveTagTo(tx, source, { tagId: corpseTagId, quantity: 1, source: "EVENT", expiresTurn: null });
      }
      const body = corpseTagName ? ` ${corpseTagName} is back in ${source?.name ?? "their hands"}.` : "";
      return `${targetName ?? "The body"} is out of the ground and lootable again.${body} The Cursed role is NOT restored — re-add it in Discord if you want the curse back. Their Move stays spent.`;
    },
  },

  // Butchering destroys a body and makes an organ out of it, so the inverse is
  // a true inverse: the yield comes off the sheet and the corpse goes back to
  // whichever party it was taken from. Nothing to edit — a partial edit would
  // leave a half-cut body.
  BUTCHER_CORPSE: {
    editableFields: [],
    async undo(tx, request) {
      const { corpseTagId, corpseTagName, source, yieldTagId, yieldTagName, yieldExpiresTurn } =
        request.effect;
      if (yieldTagId) await dropCharacterTag(tx, request.characterId, yieldTagId, 1);
      if (corpseTagId && source) {
        await giveTagTo(tx, source, {
          tagId: corpseTagId,
          quantity: 1,
          source: "EVENT",
          expiresTurn: yieldExpiresTurn ?? null,
        });
      }
      return `Took ${yieldTagName ?? "the yield"} back, and ${corpseTagName ?? "the body"} is in ${source?.name ?? "their hands"} again.`;
    },
  },

  // Engraving is reversible in everything except the part that left the
  // database: the ⬢ come back, the stone comes off the sheet, the grave is
  // reopened — but the Cursed role was lifted by a REST call outside the
  // transaction and cannot be re-granted from in here. Same honesty
  // BIRD_MESSAGE's undo practises, and for the same reason.
  ENGRAVE_HEADSTONE: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, resourcesSpent, headstoneTagId, headstoneTagName } =
        request.effect;
      if (targetCharacterId) {
        await tx.character.update({ where: { id: targetCharacterId }, data: { buriedAt: null } });
      }
      if (headstoneTagId) await dropCharacterTag(tx, request.characterId, headstoneTagId, 1);
      if (resourcesSpent) {
        await creditResources(tx, { kind: "character", id: request.characterId }, resourcesSpent);
      }
      return `${headstoneTagName ?? "The headstone"} is gone and ${resourcesSpent ?? 0} ⬢ are back. ${
        targetName ?? "They"
      } count as unburied again — but the Cursed role is NOT restored; re-add it in Discord if you want the curse back. Their Move stays spent.`;
    },
  },

  // A sent DM can't be recalled — Undo can only give back the once-a-day
  // send, not the message itself.
  BIRD_MESSAGE: {
    editableFields: [],
    async undo(tx, request) {
      const { previousBirdTurnId, recipientName, birdMessageId, delivered } = request.effect;
      await tx.character.update({
        where: { id: request.characterId },
        data: { birdTurnId: previousBirdTurnId ?? null },
      });
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
      if (targetCharacterId) await restoreCharacterTag(tx, targetCharacterId, request.effect);
      return `Put ${targetName ?? "them"} back in their bonds.`;
    },
  },
  HARM_CHARACTER: {
    editableFields: [],
    async undo(tx, request) {
      const { targetCharacterId, targetName, tagId, tagName, killed } = request.effect;
      if (targetCharacterId && tagId) await dropCharacterTag(tx, targetCharacterId, tagId);
      const parts = [];
      if (tagId) parts.push(`Healed ${formatStack(tagName, 1)} on ${targetName ?? "them"}.`);
      if (killed) parts.push("They stay dead — Undo does not revive.");
      return parts.length ? parts.join(" ") : `Nothing to reverse on ${targetName ?? "them"}.`;
    },
  },
};

// A GM can only set a non-negative amount; anything else is a typo.
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
