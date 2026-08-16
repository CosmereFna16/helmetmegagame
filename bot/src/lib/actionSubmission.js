const { prisma } = require("@lifeweb/db");
const { sendDm } = require("./dm");
const { parseResourceDelta } = require("./resourceDelta");

const EFFORT_EMOJI = "1️⃣";
const MOVE_EMOJI = "2️⃣";

// A message posted in the #turns channel becomes a PENDING_TYPE action: the
// original message is deleted (the action itself only exists as a DM + the
// web dashboard) and the player picks Effort or Move via a reaction menu
// before the usual confirm flow (see handleTypeSelection in
// messageReactionAdd.js) kicks in.
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

  const raw = message.content.trim();
  if (!raw) {
    await message.delete().catch(() => {});
    return;
  }

  const { description, resourceDelta } = parseResourceDelta(raw);

  const action = await prisma.action.create({
    data: {
      characterId: character.id,
      turnId: openTurn.id,
      type: null,
      status: "PENDING_TYPE",
      description,
      resourceDelta,
      zoneId: character.zoneId ?? null,
    },
  });

  await message.delete().catch(() => {});

  const resourceLine = resourceDelta != null ? [`**Resource change:** ${resourceDelta > 0 ? "+" : ""}${resourceDelta}`] : [];
  const lines = [
    `» ${description}`,
    ...resourceLine,
    "",
    "```",
    `${EFFORT_EMOJI}  Effort`,
    `${MOVE_EMOJI}  Move`,
    "```",
    `React with ${EFFORT_EMOJI} or ${MOVE_EMOJI} to choose.`,
  ];

  let sent;
  try {
    ({ sent } = await sendDm(message.author, lines.join("\n")));
  } catch {
    await prisma.action.delete({ where: { id: action.id } }).catch(() => {});
    return;
  }

  await prisma.action.update({ where: { id: action.id }, data: { confirmDmMessageId: sent.id } });
  await sent.react(EFFORT_EMOJI).catch(() => {});
  await sent.react(MOVE_EMOJI).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: message.author.id,
      actionType: "action_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id },
    },
  });
}

module.exports = { handleActionSubmission, EFFORT_EMOJI, MOVE_EMOJI };
