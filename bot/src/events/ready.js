const cron = require("node-cron");
const { prisma } = require("@lifeweb/db");
const { syncFactionsForGuild } = require("../lib/factionSync");
const { syncNicknamesForGuild } = require("../lib/nickname");
const { advanceTurn } = require("../lib/turnEngine");

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
      await syncNicknamesForGuild(guild).catch((err) => console.error("Failed to sync nicknames:", err));
    }

    const runAdvanceTurn = () => {
      advanceTurn(client)
        .then((turn) => console.log(`Turn advanced to #${turn.number} (${turn.phase})`))
        .catch((err) => console.error("Failed to advance turn:", err));
    };
    cron.schedule("0 5 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
    cron.schedule("0 17 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
  },
};
