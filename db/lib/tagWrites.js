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

module.exports = { dropCharacterTag };
