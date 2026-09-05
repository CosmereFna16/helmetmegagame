const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

// The one thread a player can still open: a Conversation, a private thread
// under a Location channel, linked to a Room so the room hears somebody is
// whispering (bot/src/lib/whisperPoll.js). Replaces the two creation modals
// of the zone rework — players no longer make rooms.
//
// A modal must be shown within 3 seconds of the interaction and CANNOT be
// deferred first, so nothing here reads the database. The room id rides the
// custom id, coming straight off the select that opened this, so submit needs
// no channel→room lookup; every gate runs on submit
// (bot/src/events/interactionCreate.js).

const CONVERSE_MODAL_PREFIX = "conv:new:";
const CONVERSE_NAME_FIELD = "conv:name";

function buildConverseModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`${CONVERSE_MODAL_PREFIX}${roomId}`)
    .setTitle("Start a conversation ‡")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Name")
        .setDescription("What this conversation is about. Everyone you invite sees it. ‡")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(CONVERSE_NAME_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(90)
            .setRequired(true),
        ),
    );
}

module.exports = { buildConverseModal, CONVERSE_MODAL_PREFIX, CONVERSE_NAME_FIELD };
