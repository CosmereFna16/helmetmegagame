const { WebhookClient, EmbedBuilder } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { recentProxies } = require("../lib/proxy");

const DELETE_EMOJI = "❌"; // ❌
const EDIT_EMOJI = "✏️"; // ✏️
const INFO_EMOJI = "❓"; // ❓

async function isGm(reaction, userId) {
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!gmRoleId || !reaction.message.guild) return false;
  const member = await reaction.message.guild.members.fetch(userId).catch(() => null);
  return member?.roles.cache.has(gmRoleId) ?? false;
}

module.exports = {
  name: "messageReactionAdd",
  async execute(reaction, user) {
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);

    const proxy = recentProxies.get(reaction.message.id);
    if (!proxy) return;

    const emoji = reaction.emoji.name;
    const isOwner = user.id === proxy.discordUserId;

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
        dm = await user.createDM();
        await dm.send("Reply here with the new text for that message (60 seconds).");
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
        .then(() => dm.send("Updated!"))
        .catch(() => dm.send("Couldn't update that message — it may be too old."));
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
        const dm = await user.createDM();
        await dm.send({ embeds: [embed] });
      } catch {
        await reaction.message.channel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  },
};
