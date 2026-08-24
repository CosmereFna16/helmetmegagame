const cron = require("node-cron");
const { ActivityType } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { syncNicknamesForGuild } = require("../lib/nickname");
const { advanceTurn } = require("../lib/turnEngine");
const { ensureTurnsConsole } = require("../lib/turnsConsole");
const { refreshLocationChannels } = require("../lib/channels");
const { registerCommands } = require("../lib/commands");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
      activities: [{ name: "status", type: ActivityType.Custom, state: "» Message me to contact the GMs." }],
      status: "online",
    });

    await prisma.gameConfig
      .upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1 },
      })
      .catch((err) => console.error("Failed to upsert GameConfig:", err));

    await refreshLocationChannels().catch((err) => console.error("Failed to refresh location channels:", err));

    for (const guild of client.guilds.cache.values()) {
      await syncNicknamesForGuild(guild).catch((err) => console.error("Failed to sync nicknames:", err));
      await ensureTurnsConsole(guild).catch((err) => console.error("Failed to ensure turns console:", err));
    }

    // Global, not per-guild: a guild command can never appear in the bot's
    // DMs. The cost is propagation — a new or renamed command can take up to
    // an hour to show up. See bot/src/lib/commands.js.
    await registerCommands(client).catch((err) => console.error("Failed to register slash commands:", err));

    const runAdvanceTurn = () => {
      console.log("Turn-advance cron fired.");
      advanceTurn()
        .then((turn) =>
          // Null when a GM's Dev Panel advance won the race — the turn moved,
          // just not here. Not a failure, so don't log it as one.
          console.log(turn ? `Turn advanced to #${turn.number} (${turn.phase})` : "Turn already advanced elsewhere; skipped."),
        )
        .catch((err) => console.error("Failed to advance turn:", err));
    };
    cron.schedule("0 4 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
    cron.schedule("0 16 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
  },
};
