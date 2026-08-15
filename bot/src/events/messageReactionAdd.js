const { WebhookClient, EmbedBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { recentProxies } = require("../lib/proxy");
const { sendDm } = require("../lib/dm");

const DELETE_EMOJI = "❌"; // ❌
const EDIT_EMOJI = "✏️"; // ✏️
const INFO_EMOJI = "❓"; // ❓
const CONFIRM_EMOJI = "⚜️"; // ⚜
const STAR_EMOJI = "⭐"; // ⭐
const FOG_EMOJI = "🌫️"; // :fog:

function rollDie(sides = 6) {
  return 1 + Math.floor(Math.random() * sides);
}

async function handleActionConfirm(reaction, user) {
  if (reaction.emoji.name !== CONFIRM_EMOJI) return;

  const action = await prisma.action.findUnique({
    where: { confirmDmMessageId: reaction.message.id },
    include: { character: true },
  });
  if (!action || action.status !== "PENDING") return;
  if (action.character.discordUserId !== user.id) return;

  const diceRoll = action.type === "MOVE" ? rollDie() : null;

  await prisma.action.update({
    where: { id: action.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      ...(diceRoll != null ? { diceRoll } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: user.id,
      actionType: "action_confirmed",
      targetCharacterId: action.characterId,
      details: { actionId: action.id, diceRoll },
    },
  });

  // Discord won't let a bot remove another user's reaction in a DM channel
  // (no MANAGE_MESSAGES concept there), so deleting the message and sending
  // a fresh one is the only reliable way to clear the confirm reaction.
  await reaction.message.delete().catch(() => {});

  const waitingLines = diceRoll != null ? [`🎲 **${diceRoll}**`, "» *Waiting on adjudication...*"] : ["» *Waiting on adjudication...*"];
  await sendDm(user, waitingLines.join("\n")).catch(() => {});
}

// Starring a proxied tupper message archives it (or bumps its star count if
// already archived). `reaction.count` is already the post-add total, so this
// stays cheap — no extra Discord fetch needed on the happy path. Also records
// *who* starred it (MessageStar) so a player's own archive view can be
// scoped to only what they starred, rather than everything on the map.
async function handleStarReaction(reaction, proxy, user) {
  const character = await prisma.character.findUnique({ where: { id: proxy.characterId } });
  if (!character) return;

  const archived = await prisma.archivedMessage.upsert({
    where: { discordMessageId: reaction.message.id },
    create: {
      discordMessageId: reaction.message.id,
      discordChannelId: reaction.message.channelId,
      characterId: character.id,
      characterName: character.name,
      zoneId: character.zoneId ?? null,
      content: reaction.message.content ?? "",
      starCount: reaction.count ?? 1,
      sentAt: reaction.message.createdAt,
    },
    update: {
      starCount: reaction.count ?? 1,
    },
  });

  await prisma.messageStar.upsert({
    where: { archivedMessageId_discordUserId: { archivedMessageId: archived.id, discordUserId: user.id } },
    create: { archivedMessageId: archived.id, discordUserId: user.id },
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
      await handleActionConfirm(reaction, user);
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

    if (emoji === INFO_EMOJI) {
      const character = await prisma.character.findUnique({ where: { id: proxy.characterId } });
      if (!character) return;

      const embed = new EmbedBuilder()
        .setTitle(character.name)
        .setDescription(character.appearance || "No bio set.");
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
