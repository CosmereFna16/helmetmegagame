const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// The PA, composed in a modal off the Intercom button on the Council Room's
// starter post (db/lib/roomStarterRow.js). A modal rather than a channel for
// the same reason Speak is one: typing in a channel fires the indicator under
// the player's real account.
//
// The room id rides in the customId so the submit handler can re-check where
// the speaker is standing — an ephemeral modal outlives somebody walking out
// of the Keep, and permission is decided at submit, never at open.

const INTERCOM_MODAL_PREFIX = "intercom:send:";

// Well under Discord's 2000-character message cap, so the broadcast is always
// one message per zone. Chunking would ping @here once per chunk.
const INTERCOM_MAX_LENGTH = 1200;

const INTERCOM_HELP = "-# Heard everywhere above ground except the Black Hills. Everyone there is pinged. ‡";

function buildIntercomModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`${INTERCOM_MODAL_PREFIX}${roomId}`)
    .setTitle("Intercom")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Announcement")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("intercom:body")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(INTERCOM_MAX_LENGTH)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(INTERCOM_HELP));
}

module.exports = { INTERCOM_MODAL_PREFIX, INTERCOM_MAX_LENGTH, buildIntercomModal };
