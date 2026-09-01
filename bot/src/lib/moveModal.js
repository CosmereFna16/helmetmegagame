const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
  RadioGroupBuilder,
  CheckboxBuilder,
} = require("discord.js");

// The whole Move, in one popup. Replaces the old flow entirely: a message in
// #turns became a PENDING_TYPE Action, the bot deleted the message and DMed
// two select menus plus a Confirm button. That leaked the player's identity
// twice (the typing indicator under their real account, and the message
// itself in the moment before deletion) and cost four round trips.
//
// This is the repo's first modal. It needs discord.js >= 14.27 for the
// component types below: Label (18) wrapping a TextInput (4), a RadioGroup
// (21) and a Checkbox (23), plus a bare TextDisplay (10) for the `-#` line.
// Older builders will silently produce a payload Discord rejects.
//
// A modal must be shown within 3 seconds of the interaction and CANNOT be
// deferred first, so nothing here reads the database — the gates all run on
// submit (bot/src/events/interactionCreate.js#handleMoveSubmit).

const MOVE_MODAL_ID = "move:new";

// Label.description caps at 100 characters, which the full guidance line
// overruns, so it lives in the TextDisplay below instead.
const MOVE_HELP =
  "-# Describe what you're hoping to accomplish — in the broadest sense, the ideal outcome, your intent. " +
  "Mention relevant tags or circumstances that the GMs should consider. " +
  "Careful! This can't be changed or canceled.";

function buildMoveModal() {
  return new ModalBuilder()
    .setCustomId(MOVE_MODAL_ID)
    .setTitle("Lock In Your Move")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Your Move")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("move:body")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1800)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Kind")
        .setRadioGroupComponent(
          new RadioGroupBuilder()
            .setCustomId("move:kind")
            .setRequired(true)
            .addOptions(
              { label: "Routine", value: "ROUTINE", description: "Easy — it resolves itself." },
              { label: "Gambit", value: "GAMBIT", description: "Could go either way — rolls a die." },
            ),
        ),
      new LabelBuilder()
        .setLabel("Labor")
        .setDescription("Auto-applies your skills, but consumes your turn without doing anything else.")
        .setCheckboxComponent(new CheckboxBuilder().setCustomId("move:labor")),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(MOVE_HELP));
}

module.exports = { buildMoveModal };
