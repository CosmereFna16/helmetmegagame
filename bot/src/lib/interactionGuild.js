const { prisma } = require("@lifeweb/db");

// Every player-facing command is registered globally with a BotDM context
// (see bot/src/lib/commands.js), so `interaction.guild` and
// `interaction.member` are null whenever one is run from the bot's DMs.
// Lifeweb is single-guild, so the guild is recoverable from the environment —
// but no handler should reach for interaction.guild directly, or it works in
// a channel and throws in a DM.
//
// Returns { guild, member } with either possibly null: a null guild means
// DISCORD_GUILD_ID is unset or the bot is not in it, a null member means the
// player has left.
async function resolveActingMember(interaction) {
  const guild =
    interaction.guild ??
    interaction.client.guilds.cache.get(process.env.DISCORD_GUILD_ID) ??
    null;
  if (!guild) return { guild: null, member: null };

  const member =
    (interaction.guild ? interaction.member : null) ??
    guild.members.cache.get(interaction.user.id) ??
    (await guild.members.fetch(interaction.user.id).catch(() => null));

  return { guild, member };
}

// The GM gate. interaction.member is null in a DM, which would silently read
// as "not a GM" — that is the right answer (no GM command is DM-able, see
// commands.js), but it should be a decision rather than an accident.
function isGmMember(interaction) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!gmRoleId) return false;
  if (!interaction.inGuild()) return false;
  return interaction.member?.roles.cache.has(gmRoleId) ?? false;
}

async function findAliveCharacter(discordUserId) {
  return prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } });
}

module.exports = { resolveActingMember, isGmMember, findAliveCharacter };
