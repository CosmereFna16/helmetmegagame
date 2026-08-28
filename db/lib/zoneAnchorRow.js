// The anchor buttons of the zone rework, as raw component JSON — the
// "Create a Topic" and "Who's here?" buttons on each public forum's pinned
// post, and the "Create" button on each #private channel's permanent
// message. "Who's here?" lives on the anchor only, never on a generated
// Location post — that keeps it to one button per forum instead of one per
// post.
//
// Plain JSON rather than discord.js builders for the same reason as
// db/lib/turnsConsoleRow.js: the sync posts these over REST from db/, which
// has no discord.js, while the bot answers the clicks over the gateway.
// One definition serves both faces.
//
// The zone id rides in the custom_id so the handlers need no channel→zone
// lookup. Routed by prefix in bot/src/events/interactionCreate.js —
// change a prefix here and you must change it there.

const ACTION_ROW = 1;
const BUTTON = 2;
const SECONDARY = 2;
const SUCCESS = 3;

const TOPIC_BUTTON_PREFIX = "topic:new:";
const PRIVATE_BUTTON_PREFIX = "priv:new:";
const WHOS_HERE_PREFIX = "zone:who:";

function whosHereButton(zoneId) {
  return {
    type: BUTTON,
    style: SUCCESS,
    custom_id: `${WHOS_HERE_PREFIX}${zoneId}`,
    label: "Who's here?",
  };
}

function createTopicRow(zoneId) {
  return {
    type: ACTION_ROW,
    components: [
      {
        type: BUTTON,
        style: SECONDARY,
        custom_id: `${TOPIC_BUTTON_PREFIX}${zoneId}`,
        label: "Create a Topic",
      },
      whosHereButton(zoneId),
    ],
  };
}

function createPrivateRow(zoneId) {
  return {
    type: ACTION_ROW,
    components: [
      {
        type: BUTTON,
        style: SECONDARY,
        custom_id: `${PRIVATE_BUTTON_PREFIX}${zoneId}`,
        label: "Create",
      },
    ],
  };
}

module.exports = {
  TOPIC_BUTTON_PREFIX,
  PRIVATE_BUTTON_PREFIX,
  WHOS_HERE_PREFIX,
  createTopicRow,
  createPrivateRow,
};
