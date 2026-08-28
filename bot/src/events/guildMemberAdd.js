const { prisma } = require("@lifeweb/db");
const { syncMemberNickname } = require("../lib/nickname");

module.exports = {
  name: "guildMemberAdd",
  async execute(member) {
    // Caught so a failed log line can't skip the nickname sync below it —
    // same reasoning as guildMemberRemove.js, smaller stakes.
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId: member.id,
          actionType: "member_joined",
          details: { username: member.user.tag },
        },
      })
      .catch((err) => console.error(`Failed to log member_joined for ${member.id}:`, err));

    // Covers rejoins where a character already exists from before they left.
    await syncMemberNickname(member).catch(() => {});
  },
};
