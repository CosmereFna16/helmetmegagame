// Outbound DirectMessage sources that are bot/system-generated, canned text
// about something that happened — not a GM typing to a player. Kept separate
// from web/lib/dmThread.js so DmThread.js (a client component) can import
// this list without dragging @lifeweb/db's Prisma import into the bundle.
//
// staged_push is deliberately excluded: it's GM-authored turn-result prose,
// just delivered in bulk rather than typed live — see DmThread.js's comment
// on why it never collapses.
export const AUTOMATED_EFFECT_SOURCES = ["bot_auto", "player_event", "gm_dev", "move_unlock"];
