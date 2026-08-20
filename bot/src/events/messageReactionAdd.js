const { WebhookClient, EmbedBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { recentProxies } = require("../lib/proxy");
const { sendDm } = require("../lib/dm");

const DELETE_EMOJI = "❌"; // ❌
const EDIT_EMOJI = "✏️"; // ✏️
const INSPECT_EMOJI = "🔍"; // 🔍
const STAR_EMOJI = "⭐"; // ⭐
const FOG_EMOJI = "🌫️"; // :fog:

// Starring a proxied tupper message saves it to the reacting user's personal
// Notes list (web/app/(app)/notes) — a private note, not a shared archive,
// so it's keyed on (message, starrer). Every reaction handled below (🔍/❌/
// ✏️/⭐) is stripped back off right after being processed, so none of them
// show as an accumulating count on the message; ⭐ is the one that also
// persists a Note, and unstarring happens on /notes (a delete button), not
// by reacting again.
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

    // Move DMs are handled entirely by select menus/buttons now (see
    // bot/src/events/interactionCreate.js) — DMs no longer carry any
    // reaction-driven flow, so there's nothing to do for a DM reaction.
    if (!reaction.message.guild) return;

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
      await reaction.users.remove(user.id).catch(() => {});
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
      if (!reply) {
        await reaction.users.remove(user.id).catch(() => {});
        return;
      }

      const webhookClient = new WebhookClient({ id: proxy.webhookId, token: proxy.webhookToken });
      await webhookClient
        .editMessage(reaction.message.id, { content: reply.content, threadId: proxy.threadId })
        .then(() => sendDm(user, "» *Updated.*"))
        .catch(() => sendDm(user, "» *Couldn't update that message — it may be too old.*"));
      await reaction.users.remove(user.id).catch(() => {});
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
      if (process.env.WEB_BASE_URL) {
        embed.setThumbnail(
          `${process.env.WEB_BASE_URL}/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`,
        );
      }

      try {
        await sendDm(user, { embeds: [embed] });
      } catch {
        await reaction.message.channel.send({ embeds: [embed] }).catch(() => {});
      }
      await reaction.users.remove(user.id).catch(() => {});
    }
  },
};
