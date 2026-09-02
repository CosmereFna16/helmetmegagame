// The three buttons on every Location channel's pinned anchor message, as
// raw component JSON: Who's here?, Secret rooms?, Converse.
//
// Plain JSON rather than discord.js builders for the same reason as
// db/lib/turnsConsoleRow.js: the sync posts these over REST from db/, which
// has no discord.js, while the bot answers the clicks over the gateway.
// One definition serves both faces.
//
// The location id rides in the custom_id so the handlers need no
// channel→location lookup. Routed by prefix in
// bot/src/events/interactionCreate.js — change a prefix here and you must
// change it there.

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const SUCCESS = 3;

const WHOS_HERE_PREFIX = "loc:who:";
const SECRET_ROOMS_PREFIX = "loc:secret:";
const CONVERSE_PREFIX = "loc:converse:";

function locationAnchorRow(locationId) {
  return {
    type: ACTION_ROW,
    components: [
      {
        type: BUTTON,
        style: SUCCESS,
        custom_id: `${WHOS_HERE_PREFIX}${locationId}`,
        label: "Who's here? ‡",
      },
      {
        type: BUTTON,
        style: SECONDARY,
        custom_id: `${SECRET_ROOMS_PREFIX}${locationId}`,
        label: "Secret rooms? ‡",
      },
      {
        type: BUTTON,
        style: SECONDARY,
        custom_id: `${CONVERSE_PREFIX}${locationId}`,
        label: "Converse ‡",
      },
    ],
  };
}

module.exports = {
  WHOS_HERE_PREFIX,
  SECRET_ROOMS_PREFIX,
  CONVERSE_PREFIX,
  locationAnchorRow,
};
