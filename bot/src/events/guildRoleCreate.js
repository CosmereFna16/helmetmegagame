const { prisma } = require("@lifeweb/db");

module.exports = {
  name: "guildRoleCreate",
  async execute(role) {
    if (role.managed) return;

    await prisma.faction.upsert({
      where: { discordRoleId: role.id },
      update: { name: role.name },
      create: { name: role.name, discordRoleId: role.id },
    });
  },
};
