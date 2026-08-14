const { prisma } = require("@lifeweb/db");

module.exports = {
  name: "guildRoleDelete",
  async execute(role) {
    await prisma.faction.deleteMany({ where: { discordRoleId: role.id } });
  },
};
