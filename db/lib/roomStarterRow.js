// The buttons on a Room's starter post. Storage is on every one of them and
// prints what is lying in the room's stash (docs/systemdocs/CARRY.md);
// Intercom is on exactly one, the Council Room, and works the PA
// (db/lib/intercom.js); Toggle Turret is on exactly one other, the Censor's
// Office, and works the gun in the fortress yard
// (db/lib/gatehouseTurret.js). Raw component JSON for the same reason as
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
const DANGER = 4;

// The one room with a big red button on the wall (docs/zones.yaml). Named here
// rather than imported from gatehouseTurret.js because that module pulls in the
// whole turret engine, and this file is loaded by the sync to draw a row.
const CENSOR_OFFICE_ROOM_SLUG = "censors-office";

const ROOM_STORAGE_PREFIX = "room:storage:";
const ROOM_INTERCOM_PREFIX = "room:intercom:";
const ROOM_TURRET_PREFIX = "room:turret:";

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
  // Red, and the only red button in the game. It arms a gun that does not check
  // who anyone is, so it should not look like the others.
  if (room.slug === CENSOR_OFFICE_ROOM_SLUG) {
    components.push({
      type: BUTTON,
      style: DANGER,
      custom_id: `${ROOM_TURRET_PREFIX}${room.id}`,
      label: "Toggle Turret ‡",
    });
  }
  return { type: ACTION_ROW, components };
}

module.exports = {
  ROOM_STORAGE_PREFIX,
  ROOM_INTERCOM_PREFIX,
  ROOM_TURRET_PREFIX,
  CENSOR_OFFICE_ROOM_SLUG,
  roomStarterRow,
};
