import { bumpBlood } from "@lifeweb/db";
import { addToStack, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
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
export async function moveResources(tx, party, delta) {
  if (!party || !delta) return;
  const character = party.kind === "character";
  if (!character && party.kind !== "faction") return;

  const model = character ? tx.character : tx.faction;
  const field = character ? "resources" : "silo";

  if (delta > 0) {
    await model.update({ where: { id: party.id }, data: { [field]: { increment: delta } } });
    return;
  }

  const amount = -delta;
  const { count } = await model.updateMany({
    where: { id: party.id, [field]: { gte: amount } },
    data: { [field]: { decrement: amount } },
  });
  if (count) return;

  throw new UserError(
    character
      ? `${party.name ?? "That character"} no longer has ${amount} ⬢.`
      : `The ${party.name ?? "faction"} Silo no longer has ${amount} ⬢.`,
  );
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
      const { restore, tagName, granted = [], resourcesGranted } = request.effect;
      for (const g of granted) {
        // `added: 0` means the character already held that tag and this
        // request left it alone — taking it away now would confiscate
        // something it never gave.
        if (g.tagId && g.added > 0) await dropCharacterTag(tx, request.characterId, g.tagId, g.added);
      }
      if (restore?.tagId) await restoreCharacterTag(tx, request.characterId, restore);
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
      if (edits.restoreHealedTag && effect.restore?.tagId && !effect.tagRestoredByGm) {
        await restoreCharacterTag(tx, effect.targetCharacterId, effect.restore);
        notes.push(`Put ${effect.tagName ?? "the affliction"} back on ${effect.targetName ?? "the patient"}.`);
        effect.tagRestoredByGm = true;
      }

      return { effect, note: notes.join(" ") || "No changes.", changed: notes.length > 0 };
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
