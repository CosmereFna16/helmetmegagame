const { syncFactionsForGuild } = require("../lib/factionSync");

module.exports = {
  name: "guildCreate",
  async execute(guild) {
    console.log(`Joined guild ${guild.name} — syncing factions`);
    await syncFactionsForGuild(guild);
  },
};
