const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { formatResourceLines } = require("./resourceDelta");

// Everything a player needs to set up a Move lives in one DM message —
// two select menus (Kind, Opposed) plus a Confirm button — edited in place
// via interaction.update() as they change their picks, rather than the
// old delete-and-resend-a-new-DM-per-step reaction flow. Both menus default
// to the Action's current stored value so re-rendering after a pick keeps
// the dropdown showing what's actually selected.
function buildMoveComponents(action) {
  const kindMenu = new StringSelectMenuBuilder()
    .setCustomId(`move:kind:${action.id}`)
    .setPlaceholder("Routine or Gambit?")
    .addOptions(
      { label: "Routine", value: "ROUTINE", default: action.moveKind === "ROUTINE" },
      { label: "Gambit", value: "GAMBIT", default: action.moveKind === "GAMBIT" },
    );

  const opposedMenu = new StringSelectMenuBuilder()
    .setCustomId(`move:opposed:${action.id}`)
    .setPlaceholder("Opposed?")
    .addOptions(
      { label: "Not Opposed", value: "false", default: !action.opposed },
      { label: "Opposed", value: "true", default: action.opposed },
    );

  const confirmButton = new ButtonBuilder()
    .setCustomId(`move:confirm:${action.id}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);

  const cancelButton = new ButtonBuilder()
    .setCustomId(`move:cancel:${action.id}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Danger);

  return [
    new ActionRowBuilder().addComponents(kindMenu),
    new ActionRowBuilder().addComponents(opposedMenu),
    new ActionRowBuilder().addComponents(confirmButton, cancelButton),
  ];
}

function moveKindLabel(moveKind) {
  return moveKind === "GAMBIT" ? "Gambit" : moveKind === "ROUTINE" ? "Routine" : "(not chosen)";
}

function buildMoveContent(action) {
  return [
    `» ${action.description}`,
    ...formatResourceLines(action.resourceDelta, action.resourceDiceExpression),
    "",
    `Kind: **${moveKindLabel(action.moveKind)}**`,
    `Opposed: **${action.opposed ? "Yes" : "No"}**`,
  ].join("\n");
}

module.exports = { buildMoveComponents, buildMoveContent, moveKindLabel };
