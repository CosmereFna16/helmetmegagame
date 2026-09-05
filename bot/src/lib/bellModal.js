const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// The confirm on the Sound Bell button in the Cathedral's Bell Tower
// (db/lib/roomStarterRow.js). A modal rather than a bare button because one
// click is heard in four zones at once, and a misclick that wakes the whole
// barony is not a mistake you can take back.
//
// The room id rides in the customId so the submit handler can re-check where
// the ringer is standing. An ephemeral modal outlives somebody walking down
// out of the tower, so permission is decided at submit, never at open.

const BELL_MODAL_PREFIX = "bell:ring:";
const BELL_WORD_FIELD = "bell:word";

const RING_WORD = "RING";

const BELL_HELP = "-# Heard in the Town, the Fortress, the Forest and the Marshes. Nobody is pinged. ‡";

function buildBellModal(roomId) {
  return new ModalBuilder()
    .setCustomId(`${BELL_MODAL_PREFIX}${roomId}`)
    .setTitle("Sound the bell")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Type ${RING_WORD} to pull the rope`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(BELL_WORD_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(16)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(BELL_HELP));
}

// Case and stray spaces forgiven: the word is a speed bump, not a password.
function bellWordMatches(typed) {
  return String(typed ?? "").trim().toUpperCase() === RING_WORD;
}

module.exports = {
  BELL_MODAL_PREFIX,
  BELL_WORD_FIELD,
  RING_WORD,
  buildBellModal,
  bellWordMatches,
};
