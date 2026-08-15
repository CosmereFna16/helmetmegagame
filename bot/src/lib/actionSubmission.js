const { prisma } = require("@lifeweb/db");
const { sendDm } = require("./dm");

const CONFIRM_EMOJI = "⚜️";

// A message posted in the #moves or #effort channel becomes a PENDING
// action: the original message is deleted (the action itself only exists as
// a DM + the web dashboard) and the player confirms via reaction, same as
// the existing action-confirm flow.
async function handleActionSubmission(message, type) {
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
    const label = type === "MOVE" ? "move" : "effort";
    await sendDm(message.author, `» *No turn is currently open — your ${label} wasn't recorded.*`).catch(() => {});
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
      type,
      description,
      zoneId: character.zoneId ?? null,
    },
  });

  await message.delete().catch(() => {});

  const lines =
    type === "MOVE"
      ? [`» ${description}`, `**Zone:** ${zone?.name ?? "(none)"}`, "", "React with ⚜ to confirm."]
      : [`» ${description}`, "", "React with ⚜ to confirm."];

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
      actionType: type === "MOVE" ? "move_submitted" : "effort_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id },
    },
  });
}

module.exports = { handleActionSubmission };
