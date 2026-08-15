const { prisma } = require("@lifeweb/db");

async function syncFactionsForGuild(guild) {
  const roles = await guild.roles.fetch();
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  const turnPingRoleId = process.env.DISCORD_TURN_PING_ROLE_ID;

  for (const role of roles.values()) {
    if (role.id === guild.id) continue; // @everyone
    if (role.managed) continue; // bot/integration roles
    if (role.id === gmRoleId) continue; // administrative role, not a game faction
    if (role.id === turnPingRoleId) continue; // opt-in notification role, not a game faction

    await prisma.faction.upsert({
      where: { discordRoleId: role.id },
      update: { name: role.name },
      create: { name: role.name, discordRoleId: role.id },
    });
  }
}

module.exports = { syncFactionsForGuild };
