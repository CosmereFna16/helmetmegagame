const { prisma } = require("@lifeweb/db");
const { sendDm } = require("./dm");
const { parseResourceDelta, parseResourceDice, formatResourceLines } = require("./resourceDelta");

const ROUTINE_EMOJI = "🔹";
const GAMBIT_EMOJI = "🎲";

// A message posted in the #turns channel becomes a PENDING_TYPE Move: the
// original message is deleted (the Move itself only exists as a DM + the
// web dashboard) and the player picks Routine or Gambit via a reaction menu,
// then Opposed or not (see handleMoveKindSelection/handleOpposedSelection in
// messageReactionAdd.js), before the usual confirm flow kicks in.
async function handleActionSubmission(message) {
  const character = await prisma.character.findFirst({
    where: { discordUserId: message.author.id, status: "ALIVE" },
  });
  if (!character) {
    await message.delete().catch(() => {});
    return;
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) {
    await message.delete().catch(() => {});
    await sendDm(message.author, "» *No turn is currently open — your submission wasn't recorded.*").catch(
      () => {},
    );
    return;
  }

  // Also catches a prior auto-resolved zone-change Move (see
  // bot/src/lib/location.js#performMove) — changing zones spends the turn
  // just like a Move submission does.
  const alreadyActed = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (alreadyActed) {
    await message.delete().catch(() => {});
    await sendDm(message.author, "» *You've already sent a Move this turn — your submission wasn't recorded.*").catch(
      () => {},
    );
    return;
  }

  const raw = message.content.trim();
  if (!raw) {
    await message.delete().catch(() => {});
    return;
  }

  const { description: afterDice, resourceDiceExpression } = parseResourceDice(raw);
  const { description, resourceDelta } = parseResourceDelta(afterDice);

  const action = await prisma.action.create({
    data: {
      characterId: character.id,
      turnId: openTurn.id,
      type: "MOVE",
      status: "PENDING_TYPE",
      description,
      resourceDelta,
      resourceDiceExpression,
      zoneId: character.zoneId ?? null,
    },
  });

  await message.delete().catch(() => {});

  const lines = [
    `» ${description}`,
    ...formatResourceLines(resourceDelta, resourceDiceExpression),
    "",
    "```",
    `${ROUTINE_EMOJI}  Routine`,
    `${GAMBIT_EMOJI}  Gambit`,
    "```",
    `Was that Routine or a Gambit? React with ${ROUTINE_EMOJI} or ${GAMBIT_EMOJI} to choose.`,
  ];

  let sent;
  try {
    ({ sent } = await sendDm(message.author, lines.join("\n")));
  } catch {
    await prisma.action.delete({ where: { id: action.id } }).catch(() => {});
    return;
  }

  await prisma.action.update({ where: { id: action.id }, data: { confirmDmMessageId: sent.id } });
  await sent.react(ROUTINE_EMOJI).catch(() => {});
  await sent.react(GAMBIT_EMOJI).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: message.author.id,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id },
    },
  });
}

module.exports = { handleActionSubmission, ROUTINE_EMOJI, GAMBIT_EMOJI };
