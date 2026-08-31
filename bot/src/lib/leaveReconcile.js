// The startup catch-up for departures the bot slept through. The
// guildMemberRemove handler only fires while the gateway is connected, so a
// player who left during a restart or outage used to vanish without an
// alert, an audit row, or any cleanup — forever. This pass diffs the living
// roster against actual guild membership on every ready and runs the same
// shared departure path (db/lib/playerDeparture.js) for anyone missed.
//
// Ordering: called from ready.js AFTER the channel doctor and the nickname
// sync, so the doctor's REST burst is finished before this posts anything.
// The two can't fight over a leaver in either order — the doctor's role
// reconcile skips any user absent from the member map.
//
// Idempotent via the `leftGuildAt: null` filter: a restart loop re-alerts
// nobody. Players who left with no living character are deliberately out of
// scope — there is no row to mark, so they'd re-alert on every boot.
const { prisma } = require("@lifeweb/db");
const { markPlayerDeparted } = require("@lifeweb/db/lib/playerDeparture");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("@lifeweb/db/lib/constants");

async function reconcileDepartures(client, guild) {
  // Gateway fetch, not REST: it rides the shard connection, costs nothing
  // against the request budget, and returns the full collection or throws.
  const members = await guild.members.fetch();

  const alive = await prisma.character.findMany({
    where: { status: "ALIVE", leftGuildAt: null },
    select: { id: true, name: true, discordUserId: true },
  });
  const candidates = alive.filter((character) => !members.has(character.discordUserId));

  // The hard rail. The single worst outcome of this pass is a truncated or
  // empty member fetch reading as a mass exodus and putting half the living
  // roster on a death countdown. An empty guild is never real here, and more
  // than a handful of simultaneous unnoticed leaves means the data is wrong,
  // not the players gone — bail loudly and touch nothing.
  const limit = Math.max(5, Math.ceil(alive.length * 0.2));
  if (members.size === 0 || candidates.length > limit) {
    const message =
      `Leave reconcile ABORTED: ${candidates.length} of ${alive.length} living characters ` +
      `look departed against a member list of ${members.size}. That smells like a bad fetch, ` +
      `not a mass exodus — nobody was flagged.`;
    console.error(message);
    const channel = await client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased()) await channel.send(`⚠ ${message}`).catch(() => {});
    return { checked: alive.length, flagged: 0, aborted: true };
  }

  if (candidates.length === 0) return { checked: alive.length, flagged: 0, aborted: false };

  const channel = await client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch((err) => {
    console.error(`Leave reconcile: cannot fetch #leave (${LEAVE_ANNOUNCE_CHANNEL_ID}):`, err.message);
    return null;
  });

  let flagged = 0;
  for (const candidate of candidates) {
    try {
      const result = await markPlayerDeparted(prisma, {
        discordUserId: candidate.discordUserId,
        username: null, // the account is gone; the character name carries the alert
        viaReconcile: true,
      });
      flagged += 1;
      if (channel?.isTextBased()) {
        await channel
          .send(`[caught at startup] ${result.alert}`)
          .catch((err) => console.error(`Leave reconcile alert failed for ${candidate.name}:`, err.message));
      }
      if (result.roleUpdate) {
        await guild.roles
          .edit(result.roleUpdate.roleId, { name: result.roleUpdate.name, color: result.roleUpdate.color })
          .catch((err) =>
            console.error(`Leave reconcile: failed to mark ${candidate.name}'s role catatonic:`, err.message),
          );
      }
    } catch (err) {
      console.error(`Leave reconcile failed for ${candidate.name} (${candidate.discordUserId}):`, err);
    }
  }

  console.log(`Leave reconcile: ${flagged} departed player(s) caught up (${alive.length} living characters checked).`);
  return { checked: alive.length, flagged, aborted: false };
}

module.exports = { reconcileDepartures };
