const { prisma } = require("@lifeweb/db");

module.exports = {
  name: "guildMemberAdd",
  async execute(member) {
    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: member.id,
        actionType: "member_joined",
        details: { username: member.user.tag },
      },
    });
  },
};
