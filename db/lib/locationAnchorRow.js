// The buttons on every Location channel's pinned anchor message, as raw
// component JSON: Who's here?, Secret rooms?, Converse — plus one Open/Close
// button per modular gate touching this location, on a second row.
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
const DANGER = 4;

const WHOS_HERE_PREFIX = "loc:who:";
const SECRET_ROOMS_PREFIX = "loc:secret:";
const CONVERSE_PREFIX = "loc:converse:";
const GATE_PREFIX = "loc:gate:";

// Discord's cap on buttons in one action row, and on a button label.
const ROW_BUTTON_LIMIT = 5;
const LABEL_MAX = 80;

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

// One button per modular gate on this location, or null when it has none —
// an action row with no components is rejected by Discord.
//
// The label names the far side, because a location can hold two gates and
// "Close" alone would be a coin flip. The verb is what the click DOES, not
// what the gate currently is: a way standing open offers "Close".
//
// The link id rides in the custom_id, so the handler needs no lookup from
// channel to location to edge. `gates` is [{ linkId, isOpen, farName }],
// built by whoever has the links loaded.
function locationGateRow(gates) {
  const shown = (gates ?? []).slice(0, ROW_BUTTON_LIMIT);
  if (shown.length === 0) return null;
  return {
    type: ACTION_ROW,
    components: shown.map((gate) => ({
      type: BUTTON,
      // Danger on the one that shuts a way, so a misclick reads as one.
      style: gate.isOpen ? DANGER : SUCCESS,
      custom_id: `${GATE_PREFIX}${gate.linkId}`,
      label: `${gate.isOpen ? "Close" : "Open"} the way to ${gate.farName} ‡`.slice(0, LABEL_MAX),
    })),
  };
}

module.exports = {
  WHOS_HERE_PREFIX,
  SECRET_ROOMS_PREFIX,
  CONVERSE_PREFIX,
  GATE_PREFIX,
  locationAnchorRow,
  locationGateRow,
};
