// Removing a Character row and everything that points at it, in FK order.
//
// Shared by the two callers that need it: the GM Dev Panel's Delete
// microaction, and bot/src/events/guildMemberRemove.js when a player leaves
// the guild. Both used to hand-roll the list, and the bot's copy was WRONG —
// it deleted Note / DefaultEffort / Action / CharacterTag / Character and
// missed AuditLog, Request and Desire, all three of which carry a required or
// optional FK to Character with no onDelete rule. Any character who had ever
// had a Request adjudicated or a tag GM-granted therefore threw a Postgres
// foreign-key violation on the way out, rolling the whole transaction back and
// leaving the row behind.
//
// Two of the four dependents are DETACHED rather than deleted:
//
//   - AuditLog.targetCharacterId is nulled. The audit trail is the record of
//     what GMs did, and it must outlive its subject; details/actionType still
//     name them. Same snapshot-not-foreign-key posture ARCHITECTURE.md gives
//     the log tables.
//   - Note.characterId is nulled. Note.characterName is already a snapshot
//     column, so the transcript keeps reading correctly with the link gone.
//
// Discord cleanup is NOT done here. It has to happen before this runs, while
// the row still names the overwrites and the personal role, and it is a REST
// walk that must never sit inside a transaction — see ARCHITECTURE.md §5.
// Callers do it first; this is the database half only.
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

    // DefaultEffort carries TWO foreign keys to Character: the owner, and
    // setByCharacterId ("DefaultEffortSetBy") for a default someone else set.
    // Nothing writes the second as anyone but self today, so no row survives
    // to dangle — but this is exactly the class of miss that made the bot's
    // old list throw, and the first "a Leader sets a subordinate's default
    // effort" feature would resurrect it. Detach before deleting by owner.
    await tx.defaultEffort.updateMany({
      where: { setByCharacterId: characterId },
      data: { setByCharacterId: null },
    });
    await tx.defaultEffort.deleteMany({ where: { characterId } });
    await tx.action.deleteMany({ where: { characterId } });
    await tx.request.deleteMany({ where: { characterId } });
    await tx.desire.deleteMany({ where: { characterId } });
    await tx.characterTag.deleteMany({ where: { characterId } });

    return tx.character.delete({ where: { id: characterId } });
  });
}

module.exports = { deleteCharacterRow };
