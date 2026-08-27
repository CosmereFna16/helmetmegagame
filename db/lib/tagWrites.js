// Tag writes shared by both faces of the game.
//
// `dropCharacterTag` used to live in web/lib/requestEffects.js, which is ESM
// and therefore unreachable from the CommonJS bot. The GM `/heal` command
// needs it, so it moved here and requestEffects.js re-exports it — the same
// treatment web/lib/healRequests.js already gives
// @lifeweb/db/lib/medicalVision, and for the same reason: two
// implementations of a tag write would eventually disagree.
//
// Every function here takes a transaction client (`tx`) as its first
// parameter rather than reaching for the singleton, so a caller can compose
// it into a larger transaction. That is the db/lib/dm.js convention.

// Adds `quantity` of a tag, creating the row or incrementing an existing
// one. Non-stackable tags are pinned at 1 no matter what is asked for, so a
// caller that forgot to check `tag.stackable` can't mint a phantom stack.
//
// Moved down from web/lib/requestEffects.js (which re-exports it) for the
// same reason dropCharacterTag was: the staged-push pass in
// db/lib/stagedPush.js grants tags at turn end, and two implementations of a
// tag write would eventually disagree.
async function addToStack(tx, characterId, tagId, quantity, options = {}) {
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

// Removes `quantity` of a tag, deleting the row once nothing is left. Pass
// null (the default) to drop the whole holding however large the stack —
// that is what an ordinary, non-stackable tag always wants.
async function dropCharacterTag(tx, characterId, tagId, quantity = null) {
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId } },
  });
  if (!existing) return;
  const take = quantity == null ? existing.quantity : Math.max(1, Math.trunc(quantity));
  if (take >= existing.quantity) {
    await tx.characterTag.delete({ where: { id: existing.id } });
    return;
  }
  await tx.characterTag.update({
    where: { id: existing.id },
    data: { quantity: existing.quantity - take },
  });
}

module.exports = { addToStack, dropCharacterTag };
