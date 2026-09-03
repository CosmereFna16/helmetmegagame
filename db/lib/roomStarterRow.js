// The one button on every Room's starter post: Storage, which prints what is
// lying in the room's stash (docs/systemdocs/CARRY.md). Raw component JSON
// for the same reason as locationAnchorRow.js — the sync posts it over REST
// from db/, which has no discord.js, while the bot answers the click.
//
// The room id rides in the custom_id so the handler needs no thread→Room
// lookup. Routed by prefix in bot/src/events/interactionCreate.js — change
// it here and you must change it there.

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;

const ROOM_STORAGE_PREFIX = "room:storage:";

function roomStarterRow(roomId) {
  return {
    type: ACTION_ROW,
    components: [
      {
        type: BUTTON,
        style: SECONDARY,
        custom_id: `${ROOM_STORAGE_PREFIX}${roomId}`,
        label: "Storage ‡",
      },
    ],
  };
}

module.exports = { ROOM_STORAGE_PREFIX, roomStarterRow };
