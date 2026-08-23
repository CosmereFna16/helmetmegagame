const { prisma } = require("@lifeweb/db");
const { revokeAllCharacterAccess } = require("@lifeweb/db/lib/locationAccess");

const LEAVE_ANNOUNCE_CHANNEL_ID = "1540014692926361651";

module.exports = {
  name: "guildMemberRemove",
  async execute(member) {
    if (member.user?.bot) return;

    const character = await prisma.character.findFirst({
      where: { discordUserId: member.id, status: "ALIVE" },
      include: { role: true },
    });

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: member.id,
        actionType: "member_left",
        details: {
          username: member.user?.tag ?? member.id,
          characterName: character?.name ?? null,
        },
      },
    });

    const roleLabel = character?.roleTitle ?? character?.role?.name ?? "Unaffiliated";
    const playerName = member.user?.username ?? member.user?.tag ?? member.id;

    const channel = await member.client.channels
      .fetch(LEAVE_ANNOUNCE_CHANNEL_ID)
      .catch(() => null);
    if (channel?.isTextBased()) {
      await channel
        .send(
          character
            ? `${playerName} has left. Their character was ${character.name}, a ${roleLabel}.`
            : `${playerName} has left. They had no living character.`,
        )
        .catch(() => {});
    }

    if (!character) return;

    // Before the row goes: access is a per-member overwrite now, so deleting
    // the role no longer takes it with it. Once the Character row is gone
    // there is no id left to clean up with, and the overwrite would sit on
    // every channel forever — so revoke first, delete second.
    await revokeAllCharacterAccess(prisma, character).catch((err) =>
      console.error(`Failed to revoke access for departing member ${member.id}:`, err),
    );

    if (character.discordRoleId) {
      await member.guild.roles.delete(character.discordRoleId).catch(() => {});
    }

    await prisma.$transaction([
      prisma.note.deleteMany({ where: { characterId: character.id } }),
      prisma.defaultEffort.deleteMany({ where: { characterId: character.id } }),
      prisma.action.deleteMany({ where: { characterId: character.id } }),
      prisma.characterTag.deleteMany({ where: { characterId: character.id } }),
      prisma.character.delete({ where: { id: character.id } }),
    ]);
  },
};
