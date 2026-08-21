const { MessageFlags } = require("discord.js");
const { prisma, LABOR_FIELDS, FIELD_INFO } = require("@lifeweb/db");
const { buildLocationSelectRow, buildConfirmRow, performMove } = require("../lib/location");
const { performLabor } = require("../lib/labor");
const { sendDm } = require("../lib/dm");
const { buildMoveComponents, buildMoveContent, moveKindLabel } = require("../lib/moveComponents");
const { rollResourceRange, formatRangeExpression } = require("../lib/resourceDelta");
const {
  gambitModifiers,
  gambitModifierTotal,
  formatGambitModifiers,
} = require("@lifeweb/db/lib/gambitModifier");
const { applyMoveEffects, rollDie } = require("@lifeweb/db/lib/moveEffects");

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

// /hunt, /fish, /farm, /herd: any player with a living, un-acted character
// can use these — no GM gate. The command name IS the field. See
// bot/src/lib/labor.js#performLabor for the tag-tier lookup, the location
// gate and the auto-resolved Action creation.
async function handleLaborCommand(interaction, field) {
  const character = await findAliveCharacter(interaction.user.id);
  if (!character) {
    await interaction.reply({ content: "» *You don't have a living character.*", flags: MessageFlags.Ephemeral });
    return;
  }

  const result = await performLabor(character, field);
  if (!result.ok) {
    await interaction.reply({ content: `» *${result.reason}*`, flags: MessageFlags.Ephemeral });
    return;
  }

  const lines = [`» ${character.name} ${FIELD_INFO[field].verb}.`];
  // A flat tier (min === max) has nothing to show its work for.
  lines.push(
    result.min === result.max
      ? `**Resource change:** +${result.resourceDelta} ⬢`
      : `**Resource roll (${result.min}–${result.max}):** +${result.resourceDelta} ⬢`,
  );
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

  // An unset Location (brand-new character) can freely pick any Location to
  // start in; otherwise the picker only offers the current Location's
  // direct neighbors (see Location.connectsTo / performMove) — moving is
  // now location-by-location, not "anywhere in zone, or any connected
  // zone."
  let locations;
  if (!character.locationId) {
    locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
  } else {
    const currentLocation = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { connectsTo: true },
    });
    locations = [...(currentLocation?.connectsTo ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }
  if (locations.length === 0) {
    await interaction.reply({ content: "» *Nowhere to go from here.*", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Where would you like to move? Choose a location.",
    components: [buildLocationSelectRow(locations, character.zoneId)],
    flags: MessageFlags.Ephemeral,
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
  return prisma.action.findUnique({
    where: { id: actionId },
    // Mood and Hunger are ordinary Status tags, so the whole Gambit modifier
    // is read off the character's tags rather than a column
    // (db/lib/gambitModifier.js).
    include: { character: { include: { tags: { include: { tag: true } } } } },
  });
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
  // Only a Gambit rolls, so only a Gambit can carry a modifier. diceRoll stays
  // the RAW roll and the SUM of every contributor (Mood ±1, Hunger -1) is
  // stored beside it — see the Action.diceModifier comment in schema.prisma.
  // The per-contributor breakdown is display-only, for the DM below.
  const modifiers = diceRoll != null ? gambitModifiers(action.character.tags) : [];
  const diceModifier = diceRoll != null ? gambitModifierTotal(action.character.tags) : null;
  // Null for a row written before ranges existed (a leftover "1d4*3"), which
  // then confirms on its flat delta alone rather than throwing.
  const rollResult = action.resourceRollExpression ? rollResourceRange(action.resourceRollExpression) : null;

  const resourceDelta = rollResult
    ? (action.resourceDelta ?? 0) + rollResult.value
    : (action.resourceDelta ?? null);

  // A Routine resolves itself: its resources land now and it enters the queue
  // already PASSED, needing a GM only if one disagrees. A Gambit is the
  // opposite — nothing is pushed until a GM Solves it, because the whole point
  // of rolling is that the outcome isn't the player's to declare.
  const isRoutine = action.moveKind === "ROUTINE";

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.action.update({
      where: { id: action.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        ...(diceRoll != null ? { diceRoll, diceModifier } : {}),
        ...(rollResult ? { resourceRollValue: rollResult.value, resourceDelta } : {}),
        ...(isRoutine ? { moveReviewStatus: "PASSED" } : {}),
      },
    });
    if (!isRoutine) return row;
    const applied = await applyMoveEffects(tx, row);
    return tx.action.update({ where: { id: row.id }, data: { appliedEffects: applied } });
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "move_confirmed",
      targetCharacterId: action.characterId,
      details: {
        actionId: action.id,
        diceRoll,
        diceModifier,
        // The only place the breakdown survives — the column stores the sum.
        diceModifiers: modifiers,
        resourceRollValue: rollResult?.value ?? null,
        appliedEffects: updated.appliedEffects ?? null,
      },
    },
  });

  const lines = [
    `» ${action.description}`,
    `Kind: **${moveKindLabel(action.moveKind)}**${action.opposed ? " — Opposed" : ""}`,
  ];
  if (diceRoll != null) {
    lines.push(
      // Keyed on modifiers.length, not diceModifier: a Happy+Hungry wash sums
      // to 0 but should still show its work rather than pretend nothing applied.
      modifiers.length
        ? `🎲 **${diceRoll}** ${formatGambitModifiers(modifiers)} → **${diceRoll + diceModifier}**`
        : `🎲 **${diceRoll}**`,
    );
  }
  if (rollResult) {
    lines.push(
      `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${rollResult.value > 0 ? "+" : ""}${rollResult.value} ⬢`,
    );
  }
  lines.push("» *Waiting on adjudication...*");

  await interaction.update({ content: lines.join("\n"), components: [] });
}

async function handleMoveCancel(interaction, actionId) {
  const action = await findMoveAction(actionId);
  if (!isEditableMove(action, interaction)) {
    await interaction.update({ content: "» *This Move can no longer be cancelled.*", components: [] });
    return;
  }

  await prisma.action.delete({ where: { id: action.id } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: interaction.user.id,
      actionType: "move_cancelled",
      targetCharacterId: action.characterId,
      details: { actionId: action.id },
    },
  });

  await interaction.update({ content: "» *Move cancelled. You may submit a new one in #turns.*", components: [] });
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "gm") return void (await handleGmCommand(interaction));
        if (interaction.commandName === "message") return void (await handleMessageCommand(interaction));
        if (LABOR_FIELDS.includes(interaction.commandName)) {
          return void (await handleLaborCommand(interaction, interaction.commandName));
        }
      } else if (interaction.isButton()) {
        if (interaction.customId === "loc:open") return void (await handleOpen(interaction));
        if (interaction.customId === "loc:cancel") return void (await handleCancel(interaction));
        if (interaction.customId.startsWith("loc:confirm:")) {
          return void (await handleConfirm(interaction, interaction.customId.slice("loc:confirm:".length)));
        }
        if (interaction.customId.startsWith("move:confirm:")) {
          return void (await handleMoveConfirm(interaction, interaction.customId.slice("move:confirm:".length)));
        }
        if (interaction.customId.startsWith("move:cancel:")) {
          return void (await handleMoveCancel(interaction, interaction.customId.slice("move:cancel:".length)));
        }
      } else if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "loc:place") return void (await handlePlaceSelect(interaction));
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
