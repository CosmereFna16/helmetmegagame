// Applies a character's standing conversation invites when they arrive in a
// Location — the second half of the /add contract: "invite anyone; they see
// the thread when they get here."
//
// Discord refuses (or quietly sheds) a thread member who can't view the
// parent channel, so /add records a PlayerThreadInvite row and every
// Location arrival replays the invites for that Location through this
// function. Pure REST (thread-member adds have no gateway-only form), so
// every travel path calls this same function rather than keeping copies.
//
// Takes `prisma` as a parameter — the db/lib/dm.js convention — and is
// deliberately not on the @lifeweb/db barrel; require it by path.
const { addThreadMember } = require("./discordRest");

async function applyPendingInvites(prisma, character) {
  if (!character?.locationId || !character.discordUserId) return 0;

  const invites = await prisma.playerThreadInvite.findMany({
    where: { characterId: character.id },
  });
  if (invites.length === 0) return 0;

  const threads = await prisma.playerThread.findMany({
    where: {
      threadId: { in: invites.map((i) => i.threadId) },
      locationId: character.locationId,
    },
    select: { threadId: true },
  });

  let applied = 0;
  for (const { threadId } of threads) {
    try {
      await addThreadMember(threadId, character.discordUserId);
      applied += 1;
    } catch (err) {
      // Best-effort: the next arrival (or the doctor) retries. Logged, never
      // swallowed silently.
      console.error(`Failed to apply thread invite ${threadId} for ${character.id}:`, err.message);
    }
  }
  return applied;
}

module.exports = { applyPendingInvites };
