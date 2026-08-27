// The two anchor buttons of the zone rework, as raw component JSON — the
// "Create a Topic" button on each public forum's pinned post, and the
// "Create" button on each #private channel's permanent message.
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

const TOPIC_BUTTON_PREFIX = "topic:new:";
const PRIVATE_BUTTON_PREFIX = "priv:new:";

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
  createTopicRow,
  createPrivateRow,
};
