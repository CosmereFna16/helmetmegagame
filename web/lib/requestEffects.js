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

async function creditResources(tx, party, amount, ctx) {
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

async function debitResources(tx, party, amount, ctx) {
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

// Restores a CharacterTag from a snapshot taken before it was removed. Uses
// an upsert because a player may well have re-acquired the tag by other means
// between the request and the GM getting to it.
function restoreCharacterTag(tx, characterId, snapshot) {
  return tx.characterTag.upsert({
    where: { characterId_tagId: { characterId, tagId: snapshot.tagId } },
    create: {
      characterId,
      tagId: snapshot.tagId,
      source: snapshot.source ?? "GM_GRANT",
      expiresTurn: snapshot.expiresTurn ?? null,
    },
    update: { expiresTurn: snapshot.expiresTurn ?? null },
  });
}

function dropCharacterTag(tx, characterId, tagId) {
  return tx.characterTag.deleteMany({ where: { characterId, tagId } });
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
        await dropCharacterTag(tx, request.characterId, effect.tagId);
        notes.push(`Removed ${effect.tagName ?? "the tag"}.`);
        effect.tagRemovedByGm = true;
      }

      return { effect, note: notes.join(" ") || "No changes." };
    },
    async undo(tx, request, ctx) {
      const { tagId, tagName, resourcesSpent } = request.effect;
      if (tagId && !request.effect.tagRemovedByGm) await dropCharacterTag(tx, request.characterId, tagId);
      if (resourcesSpent) {
        await tx.character.update({
          where: { id: request.characterId },
          data: { resources: { increment: resourcesSpent } },
        });
      }
      return `Removed ${tagName ?? "the tag"} and refunded ${resourcesSpent ?? 0} ⬢.`;
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
      return `Restored ${tagName ?? "the tag"} and refunded ${resourcesSpent ?? 0} ⬢.`;
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
      const { tagId, tagName, fromCharacterId, toCharacterId, restore } = request.effect;
      if (toCharacterId && tagId) await dropCharacterTag(tx, toCharacterId, tagId);
      if (fromCharacterId && tagId) {
        await restoreCharacterTag(tx, fromCharacterId, { tagId, ...(restore ?? {}) });
      }
      return `Moved ${tagName ?? "the tag"} back to its original holder.`;
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
};

// A GM can only ever set a non-negative amount; anything else is a typo, and
// silently letting a negative through would mint resources (or Tag Points).
function clampNonNegative(raw, fallback) {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 0) return fallback ?? 0;
  return n;
}

export function editableFieldsFor(type) {
  return REQUEST_EFFECTS[type]?.editableFields ?? [];
}
