const { prisma } = require("@lifeweb/db");
const { PLAYER_ROLE_ID } = require("@lifeweb/db/lib/roleIds");
const { LEAVE_ANNOUNCE_CHANNEL_ID } = require("@lifeweb/db/lib/constants");
const { syncMemberNickname } = require("../lib/nickname");
const { swapZoneRole, syncCharacterNarrowcastAccess } = require("../lib/zoneTravel");

module.exports = {
  name: "guildMemberAdd",
  async execute(member) {
    // Caught so a failed log line can't skip the sync work below it — same
    // reasoning as guildMemberRemove.js, smaller stakes.
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: member.id,
          actionType: "member_joined",
          details: { username: member.user.tag },
        },
      })
      .catch((err) => console.error(`Failed to log member_joined for ${member.id}:`, err));

    // Covers rejoins where a character already exists from before they left.
    await syncMemberNickname(member).catch(() => {});

    // A rejoining player whose character is still standing — Catatonic on a
    // death countdown since they left (playerDeparture.js). Discord stripped
    // every role with the membership, so without this re-grant they'd come
    // back to a server that shows them nothing. Clearing leftGuildAt is what
    // lets the catatonic pass's clear branch wake the character once they
    // speak or act in character again; the tag and the countdown stay until
    // then, on purpose — returning is not the same as waking.
    const character = await prisma.character
      .findFirst({
        where: { discordUserId: member.id, status: "ALIVE" },
        include: { zone: true },
      })
      .catch((err) => {
        console.error(`Rejoin lookup failed for ${member.id}:`, err);
        return null;
      });
    if (!character) return;

    // Captured before the clear: a rejoiner the departure machinery never
    // saw (left and returned inside one bot outage) still gets their roles
    // back below, but isn't announced as Catatonic when they aren't.
    const wasTrackedDeparted = character.leftGuildAt != null;
    if (wasTrackedDeparted) {
      await prisma.character
        .update({ where: { id: character.id }, data: { leftGuildAt: null } })
        .catch((err) => console.error(`Failed to clear leftGuildAt for ${character.name}:`, err));
    }

    await member.roles
      .add(PLAYER_ROLE_ID)
      .catch((err) => console.error(`Failed to re-grant Player to ${member.id}:`, err.message));
    // Old zone null — the leave stripped everything, so this is a pure
    // re-grant with nothing to move away from, the same shape Revive uses
    // (CHARACTERS.md §5b). Turn-ping and the like are left to the channel
    // doctor's next cheap pass.
    await swapZoneRole(member.guild, member.id, null, character.zone).catch((err) =>
      console.error(`Failed to restore ${character.name}'s zone role on rejoin:`, err.message),
    );
    await syncCharacterNarrowcastAccess(member.guild, character).catch((err) =>
      console.error(`Failed to restore ${character.name}'s narrowcast access on rejoin:`, err.message),
    );

    if (wasTrackedDeparted) {
      const channel = await member.client.channels.fetch(LEAVE_ANNOUNCE_CHANNEL_ID).catch(() => null);
      if (channel?.isTextBased()) {
        await channel
          .send(`${member.user.username} rejoined — ${character.name} is still **Catatonic** until they speak.`)
          .catch((err) => console.error(`Rejoin alert send failed for ${member.id}:`, err.message));
      }
    }
  },
};
