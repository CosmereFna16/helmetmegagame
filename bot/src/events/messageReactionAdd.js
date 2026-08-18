const { WebhookClient, EmbedBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { recentProxies } = require("../lib/proxy");
const { sendDm } = require("../lib/dm");
const { ROUTINE_EMOJI, GAMBIT_EMOJI } = require("../lib/actionSubmission");
const { rollResourceDice, formatResourceLines } = require("../lib/resourceDelta");

const DELETE_EMOJI = "❌"; // ❌
const EDIT_EMOJI = "✏️"; // ✏️
const INSPECT_EMOJI = "🔍"; // 🔍
const CONFIRM_EMOJI = "⚜️"; // ⚜
const OPPOSED_EMOJI = "⚔️"; // ⚔
const NOT_OPPOSED_EMOJI = "🛡️"; // 🛡
const STAR_EMOJI = "⭐"; // ⭐
const FOG_EMOJI = "🌫️"; // :fog:

function rollDie(sides = 6) {
  return 1 + Math.floor(Math.random() * sides);
}

async function handleActionConfirm(reaction, user) {
  const action = await prisma.action.findUnique({
    where: { confirmDmMessageId: reaction.message.id },
    include: { character: true },
  });
  if (!action || action.status !== "PENDING") return;
  if (action.character.discordUserId !== user.id) return;

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
      actorDiscordUserId: user.id,
      actionType: "move_confirmed",
      targetCharacterId: action.characterId,
      details: { actionId: action.id, diceRoll, resourceDiceRoll: diceResult?.value ?? null },
    },
  });

  // Discord won't let a bot remove another user's reaction in a DM channel
  // (no MANAGE_MESSAGES concept there), so deleting the message and sending
  // a fresh one is the only reliable way to clear the confirm reaction.
  await reaction.message.delete().catch(() => {});

  const waitingLines = [];
  if (diceRoll != null) waitingLines.push(`🎲 **${diceRoll}**`);
  if (diceResult) {
    waitingLines.push(
      `**Resource roll (${action.resourceDiceExpression}):** rolled ${diceResult.sum} → ${diceResult.value > 0 ? "+" : ""}${diceResult.value}`,
    );
  }
  waitingLines.push("» *Waiting on adjudication...*");
  await sendDm(user, waitingLines.join("\n")).catch(() => {});
}

// Player picked Routine or Gambit from the kind-picker DM sent by
// handleActionSubmission. Records moveKind, then — same reasoning as
// handleActionConfirm below — deletes the picker DM and sends the next
// picker (Opposed?), pointing confirmDmMessageId at the new message.
async function handleMoveKindSelection(reaction, user) {
  const action = await prisma.action.findUnique({
    where: { confirmDmMessageId: reaction.message.id },
    include: { character: true },
  });
  if (!action || action.status !== "PENDING_TYPE") return;
  if (action.character.discordUserId !== user.id) return;

  const moveKind = reaction.emoji.name === GAMBIT_EMOJI ? "GAMBIT" : "ROUTINE";

  await prisma.action.update({ where: { id: action.id }, data: { moveKind, status: "PENDING_OPPOSED" } });

  await reaction.message.delete().catch(() => {});

  const lines = [
    `» ${action.description}`,
    `**${moveKind === "GAMBIT" ? "Gambit" : "Routine"}**`,
    "",
    "Was that opposed?",
    `React with ${OPPOSED_EMOJI} (opposed) or ${NOT_OPPOSED_EMOJI} (not opposed).`,
  ];

  let sent;
  try {
    ({ sent } = await sendDm(user, lines.join("\n")));
  } catch {
    return;
  }

  await prisma.action.update({ where: { id: action.id }, data: { confirmDmMessageId: sent.id } });
  await sent.react(OPPOSED_EMOJI).catch(() => {});
  await sent.react(NOT_OPPOSED_EMOJI).catch(() => {});
}

// Player picked Opposed or not from the DM sent by handleMoveKindSelection.
// Records opposed, then sends the final ⚜ confirm DM — same
// delete-and-resend pattern as the rest of this flow.
async function handleOpposedSelection(reaction, user) {
  const action = await prisma.action.findUnique({
    where: { confirmDmMessageId: reaction.message.id },
    include: { character: true },
  });
  if (!action || action.status !== "PENDING_OPPOSED") return;
  if (action.character.discordUserId !== user.id) return;

  const opposed = reaction.emoji.name === OPPOSED_EMOJI;

  await prisma.action.update({ where: { id: action.id }, data: { opposed, status: "PENDING" } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: user.id,
      actionType: "move_submitted",
      targetCharacterId: action.characterId,
      details: { actionId: action.id },
    },
  });

  await reaction.message.delete().catch(() => {});

  const zone = action.zoneId ? await prisma.zone.findUnique({ where: { id: action.zoneId } }) : null;
  const resourceLines = formatResourceLines(action.resourceDelta, action.resourceDiceExpression);
  const lines = [
    `» ${action.description}`,
    `**${action.moveKind === "GAMBIT" ? "Gambit" : "Routine"}**${opposed ? " — Opposed" : ""}`,
    `**Zone:** ${zone?.name ?? "(none)"}`,
    ...resourceLines,
    "",
    "React with ⚜ to confirm.",
  ];

  let sent;
  try {
    ({ sent } = await sendDm(user, lines.join("\n")));
  } catch {
    return;
  }

  await prisma.action.update({ where: { id: action.id }, data: { confirmDmMessageId: sent.id } });
  await sent.react(CONFIRM_EMOJI).catch(() => {});
}

// Starring a proxied tupper message saves it to the reacting user's personal
// Notes list (web/app/(app)/notes) — a private note, not a shared archive,
// so it's keyed on (message, starrer). The bot always strips the ⭐ reaction
// straight back off (see dispatch below) so Discord never shows an
// accumulating star count; the note living on /notes is the only lasting
// record, and unstarring happens there (a delete button), not by reacting
// again.
async function handleStarReaction(reaction, proxy, user) {
  const character = await prisma.character.findUnique({ where: { id: proxy.characterId } });
  if (!character) return;

  await prisma.note.upsert({
    where: { discordMessageId_discordUserId: { discordMessageId: reaction.message.id, discordUserId: user.id } },
    create: {
      discordMessageId: reaction.message.id,
      discordChannelId: reaction.message.channelId,
      characterId: character.id,
      characterName: character.name,
      zoneId: character.zoneId ?? null,
      content: reaction.message.content ?? "",
      sentAt: reaction.message.createdAt,
      discordUserId: user.id,
    },
    update: {},
  });
}

async function isGm(reaction, userId) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!gmRoleId || !reaction.message.guild) return false;
  const member = await reaction.message.guild.members.fetch(userId).catch(() => null);
  return member?.roles.cache.has(gmRoleId) ?? false;
}

// GM-only: delete the message and repost it as the bot itself (not the
// character webhook) with identical content/embeds/attachments. Works on
// any guild message, proxied or not.
async function handleFogReaction(reaction, user) {
  if (!(await isGm(reaction, user.id))) return;

  const message = reaction.message;
  const payload = {
    content: message.content,
    embeds: message.embeds,
    files: [...message.attachments.values()].map((a) => a.url),
  };

  await message.delete().catch(() => {});
  await message.channel.send(payload).catch(() => {});
}

module.exports = {
  name: "messageReactionAdd",
  async execute(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

    if (!reaction.message.guild) {
      const emoji = reaction.emoji.name;
      if (emoji === CONFIRM_EMOJI) await handleActionConfirm(reaction, user);
      else if (emoji === ROUTINE_EMOJI || emoji === GAMBIT_EMOJI) await handleMoveKindSelection(reaction, user);
      else if (emoji === OPPOSED_EMOJI || emoji === NOT_OPPOSED_EMOJI) await handleOpposedSelection(reaction, user);
      return;
    }

    if (reaction.emoji.name === FOG_EMOJI) {
      await handleFogReaction(reaction, user).catch(() => {});
      recentProxies.delete(reaction.message.id);
      return;
    }

    const proxy = recentProxies.get(reaction.message.id);
    if (!proxy) return;

    const emoji = reaction.emoji.name;
    const isOwner = user.id === proxy.discordUserId;

    if (emoji === STAR_EMOJI) {
      await handleStarReaction(reaction, proxy, user).catch(() => {});
      // Universal rule: a ⭐ reaction is always stripped back off right after
      // being processed, for any user, on any message — so the star lives on
      // the reactor's Notes list, not as a visible, accumulating reaction.
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    if (emoji === DELETE_EMOJI) {
      if (!isOwner && !(await isGm(reaction, user.id))) return;
      const webhookClient = new WebhookClient({ id: proxy.webhookId, token: proxy.webhookToken });
      await webhookClient
        .deleteMessage(reaction.message.id, { threadId: proxy.threadId })
        .catch(() => {});
      recentProxies.delete(reaction.message.id);
      return;
    }

    if (emoji === EDIT_EMOJI) {
      if (!isOwner) return;
      let dm;
      try {
        ({ dm } = await sendDm(user, "» *Reply here with the new text for that message (60 seconds).*"));
      } catch {
        return;
      }

      const collected = await dm
        .awaitMessages({
          filter: (m) => m.author.id === user.id,
          max: 1,
          time: 60_000,
        })
        .catch(() => null);

      const reply = collected?.first();
      if (!reply) return;

      const webhookClient = new WebhookClient({ id: proxy.webhookId, token: proxy.webhookToken });
      await webhookClient
        .editMessage(reaction.message.id, { content: reply.content, threadId: proxy.threadId })
        .then(() => sendDm(user, "» *Updated.*"))
        .catch(() => sendDm(user, "» *Couldn't update that message — it may be too old.*"));
      return;
    }

    if (emoji === INSPECT_EMOJI) {
      const character = await prisma.character.findUnique({
        where: { id: proxy.characterId },
        include: { tags: { include: { tag: true } } },
      });
      if (!character) return;

      const visibleTags = character.tags.filter((ct) => ct.tag.visibleOnInspect).map((ct) => ct.tag.name);

      const embed = new EmbedBuilder()
        .setTitle(character.name)
        .setDescription(character.appearance || "No visible appearance.");
      if (visibleTags.length > 0) {
        embed.addFields({ name: "Tags", value: visibleTags.join(", ") });
      }
      if (character.avatarMimeType && process.env.WEB_BASE_URL) {
        embed.setThumbnail(
          `${process.env.WEB_BASE_URL}/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`,
        );
      }

      try {
        await sendDm(user, { embeds: [embed] });
      } catch {
        await reaction.message.channel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  },
};
