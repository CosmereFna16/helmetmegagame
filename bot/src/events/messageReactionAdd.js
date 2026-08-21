const { WebhookClient, EmbedBuilder } = require("discord.js");
const { prisma, formatTagRequirement, turnsLeft, formatTurnsLeft } = require("@lifeweb/db");
const { getSiloAccess } = require("@lifeweb/db/lib/factionPermissions");
const { inspectVision } = require("@lifeweb/db/lib/inspectVision");
const { recentProxies } = require("../lib/proxy");
const { sendDm } = require("../lib/dm");

const DELETE_EMOJI = "❌"; // ❌
const EDIT_EMOJIS = ["✏️", "📝"]; // ✏️ pencil, 📝 memo (pencil and paper)
const INSPECT_EMOJIS = ["🔍", "🔎"]; // 🔍 left-pointing, 🔎 right-pointing (rotated) magnifying glass
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

    if (EDIT_EMOJIS.includes(emoji)) {
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

    if (INSPECT_EMOJIS.includes(emoji)) {
      // The inspected character, and the inspector — what the embed shows
      // depends on both. Seductive/Torturer (and their Demoness twins) are
      // read off the REACTOR, not the subject: they're the sight, not the
      // thing seen.
      const [character, viewer, openTurn] = await Promise.all([
        prisma.character.findUnique({
          where: { id: proxy.characterId },
          include: {
            tags: { include: { tag: { include: { requirementSkills: { select: { name: true } } } } } },
            faction: { select: { name: true } },
          },
        }),
        prisma.character.findFirst({
          where: { discordUserId: user.id, status: "ALIVE" },
          select: { tags: { select: { tag: { select: { slug: true } } } } },
        }),
        prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
      ]);
      if (!character) return;

      const { canSeeDesire, canSeeFear } = inspectVision(viewer?.tags ?? []);

      // Each entry is the tag name, plus a parenthetical carrying the minified
      // "cost to add/remove" (see formatTagRequirement, @lifeweb/db) and how
      // long it has left, whichever are set. Same `·` separator the web
      // tooltip uses, so both faces of the game read alike — mind Discord's
      // 1024-char embed field cap.
      const visibleTags = character.tags
        .filter((ct) => ct.tag.visibleOnInspect)
        .map((ct) => {
          const bits = [
            formatTagRequirement(ct.tag),
            formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurn?.number)),
          ].filter(Boolean);
          return bits.length > 0 ? `${ct.tag.name} (${bits.join(" · ")})` : ct.tag.name;
        });

      const embed = new EmbedBuilder()
        .setTitle(character.name)
        .setDescription(character.appearance || "No visible appearance.");
      if (visibleTags.length > 0) {
        embed.addFields({ name: "Tags", value: visibleTags.join(", ") });
      }

      // An unseen field is ABSENT, never a "hidden" placeholder — a
      // placeholder advertises that there's something worth going after.
      // Same posture as the Resources field below. Nothing tells the subject
      // they were read, either; every inspect is silent.
      if (canSeeDesire) {
        const desire = await prisma.desire.findFirst({
          where: { characterId: character.id, status: "ACTIVE" },
          select: { text: true, points: true },
        });
        if (desire) {
          embed.addFields({ name: "Desire", value: `${desire.text} (+${desire.points})` });
        }
      }

      if (canSeeFear && character.worstFear) {
        embed.addFields({ name: "Worst Fear", value: character.worstFear });
      }

      // Whoever holds Silo authority over this character's faction — its
      // Leader/Treasurer, or an ancestor faction's — sees what they're
      // carrying, the same gate /faction's roster column uses. For anyone
      // else the field is simply absent rather than a "hidden" placeholder,
      // which would advertise that there's a number to go looking for.
      // Unaffiliated is the DB's placeholder home for the factionless, so
      // nobody inherits authority over it.
      if (character.factionId && character.faction?.name !== "Unaffiliated") {
        const access = await getSiloAccess(prisma, user.id, character.factionId);
        if (access.canManageSilo) {
          embed.addFields({ name: "Resources", value: `${character.resources} ⬢`, inline: true });
        }
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
