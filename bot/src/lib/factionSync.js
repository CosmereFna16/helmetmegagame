const { prisma } = require("@lifeweb/db");

async function syncFactionsForGuild(guild) {
  const roles = await guild.roles.fetch();

  for (const role of roles.values()) {
    if (role.id === guild.id) continue; // @everyone
    if (role.managed) continue; // bot/integration roles

    await prisma.faction.upsert({
      where: { discordRoleId: role.id },
      update: { name: role.name },
      create: { name: role.name, discordRoleId: role.id },
    });
  }
}

module.exports = { syncFactionsForGuild };
