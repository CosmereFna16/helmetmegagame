const { MessageFlags } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const {
  buildZoneSelectRow,
  buildLocationSelectRow,
  buildConfirmRow,
  performMove,
} = require("../lib/location");
const { performLabor } = require("../lib/labor");
const { sendDm } = require("../lib/dm");
const { buildMoveComponents, buildMoveContent, moveKindLabel } = require("../lib/moveComponents");
const { rollResourceDice } = require("../lib/resourceDelta");

function rollDie(sides = 6) {
  return 1 + Math.floor(Math.random() * sides);
}

function isGmMember(interaction) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!gmRoleId) return false;
  return interaction.member?.roles.cache.has(gmRoleId) ?? false;
}

// /gm: post to the current channel as the bot itself, not the invoker's
// character — the slash-command replacement for the old ":gm" message
// prefix (deleted the invoker's message and reposted it; a slash command
// has no message of its own to delete, so it just sends directly).
async function handleGmCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const content = interaction.options.getString("message", true);
  const attachment = interaction.options.getAttachment("attachment");

  await interaction.channel.send({ content, files: attachment ? [attachment.url] : [] });
  await interaction.reply({ content: "» *Sent.*", flags: MessageFlags.Ephemeral });
}

// /message: DM a chosen server member as the bot itself. Reuses
// bot/src/lib/dm.js#sendDm so it's logged to DirectMessage like every
// other bot-sent DM, and carries the "»" prefix inline since this is a
// bot-composed DM (see the "Bot message style" note in CLAUDE.md).
async function handleMessageCommand(interaction) {
  if (!isGmMember(interaction)) {
    await interaction.reply({ content: "» *GMs only.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const recipient = interaction.options.getUser("recipient", true);
  const content = interaction.options.getString("message", true);

  try {
    await sendDm(recipient, `» ${content}`);
    await interaction.reply({ content: `» *Sent to ${recipient}.*`, flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error("Failed to send /message DM:", err);
    await interaction.reply({ content: "» *Failed to deliver — they may have DMs closed.*", flags: MessageFlags.Ephemeral });
  }
}

// /labor: any player with a living, un-acted character can use this — no GM
// gate. See bot/src/lib/labor.js#performLabor for the tag-tier lookup and
// auto-resolved Action creation.
async function handleLaborCommand(interaction) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const field = interaction.options.getString("field", true);
  const result = await performLabor(character, field);
  if (!result.ok) {
    await interaction.reply({ content: `» *${result.reason}*`, flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = [`» ${character.name} ${field === "hunt" ? "hunted" : field === "herd" ? "herded" : field === "fish" ? "fished" : "farmed"}.`];
  if (result.resourceDiceExpression) {
    lines.push(`**Resource ⬢ roll (${result.resourceDiceExpression}):** rolled ${result.diceSum} → +${result.resourceDelta}`);
  } else {
    lines.push(`**Resource ⬢ change:** +${result.resourceDelta}`);
  }
  lines.push("» *Move confirmed — waiting on GM review.*");

  await interaction.reply({ content: lines.join("\n"), flags: MessageFlags.Ephemeral });
}

// All custom IDs below are namespaced "loc:" for the zone/location travel
// flow triggered from the Move button in the "location" channel (see the
// "Location picker" section of CLAUDE.md and
// bot/src/lib/location.js#ensureLocationPrompt) — "move:" IDs further down
// are the unrelated Move-setup flow (Kind/Opposed/Confirm).
async function findAliveCharacter(discordUserId) {
  return prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } });
}

async function handleOpen(interaction) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  // An unset zone (brand-new character) can freely pick any zone to start
  // in; otherwise the picker only offers the current zone (free movement
  // within it) plus zones directly connected to it (see Zone.connectsTo /
  // performMove).
  let zones;
  if (!character.zoneId) {
    zones = await prisma.zone.findMany({ orderBy: { name: "asc" } });
  } else {
    const currentZone = await prisma.zone.findUnique({
      where: { id: character.zoneId },
      include: { connectsTo: true },
    });
    const reachableIds = new Set([character.zoneId, ...(currentZone?.connectsTo.map((z) => z.id) ?? [])]);
    zones = await prisma.zone.findMany({ where: { id: { in: [...reachableIds] } }, orderBy: { name: "asc" } });
  }
  if (zones.length === 0) {
    await interaction.reply({ content: "» *No zones exist yet.*", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Where would you like to move? Choose a zone.",
    components: [buildZoneSelectRow(zones)],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleZoneSelect(interaction) {
  const zoneId = interaction.values[0];
  const locations = await prisma.location.findMany({ where: { zoneId }, orderBy: { name: "asc" } });
  if (locations.length === 0) {
    await interaction.update({ content: "» *That zone has no locations yet.*", components: [] });
    return;
  }

  await interaction.update({
    content: "Choose a location.",
    components: [buildLocationSelectRow(zoneId, locations)],
  });
}

async function handlePlaceSelect(interaction) {
  const locationId = interaction.values[0];
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    await interaction.update({ content: "» *That location no longer exists.*", components: [] });
    return;
  }

  await interaction.update({
    content: `Move to **${location.name}**?`,
    components: [buildConfirmRow(locationId)],
  });
}

async function handleConfirm(interaction, locationId) {
  await interaction.deferUpdate();

  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.editReply({ content: "» *You don't have a living character.*", components: [] });
    return;
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    await interaction.editReply({ content: "» *That location no longer exists.*", components: [] });
    return;
  }

  const result = await performMove(interaction.guild, character, location);
  if (!result.ok) {
    await interaction.editReply({ content: `» *${result.reason}*`, components: [] });
    return;
  }

  const suffix = result.free ? "" : " Your turn is spent.";
  await interaction.editReply({ content: `» Moved to **${location.name}**.${suffix}`, components: [] });
}

async function handleCancel(interaction) {
  await interaction.update({ content: "» *Cancelled.*", components: [] });
}

// Move setup: one DM (see bot/src/lib/actionSubmission.js) carrying a Kind
// select, an Opposed select, and a Confirm button, all namespaced "move:" —
// picks are written straight to the Action row and the message is re-rendered
// in place via interaction.update() so nothing is ever deleted/resent.
async function findMoveAction(actionId) {
  return prisma.action.findUnique({ where: { id: actionId }, include: { character: true } });
}

function isEditableMove(action, interaction) {
  return action && action.status === "PENDING_TYPE" && action.character.discordUserId === interaction.user.id;
}

async function handleMoveKindSelect(interaction, actionId) {
  const action = await findMoveAction(actionId);
  if (!isEditableMove(action, interaction)) {
    await interaction.update({ content: "» *This Move can no longer be edited.*", components: [] });
    return;
  }

  const updated = await prisma.action.update({
    where: { id: action.id },
    data: { moveKind: interaction.values[0] },
  });
  await interaction.update({ content: buildMoveContent(updated), components: buildMoveComponents(updated) });
}

async function handleMoveOpposedSelect(interaction, actionId) {
  const action = await findMoveAction(actionId);
  if (!isEditableMove(action, interaction)) {
    await interaction.update({ content: "» *This Move can no longer be edited.*", components: [] });
    return;
  }

  const updated = await prisma.action.update({
    where: { id: action.id },
    data: { opposed: interaction.values[0] === "true" },
  });
  await interaction.update({ content: buildMoveContent(updated), components: buildMoveComponents(updated) });
}

async function handleMoveConfirm(interaction, actionId) {
  const action = await findMoveAction(actionId);
  if (!isEditableMove(action, interaction)) {
    await interaction.update({ content: "» *This Move can no longer be confirmed.*", components: [] });
    return;
  }
  if (!action.moveKind) {
    await interaction.reply({ content: "» *Choose Routine or Gambit first.*" });
    return;
  }

  const diceRoll = action.moveKind === "GAMBIT" ? rollDie() : null;
  const diceResult = action.resourceDiceExpression ? rollResourceDice(action.resourceDiceExpression) : null;

  await prisma.action.update({
    where: { id: action.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      ...(diceRoll != null ? { diceRoll } : {}),
      ...(diceResult
        ? { resourceDiceRoll: diceResult.value, resourceDelta: (action.resourceDelta ?? 0) + diceResult.value }
        : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "move_confirmed",
      targetCharacterId: action.characterId,
      details: { actionId: action.id, diceRoll, resourceDiceRoll: diceResult?.value ?? null },
    },
  });

  const lines = [
    `» ${action.description}`,
    `Kind: **${moveKindLabel(action.moveKind)}**${action.opposed ? " — Opposed" : ""}`,
  ];
  if (diceRoll != null) lines.push(`🎲 **${diceRoll}**`);
  if (diceResult) {
    lines.push(
      `**Resource roll (${action.resourceDiceExpression}):** rolled ${diceResult.sum} → ${diceResult.value > 0 ? "+" : ""}${diceResult.value}`,
    );
  }
  lines.push("» *Waiting on adjudication...*");

  await interaction.update({ content: lines.join("\n"), components: [] });
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (interaction.commandName === "labor") return void (await handleLaborCommand(interaction));
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleOpen(interaction));
        if (interaction.customId === "loc:cancel") return void (await handleCancel(interaction));
        if (interaction.customId.startsWith("loc:confirm:")) {
          return void (await handleConfirm(interaction, interaction.customId.slice("loc:confirm:".length)));
        }
        if (interaction.customId.startsWith("move:confirm:")) {
          return void (await handleMoveConfirm(interaction, interaction.customId.slice("move:confirm:".length)));
        }
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "loc:zone") return void (await handleZoneSelect(interaction));
        if (interaction.customId.startsWith("loc:place:")) return void (await handlePlaceSelect(interaction));
        if (interaction.customId.startsWith("move:kind:")) {
          return void (await handleMoveKindSelect(interaction, interaction.customId.slice("move:kind:".length)));
        }
        if (interaction.customId.startsWith("move:opposed:")) {
          return void (await handleMoveOpposedSelect(interaction, interaction.customId.slice("move:opposed:".length)));
        }
      }
    } catch (err) {
      console.error("interactionCreate handler failed:", err);
    }
  },
};
