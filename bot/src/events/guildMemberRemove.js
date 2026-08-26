const { prisma } = require("@lifeweb/db");
const { revokeAllCharacterAccess } = require("@lifeweb/db/lib/locationAccess");
const { recordArchiveEvent } = require("@lifeweb/db/lib/archive");

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
    // The result is checked rather than discarded. A revoke that silently did
    // nothing — the breaker refusing, a run of 429s — leaves a player who has
    // LEFT THE GUILD still holding a member overwrite on every room their
    // character stood in, and there is no second pass that would catch it: the
    // Character row is deleted a few lines below, taking the ids with it.
    const revoked = await revokeAllCharacterAccess(prisma, character).catch((err) => {
      console.error(`Failed to revoke access for departing member ${member.id}:`, err);
      return null;
    });
    if (!revoked || revoked.failed > 0) {
      await prisma.auditLog
        .create({
          data: {
            actorDiscordUserId: member.id,
            actorName: character.name,
            actionType: "access_revoke_incomplete",
            targetCharacterId: character.id,
            targetName: character.name,
            details: { failed: revoked?.failed ?? null, attempted: revoked?.attempted ?? null },
          },
        })
        .catch((err) => console.error("Failed to log an incomplete access revoke:", err));
    }

    if (character.discordRoleId) {
      // Logged rather than swallowed: an undeleted character role sits in the
      // guild forever with nothing to reap it, and the guild role cap is 250.
      await member.guild.roles
        .delete(character.discordRoleId)
        .catch((err) => console.error(`Failed to delete ${character.name}'s role on departure:`, err.message));
    }

    // Soft-kill rather than hard-delete: the character's tags and ⬢ stay on
    // the corpse so anyone standing in their last location can loot them, and
    // the row itself sticks around as history the way it does after any other
    // death. Same shape as web/lib/discordGuild.js#killCharacter — the Discord
    // side (role delete, access revoke) already ran above. Cursed grant is
    // skipped because the player has left the guild and it would 404.
    await prisma.character
      .update({
        where: { id: character.id },
        data: { status: "DEAD", discordRoleId: null },
      })
      .catch((err) => console.error(`Failed to soft-kill ${character.name} on departure:`, err));

    await prisma.characterTag
      .updateMany({
        where: { characterId: character.id, equipped: true },
        data: { equipped: false },
      })
      .catch((err) => console.error(`Failed to unequip ${character.name} on departure:`, err));

    await recordArchiveEvent(prisma, {
      kind: "DEATH",
      character,
      locationId: character.locationId ?? null,
      content: `${character.name} died — the player left the guild.`,
    }).catch((err) => console.error(`Failed to log ${character.name}'s death archive:`, err));
  },
};
