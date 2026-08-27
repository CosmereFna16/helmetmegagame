// The #turns console buttons, as raw component JSON.
//
// Plain JSON rather than discord.js builders because both faces need it and
// only one of them has discord.js: db/lib/turnAnnouncement.js posts the
// console over REST (it is called by the web Dev Panel's End Turn as well as
// the bot's cron), while bot/src/lib/turnsConsole.js posts it over the
// gateway. discord.js accepts raw component JSON in channel.send({components})
// exactly as the API does, so one definition serves both — the alternative
// was two button lists that must be kept identical by hand, which is the
// twin-drift ARCHITECTURE.md §3 warns about.
//
// The customIds are routed by exact equality in
// bot/src/events/interactionCreate.js — change one here and you must change it
// there.

const BUTTON = 2;
const ACTION_ROW = 1;
const SECONDARY = 2;

const MOVE_EMOJI = "⚜️";

const TURNS_CONSOLE_ROW = {
  type: ACTION_ROW,
  components: [
    { type: BUTTON, style: SECONDARY, custom_id: "loc:open", label: "Travel", emoji: { name: "🗺️" } },
    { type: BUTTON, style: SECONDARY, custom_id: "move:open", label: "Move", emoji: { name: MOVE_EMOJI } },
    { type: BUTTON, style: SECONDARY, custom_id: "say:open", label: "Speak", emoji: { name: "🔊" } },
  ],
};

// Sits under the turn announcement, so it reads as "given the above, what
// now?" rather than as a heading of its own.
const CONSOLE_TEXT =
  "-# You can only travel to a connected zone, and it spends your Move for the turn.";

module.exports = { TURNS_CONSOLE_ROW, CONSOLE_TEXT, MOVE_EMOJI };
