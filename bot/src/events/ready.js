const cron = require("node-cron");
const { ActivityType } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  getInvalidResponseStats,
  loadBreakerState,
  recordInvalidResponse,
} = require("@lifeweb/db/lib/discordRest");
const { syncNicknamesForGuild } = require("../lib/nickname");
const { advanceTurn } = require("../lib/turnEngine");
const { ensureTurnsConsole } = require("../lib/turnsConsole");
const { ensureReportAnchor } = require("../lib/reportChannel");
const { refreshLocationChannels } = require("../lib/channels");
const { registerCommands } = require("../lib/commands");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log(`Logged in as ${client.user.tag}`);

    // Awaited, and BEFORE the listener below: the fire-and-forget load inside
    // recordInvalidResponse marks itself done the moment it starts, so a
    // response arriving first would leave this call returning empty-handed.
    // The whole point of the health line below is to report what the LAST
    // process left behind.
    await loadBreakerState();

    // discord.js runs its own REST manager, so everything the gateway client
    // does — the ~130 nickname syncs below, every channel permission edit,
    // every proxy send — was invisible to the breaker, which only ever saw
    // db/lib/discordRest.js's traffic. Both halves share one egress IP and one
    // Cloudflare counter, so counting half of it against a whole-IP ceiling
    // was always going to under-report.
    //
    // discord.js clones the Response when anything is listening on this event.
    // That is a real per-request cost, and it is paid deliberately: only the
    // status is read, never the body, and knowing the true count is worth more
    // than the clone. The `rateLimited` event would be free but fires on
    // pre-emptive waits that never produced a 429, which is the wrong number.
    client.rest.on("response", (request, response) => {
      const status = response?.status;
      if (status === 401 || status === 403 || status === 429) {
        recordInvalidResponse(status, request?.path ?? request?.route ?? "unknown");
      }
    });

    // Printed on every connect so a climbing invalid-response count is visible
    // while it is still a number, not after it has become an hour-long
    // Cloudflare IP ban. A non-zero value here right after startup means the
    // previous process died mid-burst — see db/lib/discordRest.js.
    const restStats = getInvalidResponseStats();
    console.log(
      `Discord REST health: ${restStats.invalidInWindow}/${restStats.limit} invalid responses in the last 10m` +
        (restStats.breakerOpen ? ` — BREAKER OPEN until ${restStats.breakerOpenUntil}` : ""),
    );

    client.user.setPresence({
      // Discord renders no markdown and makes no links in a custom status, so
      // the Handbook is written as a bare URL players can read and type.
      activities: [
        {
          name: "status",
          type: ActivityType.Custom,
          state: "#questions | ravenheart.quest/handbook",
        },
      ],
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

    // The cheap reconciliation pass: role membership (zone, turn-ping,
    // no-romance, cursed) and structural drift, repaired against the DB. A
    // handful of requests regardless of roster size, so it's safe on every
    // restart — this is what catches whatever a wipe, a crash or a
    // rate-limited swap left behind (db/lib/channelDoctor.js).
    {
      const { runChannelDoctor } = require("@lifeweb/db/lib/channelDoctor");
      await runChannelDoctor(prisma, { apply: true, scope: "cheap" })
        .then((r) => {
          if (r.findings.length > 0) {
            console.log(`Channel doctor: ${r.findings.length} finding(s), ${r.repaired} repaired.`);
          }
        })
        .catch((err) => console.error("Channel doctor pass failed:", err));
    }

    for (const guild of client.guilds.cache.values()) {
      await syncNicknamesForGuild(guild).catch((err) => console.error("Failed to sync nicknames:", err));
      await ensureTurnsConsole(guild).catch((err) => console.error("Failed to ensure turns console:", err));
      await ensureReportAnchor(guild).catch((err) => console.error("Failed to ensure report anchor:", err));
      // Warms client.channels.cache with every active thread, private ones
      // included. GUILD_CREATE only ships a thread the bot is already a
      // member of, so without this a fresh boot never learns about a private
      // thread it hasn't posted in since — and a reaction on it never fires
      // messageReactionAdd at all (Partials.Channel resolves an uncached id
      // to a typeless payload, which ChannelManager can't turn into a
      // channel). A thread created after this boot still needs the
      // per-reaction fallback in messageReactionAdd.js.
      await guild.channels.fetchActiveThreads().catch((err) => console.error("Failed to warm thread cache:", err));
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
    // Noon and midnight Chicago time — the staged-arbitration push rides the
    // turn advance, and these are the hours with the best player overlap.
    cron.schedule("0 0 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
    cron.schedule("0 12 * * *", runAdvanceTurn, { timezone: "America/Chicago" });
  },
};
