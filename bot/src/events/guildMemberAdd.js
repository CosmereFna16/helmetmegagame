const { prisma } = require("@lifeweb/db");
const { syncMemberNickname } = require("../lib/nickname");

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

    // Covers rejoins where a character already exists from before they left.
    await syncMemberNickname(member).catch(() => {});
  },
};
