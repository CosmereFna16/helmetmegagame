// The buttons on a Room's starter post. Storage is on every one of them and
// prints what is lying in the room's stash (docs/systemdocs/CARRY.md);
// Intercom is on exactly one, the Council Room, and works the PA
// (db/lib/intercom.js). Raw component JSON for the same reason as
// locationAnchorRow.js — the sync posts it over REST from db/, which has no
// discord.js, while the bot answers the click.
//
// The room id rides in the custom_id so the handler needs no thread→Room
// lookup. Routed by prefix in bot/src/events/interactionCreate.js — change
// it here and you must change it there.
//
// This row is hashed into Room.postHash, so adding a button here is enough:
// the next db:sync-zones rewrites the one starter that changed and leaves the
// rest of them untouched.

const { INTERCOM_ROOM_SLUG } = require("./intercom");

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;

const ROOM_STORAGE_PREFIX = "room:storage:";
const ROOM_INTERCOM_PREFIX = "room:intercom:";

// `room` needs { id, slug }.
function roomStarterRow(room) {
  const components = [
    {
      type: BUTTON,
      style: SECONDARY,
      custom_id: `${ROOM_STORAGE_PREFIX}${room.id}`,
      label: "Storage ‡",
    },
  ];
  if (room.slug === INTERCOM_ROOM_SLUG) {
    components.push({
      type: BUTTON,
      style: SECONDARY,
      custom_id: `${ROOM_INTERCOM_PREFIX}${room.id}`,
      label: "Intercom ‡",
    });
  }
  return { type: ACTION_ROW, components };
}

module.exports = { ROOM_STORAGE_PREFIX, ROOM_INTERCOM_PREFIX, roomStarterRow };
