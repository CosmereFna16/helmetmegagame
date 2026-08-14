const { prisma } = require("@lifeweb/db");
const { syncFactionsForGuild } = require("../lib/factionSync");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    await prisma.gameConfig.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });

    for (const guild of client.guilds.cache.values()) {
      await syncFactionsForGuild(guild);
      console.log(`Synced factions for guild ${guild.name}`);
    }
  },
};
