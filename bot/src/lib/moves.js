const { prisma } = require("@lifeweb/db");
const { sendDm } = require("./dm");

const CONFIRM_EMOJI = "✅";

// A message posted in the designated moves channel becomes a PENDING Move
// action: the original message is deleted (the channel is meant to stay
// clean — the move itself only exists as a DM + the web dashboard) and the
// player confirms via reaction, same as the existing action-confirm flow.
async function handleMoveSubmission(message) {
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
    await sendDm(message.author, "No turn is currently open — your move wasn't recorded.").catch(() => {});
    return;
  }

  const description = message.content.trim();
  if (!description) {
    await message.delete().catch(() => {});
    return;
  }

  const zone = character.zoneId ? await prisma.zone.findUnique({ where: { id: character.zoneId } }) : null;

  const action = await prisma.action.create({
    data: {
      characterId: character.id,
      turnId: openTurn.id,
      type: "MOVE",
      description,
      zoneId: character.zoneId ?? null,
    },
  });

  await message.delete().catch(() => {});

  const lines = [
    `**Move submitted:** ${description}`,
    `Zone: ${zone?.name ?? "(none)"}`,
    "React with ✅ to confirm.",
  ];

  let sent;
  try {
    ({ sent } = await sendDm(message.author, lines.join("\n")));
  } catch {
    await prisma.action.delete({ where: { id: action.id } }).catch(() => {});
    return;
  }

  await prisma.action.update({ where: { id: action.id }, data: { confirmDmMessageId: sent.id } });
  await sent.react(CONFIRM_EMOJI).catch(() => {});

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: message.author.id,
      actionType: "move_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id },
    },
  });
}

module.exports = { handleMoveSubmission };
