const { prisma } = require("@lifeweb/db");

module.exports = {
  name: "guildRoleUpdate",
  async execute(oldRole, newRole) {
    await prisma.faction.updateMany({
      where: { discordRoleId: newRole.id },
      data: { name: newRole.name },
    });
  },
};
