const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
} = require("discord.js");

// The confirm on the big red button in the Censor's Office
// (db/lib/roomStarterRow.js). A modal rather than a second button because
// Discord has no confirm dialog and this one kills people: the gun in the
// fortress yard does not check who anyone is, so arming it endangers the
// Cerberon, the Baron and whoever happens to be crossing the yard.
//
// The typed word is the confirm. It is deliberate friction — a misclick on a
// red button should not be able to shoot the Keep — and it doubles as the
// place to say, in plain words, what is about to happen.
//
// The room id rides in the customId so the submit handler can re-check where
// the presser is standing. An ephemeral modal outlives somebody walking out of
// the Garrison, so permission is decided at submit, never at open.

const TURRET_MODAL_PREFIX = "turret:toggle:";
const TURRET_WORD_FIELD = "turret:word";

// What they have to type, and what the modal warns them of, per direction.
const ARM_WORD = "ARM";
const DISARM_WORD = "DISARM";

const ARM_HELP =
  "-# It fires on everyone standing in the Gatehouse — the Cerberon, the Baron, you. Armour helps; a name does not. ‡";
const DISARM_HELP = "-# The barrels drop and the yard is safe to cross again. ‡";

// `armed` is the turret's state RIGHT NOW, so the modal offers the opposite.
function buildTurretModal(roomId, armed) {
  const word = armed ? DISARM_WORD : ARM_WORD;
  return new ModalBuilder()
    .setCustomId(`${TURRET_MODAL_PREFIX}${roomId}`)
    .setTitle(armed ? "Disarm the turret" : "Arm the turret")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Type ${word} to confirm`)
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(TURRET_WORD_FIELD)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(16)
            .setRequired(true),
        ),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(armed ? DISARM_HELP : ARM_HELP));
}

// Case and stray spaces forgiven: the word is a speed bump, not a password.
function turretWordMatches(typed, armed) {
  return String(typed ?? "").trim().toUpperCase() === (armed ? DISARM_WORD : ARM_WORD);
}

module.exports = {
  TURRET_MODAL_PREFIX,
  TURRET_WORD_FIELD,
  ARM_WORD,
  DISARM_WORD,
  buildTurretModal,
  turretWordMatches,
};
