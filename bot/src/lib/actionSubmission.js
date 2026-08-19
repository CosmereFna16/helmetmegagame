const { prisma } = require("@lifeweb/db");
const { sendDm } = require("./dm");
const { parseResourceDelta, parseResourceDice } = require("./resourceDelta");
const { buildMoveComponents, buildMoveContent } = require("./moveComponents");

// A message posted in the #turns channel becomes a PENDING_TYPE Move: the
// original message is deleted (the Move itself only exists as a DM + the
// web dashboard) and the player is DMed one message with Kind/Opposed
// select menus and a Confirm button (see bot/src/events/interactionCreate.js
// for the move:kind/move:opposed/move:confirm handlers) — edited in place
// as they change their picks, no further messages sent until Confirm.
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

  let sent;
  try {
    ({ sent } = await sendDm(message.author, {
      content: buildMoveContent(action),
      components: buildMoveComponents(action),
    }));
  } catch {
    await prisma.action.delete({ where: { id: action.id } }).catch(() => {});
    return;
  }

  await prisma.action.update({ where: { id: action.id }, data: { confirmDmMessageId: sent.id } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: message.author.id,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id },
    },
  });
}

module.exports = { handleActionSubmission };
