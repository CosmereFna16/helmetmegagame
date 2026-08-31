const { prisma } = require("@lifeweb/db");
const { markPlayerDeparted } = require("@lifeweb/db/lib/playerDeparture");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("@lifeweb/db/lib/constants");

// A leave no longer kills the character. markPlayerDeparted flags them
// Catatonic and starts the death countdown (GameConfig.catatonicDeathTurns
// turns, resolved at turn close by db/lib/catatonicDeathPass.js); the full
// death cleanup — access revoke, role delete, unequip, DEATH archive — runs
// there, not here. Rejoining in time and speaking in character wakes them
// (guildMemberAdd.js clears leftGuildAt; the catatonic pass clears the tag).
//
// That is also why this handler no longer calls revokeAllCharacterAccess:
// per-member overwrites are inert for a non-member, Discord already stripped
// the zone roles with the membership, and there IS a second pass now — the
// death pass tears everything down if they never come back. (The old
// revoke-first-delete-second comment was written when the row was about to
// be soft-killed and nothing would ever look at it again.)
//
// Leaves the bot sleeps through are caught by the startup reconcile
// (bot/src/lib/leaveReconcile.js), which runs this same shared path.
module.exports = {
  name: "guildMemberRemove",
  async execute(member) {
    if (member.user?.bot) return;

    const playerName = member.user?.username ?? member.user?.tag ?? member.id;
    const result = await markPlayerDeparted(prisma, {
      discordUserId: member.id,
      username: playerName,
    });

    // The GM alert. Every failure is logged loudly — this used to be a pair
    // of bare .catch(() => {})s, which meant a deleted channel or a missing
    // permission made departures silently invisible to the GMs.
    const channel = await member.client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch((err) => {
      console.error(`Leave alert: cannot fetch #leave (${LEAVE_ANNOUNCE_CHANNEL_ID}):`, err.message);
      return null;
    });
    if (!channel?.isTextBased()) {
      console.error(`Leave alert: #leave is missing or not text-based — ${playerName}'s departure went unannounced.`);
    } else {
      await channel
        .send(result.alert)
        .catch((err) => console.error(`Leave alert send failed for ${playerName}:`, err.message));
    }

    // The grey "<name> • Catatonic" rename, so the member list shows the
    // absence at a glance. The role itself stays — it's held by nobody
    // (PROXYING.md §6), so keeping it leaks nothing, and @-mentions of the
    // character keep resolving while the body still stands.
    if (result.roleUpdate) {
      await member.guild.roles
        .edit(result.roleUpdate.roleId, { name: result.roleUpdate.name, color: result.roleUpdate.color })
        .catch((err) =>
          console.error(`Failed to mark ${result.character?.name}'s role catatonic on departure:`, err.message),
        );
    }
  },
};
