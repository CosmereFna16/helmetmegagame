// Removing a Character row and everything that points at it, in FK order.
// Shared by the Dev Panel's Delete microaction and
// bot/src/events/guildMemberRemove.js. AuditLog, Request and Desire carry FKs
// to Character with no onDelete rule, so a missed one throws a Postgres FK
// violation and rolls back the transaction.
//
// AuditLog.targetCharacterId and Note.characterId are nulled, not deleted —
// both keep snapshot columns (name, details) so they still read correctly.
//
// Discord cleanup happens BEFORE this runs (a REST walk, never inside a
// transaction — ARCHITECTURE.md §5); this is the database half only.
async function deleteCharacterRow(prisma, characterId) {
  return prisma.$transaction(async (tx) => {
    await tx.auditLog.updateMany({
      where: { targetCharacterId: characterId },
      data: { targetCharacterId: null },
    });
    await tx.note.updateMany({
      where: { characterId },
      data: { characterId: null },
    });

    await tx.action.deleteMany({ where: { characterId } });
    await tx.request.deleteMany({ where: { characterId } });
    await tx.desire.deleteMany({ where: { characterId } });
    await tx.characterTag.deleteMany({ where: { characterId } });

    return tx.character.delete({ where: { id: characterId } });
  });
}

module.exports = { deleteCharacterRow };
