require("dotenv").config();
const path = require("node:path");
const fs = require("node:fs");
const { Client, GatewayIntentBits, Partials } = require("discord.js");

// Stay alive on an unhandled rejection instead of letting Node kill the
// process. This is a rate-limit measure as much as an uptime one: Railway
// restarts a crashed container immediately, and every `ready` replays the full
// catch-up burst (refreshLocationChannels, syncNicknamesForGuild,
// ensureTurnsConsole, global command registration — bot/src/events/ready.js).
// A crash loop is therefore the one shape in this codebase that can sustain
// the ~17 invalid-responses/second for ten minutes that trips Discord's
// Cloudflare IP ban; every other path is sequential and bounded. Logging and
// continuing turns "banned for an hour at 4am" into one stderr line.
//
// uncaughtException is deliberately handled the same way rather than
// re-thrown: by the time it fires the gateway connection is usually still
// healthy, and a half-broken bot that keeps serving is better here than a
// restart storm. db/lib/discordRest.js#discordRequest carries a circuit
// breaker as the second line of defence if this assumption is ever wrong.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (staying alive):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (staying alive):", err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// One guard for every handler, rather than a try/catch inside each of them.
//
// messageReactionAdd, guildMemberAdd, guildMemberRemove and messageCreate all
// had unguarded main paths, so any Prisma hiccup rejected all the way up to
// the unhandledRejection catch-all below — which keeps the bot alive but says
// nothing useful and leaves the interaction half-done. The visible symptom was
// a player's 🔍 sitting on a message doing nothing, with no retry, because
// `reaction.users.remove` never ran.
//
// Naming the event in the log is the point: the catch-all can't, and "which
// handler was that" is the first question every time.
function guard(event, args) {
  return Promise.resolve()
    .then(() => event.execute(...args))
    .catch((err) => console.error(`${event.name} handler failed:`, err));
}

const eventsDir = path.join(__dirname, "events");
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith(".js"))) {
  const event = require(path.join(eventsDir, file));
  if (event.once) {
    client.once(event.name, (...args) => guard(event, args));
  } else {
    client.on(event.name, (...args) => guard(event, args));
  }
}

client.login(process.env.DISCORD_TOKEN);
