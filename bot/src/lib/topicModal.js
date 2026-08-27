const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  CheckboxBuilder,
} = require("discord.js");

// The two creation modals of the zone rework: a public forum topic (the
// Create-a-Topic button on each zone forum's pinned post) and a private
// thread (the Create button on each #private anchor). Same discord.js >=
// 14.27 Label/Checkbox component vocabulary as moveModal.js.
//
// A modal must be shown within 3 seconds of the interaction and CANNOT be
// deferred first, so nothing here reads the database — the gates all run on
// submit (bot/src/events/interactionCreate.js).
//
// The zone id rides the custom id, matching the button that opened it, so
// submit needs no channel→zone lookup.

const TOPIC_MODAL_PREFIX = "topic:create:";
const PRIVATE_MODAL_PREFIX = "priv:create:";

function persistentLabel(what) {
  return new LabelBuilder()
    .setLabel("Persistent")
    .setDescription(`Survives the nightly wipe. Messages in ${what} still get cleared.`)
    .setCheckboxComponent(new CheckboxBuilder().setCustomId("topic:persistent"));
}

function buildTopicModal(zoneId) {
  return new ModalBuilder()
    .setCustomId(`${TOPIC_MODAL_PREFIX}${zoneId}`)
    .setTitle("Create a Topic")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Name")
        .setDescription("The place or scene this topic is about.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("topic:name")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(90)
            .setRequired(true),
        ),
      persistentLabel("it"),
    );
}

function buildPrivateModal(zoneId) {
  return new ModalBuilder()
    .setCustomId(`${PRIVATE_MODAL_PREFIX}${zoneId}`)
    .setTitle("Create a Private Thread")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Name")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("topic:name")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(90)
            .setRequired(true),
        ),
      persistentLabel("it"),
    );
}

module.exports = {
  buildTopicModal,
  buildPrivateModal,
  TOPIC_MODAL_PREFIX,
  PRIVATE_MODAL_PREFIX,
};
