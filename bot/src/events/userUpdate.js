const { syncMemberNickname } = require("../lib/nickname");

// Fires the instant a Discord user's username/global name/avatar changes —
// re-syncs their nickname right away rather than waiting for the next bot
// restart, the same way guildRoleUpdate.js keeps Faction names live.
module.exports = {
  name: "userUpdate",
  async execute(oldUser, newUser) {
    for (const guild of newUser.client.guilds.cache.values()) {
      const member = guild.members.cache.get(newUser.id);
      if (member) await syncMemberNickname(member).catch(() => {});
    }
  },
};
