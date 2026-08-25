const {
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
  CheckboxBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

// Speaking as your character without typing in the channel. The typing
// indicator fires under the player's REAL Discord account, so composing in a
// modal is the only way to say something in a room without announcing who you
// are first.
//
// Two entry points, one modal: the Speak button (and /message run outside a
// channel) go through the picker below first, while /message run inside a
// channel you can already speak in skips straight to the modal. That second
// path does NOT hide the typing indicator — you are already in the channel —
// but it does stop the message existing in plain sight before the proxy
// deletes it.

const SPEAK_HELP = "-# Sent as your character. Nobody sees you typing.";

function buildSpeakPicker(options, truncated) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("say:pick")
    .setPlaceholder("Where would you like to speak?")
    .addOptions(
      options.map((o) => ({
        label: o.label,
        value: o.value,
        ...(o.description ? { description: o.description } : {}),
        ...(o.emoji ? { emoji: o.emoji } : {}),
      })),
    );
  const rows = [new ActionRowBuilder().addComponents(menu)];
  // Never truncate silently: a missing room reads as a permissions bug.
  const note = truncated > 0 ? `-# ${truncated} more not shown — Discord caps this list at 25.` : null;
  return { rows, note };
}

// customId carries the destination, so the submit handler needs no state of
// its own — which matters because an ephemeral picker outlives a player
// walking out of the room, and the handler re-checks permissions anyway.
function buildSpeakModal(channelId, channelName) {
  return new ModalBuilder()
    .setCustomId(`say:send:${channelId}`)
    .setTitle(channelName ? `Speak in ${channelName}`.slice(0, 45) : "Speak")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Message")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("say:body")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1800)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Conceal")
        .setDescription("Post under an anonymous alias instead of your name.")
        .setCheckboxComponent(new CheckboxBuilder().setCustomId("say:conceal")),
    )
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(SPEAK_HELP));
}

module.exports = { buildSpeakModal, buildSpeakPicker };
