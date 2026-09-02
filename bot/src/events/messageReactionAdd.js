const { EmbedBuilder } = require("discord.js");
const { prisma, formatTagRequirement, turnsLeft, formatTurnsLeft, concealedLine } = require("@lifeweb/db");
const { getSiloAccess } = require("@lifeweb/db/lib/factionPermissions");
const { inspectVision, isInscrutable } = require("@lifeweb/db/lib/inspectVision");
const {
  HEALTH_CATEGORY,
  buildSkillAncestry,
  satisfiedSkillIds,
  seenByBystander,
  medicallyVisibleTags,
} = require("@lifeweb/db/lib/medicalVision");
const { deleteArchiveMessage } = require("@lifeweb/db/lib/archive");
const { recentProxies, webhookClientFor } = require("../lib/proxy");
const { resolveChannelContext } = require("../lib/channels");
const { GHOST_LINE, claimGhostWhisper } = require("@lifeweb/db/lib/ghostWhisper");

// Discord embed limits: a breach rejects the whole embed silently. Trim with
// fitField/fitDescription below before adding a field.
const EMBED_FIELD_LIMIT = 1024;
const EMBED_DESCRIPTION_LIMIT = 4096;

function fitField(value) {
  const text = String(value ?? "");
  return text.length > EMBED_FIELD_LIMIT ? `${text.slice(0, EMBED_FIELD_LIMIT - 14)}… (+more)` : text;
}

function fitDescription(value) {
  const text = String(value ?? "");
  return text.length > EMBED_DESCRIPTION_LIMIT ? `${text.slice(0, EMBED_DESCRIPTION_LIMIT - 1)}…` : text;
}
const { sendDm } = require("../lib/dm");
const { buildEditPrompt, stashEdit } = require("../lib/editModal");

const DELETE_EMOJI = "❌";
const EDIT_EMOJIS = ["✏️", "📝"];
const INSPECT_EMOJIS = ["🔍", "🔎"];
const STAR_EMOJI = "⭐";
const FOG_EMOJI = "🌫️";
const WIND_EMOJI = "🌬️"; // ghost whisper: works on any message, Cursed only
const DOSSIER_EMOJI = "⚜️"; // GM only

// Saves the message to the reactor's personal Notes list. `proxy` is the
// live recentProxies entry, or null; identity falls back to ArchiveEntry,
// then to the poster's display name for a bot-as-itself post.
async function handleStarReaction(reaction, proxy, user) {
  const message = reaction.message;

  let characterId = null;
  let characterName = null;
  let zoneId = null;

  if (proxy) {
    const character = await prisma.character.findUnique({ where: { id: proxy.characterId } });
    if (!character) return;
    characterId = character.id;
    // A concealed message is filed under the alias it was posted as. The
    // note is already private to the starrer, but recording the real name
    // would quietly hand them the answer the concealment was hiding.
    characterName = proxy.concealed ? (proxy.alias ?? "Unknown") : character.name;
    zoneId = character.zoneId ?? null;
  } else {
    const archived = await prisma.archiveEntry.findUnique({ where: { discordMessageId: message.id } });
    if (archived && archived.characterId) {
      characterId = archived.characterId;
      characterName = archived.concealedAlias ?? archived.characterName ?? "Unknown";
      zoneId = archived.zoneId ?? null;
    } else {
      characterName = message.member?.displayName ?? message.author?.displayName ?? message.author?.username ??
        "Bascinet";
      zoneId = resolveChannelContext(message.channel).zoneId;
    }
  }

  // Plain content covers every bot-as-itself post (none of them are embed-
  // only). The fallback is only for the 🌫️ fog repost, which can carry a
  // relayed embed instead of content.
  const content = message.content || message.embeds?.[0]?.description || message.embeds?.[0]?.title || "";
  if (!content && message.attachments?.size === 0) return;

  await prisma.note.upsert({
    where: { discordMessageId_discordUserId: { discordMessageId: message.id, discordUserId: user.id } },
    create: {
      discordMessageId: message.id,
      discordChannelId: message.channelId,
      characterId,
      characterName,
      zoneId,
      content,
      sentAt: message.createdAt,
      discordUserId: user.id,
    },
    update: {},
  });
}

// GM-only: everything a GM needs about whoever just spoke, in one DM. No
// vision gates, concealment ignored. No channel fallback if the DM bounces —
// that would hand the room the tags and Desire, so it logs and drops.
async function handleDossierReaction(reaction, proxy, user) {
  const [character, openTurn] = await Promise.all([
    prisma.character.findUnique({
      where: { id: proxy.characterId },
      include: {
        tags: { include: { tag: true } },
        faction: { select: { name: true } },
        location: { select: { name: true } },
        zone: { select: { name: true } },
      },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }),
  ]);
  if (!character) return;

  const [action, desires] = await Promise.all([
    openTurn
      ? prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id } })
      : null,
    // Last fulfilled Desire (claimed retroactively — see DESIRES.md §1).
    prisma.desire.findMany({
      where: { characterId: character.id, status: "FULFILLED" },
      orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
      take: 1,
      select: { text: true, points: true },
    }),
  ]);

  const where = [character.location?.name, character.zone?.name].filter(Boolean).join(" · ") || "nowhere";
  const embed = new EmbedBuilder()
    .setTitle(character.name)
    .setDescription(fitDescription(character.appearance || "No visible appearance."))
    .addFields({
      name: "Standing",
      value: [
        where,
        character.faction?.name ?? "Unaffiliated",
        `${character.resources} ⬢`,
        proxy.concealed ? `concealed as ${proxy.alias ?? "Unknown"}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });

  // Mind Discord's 1024-char embed field cap — a long-lived character can
  // carry a lot of tags, so the list is trimmed rather than rejected whole.
  if (character.tags.length > 0) {
    const rendered = character.tags.map((ct) => {
      const bits = [
        formatTagRequirement(ct.tag),
        formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurn?.number)),
        ct.equipped ? "worn" : null,
        ct.quantity > 1 ? `x${ct.quantity}` : null,
      ].filter(Boolean);
      return bits.length > 0 ? `${ct.tag.name} (${bits.join(" · ")})` : ct.tag.name;
    });
    embed.addFields({ name: "Tags", value: fitField(rendered.join(", ")) });
  }

  embed.addFields({
    name: "This turn",
    value: action
      ? [
          action.moveKind ? (action.moveKind === "GAMBIT" ? "Gambit" : "Routine") : "Move",
          action.moveReviewStatus,
          action.diceRoll != null
            ? `🎲 ${action.diceRoll}${action.diceModifier ? ` (${action.diceModifier > 0 ? "+" : ""}${action.diceModifier})` : ""}`
            : null,
          action.resourceDelta != null ? `${action.resourceDelta > 0 ? "+" : ""}${action.resourceDelta} ⬢` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "Has not acted.",
  });

  if (desires.length > 0) {
    embed.addFields({
      name: "Last Desire",
      value: fitField(desires.map((d) => `» ${d.text} (+${d.points})`).join("\n")),
    });
  }

  if (process.env.WEB_BASE_URL) {
    embed.setThumbnail(`${process.env.WEB_BASE_URL}/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`);
  }

  await sendDm(user, { embeds: [embed] });
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

// The wind emoji arrives with or without its U+FE0F variation selector
// depending on client, so a bare === misses half of them.
function isWindEmoji(name) {
  return typeof name === "string" && name.replace(/️/g, "") === WIND_EMOJI.replace(/️/g, "");
}

// Cursed-only: a ghost breathes one line into the channel as the bot itself,
// at most once every 12 real hours per ghost (db/lib/ghostWhisper.js).
// Silence is the failure mode — a non-ghost or a blocked ghost gets nothing
// visible, so pressing it never outs who's watching. Only the cooldown DMs.
async function handleWindReaction(reaction, user) {
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (!cursedRoleId) return;

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  if (!member?.roles.cache.has(cursedRoleId)) return;

  const { channelKind } = resolveChannelContext(reaction.message.channel);
  if (channelKind !== "summary" && channelKind !== "public") return;

  const claim = await claimGhostWhisper(prisma, user.id);
  if (!claim.ok) {
    const readyAt = Math.floor(claim.readyAt.getTime() / 1000);
    await sendDm(user, {
      content: `The wind won't answer yet. You can blow through again <t:${readyAt}:R>.`,
    }).catch(() => {});
    return;
  }

  await reaction.message.channel.send(GHOST_LINE).catch(() => {});
}

module.exports = {
  name: "messageReactionAdd",
  async execute(reaction, user) {
    if (user.bot) return;

    // Gate on the gateway payload before paying for a fetch (Partials makes
    // every reaction in the guild cost two REST calls otherwise).
    const emojiName = reaction.emoji?.name;

    // guildId, not guild: a partial message has the former, not always the
    // latter. Nothing is reaction-driven in a DM.
    if (!reaction.message.guildId) return;
    // 🌬️ and ⭐ work on any guild message; every other reaction needs a
    // tracked proxy.
    if (
      emojiName !== FOG_EMOJI &&
      !isWindEmoji(emojiName) &&
      emojiName !== STAR_EMOJI &&
      !recentProxies.has(reaction.message.id)
    ) {
      return;
    }

    if (reaction.partial) await reaction.fetch().catch(() => null);
    if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
    if (!reaction.message.guild) return;

    if (reaction.emoji.name === FOG_EMOJI) {
      await handleFogReaction(reaction, user).catch(() => {});
      recentProxies.delete(reaction.message.id);
      return;
    }

    if (isWindEmoji(reaction.emoji.name)) {
      await handleWindReaction(reaction, user).catch((err) => console.error("Wind reaction failed:", err));
      await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      return;
    }

    const proxy = recentProxies.get(reaction.message.id) ?? null;

    const emoji = reaction.emoji.name;

    // ⭐ doesn't require a proxy, so it comes before the `if (!proxy) return`
    // bail every other reaction needs.
    if (emoji === STAR_EMOJI) {
      if (proxy || reaction.message.author?.id === reaction.client.user.id || reaction.message.webhookId) {
        await handleStarReaction(reaction, proxy, user).catch(() => {});
        await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      }
      return;
    }

    if (!proxy) return;

    const isOwner = user.id === proxy.discordUserId;

    if (emoji === DOSSIER_EMOJI) {
      if (!(await isGm(reaction, user.id))) return;
      await handleDossierReaction(reaction, proxy, user).catch((err) =>
        console.error("Dossier reaction failed:", err),
      );
      await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      return;
    }

    if (emoji === DELETE_EMOJI) {
      if (!isOwner && !(await isGm(reaction, user.id))) return;
      const webhookClient = webhookClientFor({ id: proxy.webhookId, token: proxy.webhookToken });
      const deleted = await webhookClient
        // Webhook#deleteMessage(message, threadId) takes a plain string, not
        // an options object, or Discord 400s every ❌ in a thread.
        .deleteMessage(reaction.message.id, proxy.threadId ?? undefined)
        .then(() => true)
        .catch((err) => {
          console.error("Failed to delete proxied message:", err);
          return false;
        });
      if (deleted) {
        await deleteArchiveMessage(prisma, reaction.message.id);
        recentProxies.delete(reaction.message.id);
      }
      await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip ❌ reaction:", err));
      return;
    }

    if (EDIT_EMOJIS.includes(emoji)) {
      if (!isOwner) return;
      // A reaction carries no interaction token, so it can only stash the
      // text and DM a button whose click opens the modal (editModal.js).
      stashEdit(reaction.message.id, reaction.message.content);
      await sendDm(user, buildEditPrompt(reaction.message.id), { source: "system_notice" }).catch((err) =>
        console.error(`Couldn't send the edit prompt to ${user.id}:`, err),
      );
      await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      return;
    }

    if (INSPECT_EMOJIS.includes(emoji)) {
      // Reaction clears in the finally, so a thrown error never leaves 🔍
      // stuck on the message.
      try {
        const viewer = await prisma.character.findFirst({
          where: { discordUserId: user.id, status: "ALIVE" },
          select: { factionId: true, tags: { select: { tagId: true, tag: { select: { slug: true } } } } },
        });
        const { canSeeDesire, ragingBlind } = inspectVision(viewer?.tags ?? []);
        if (ragingBlind) {
          try {
            await sendDm(user, "No time, no time!", { source: "system_notice" });
          } catch (err) {
            console.error("Inspect reaction DM failed (raging):", err);
          }
          return;
        }

        // Seductive/Demoness reads off the reactor, not the subject. A
        // concealed message gets a hardcoded, impoverished embed instead of
        // the normal field logic below, so nothing leaks through it.
        if (proxy.concealed) {
          const concealedChar = await prisma.character.findUnique({
            where: { id: proxy.characterId },
            select: {
              tags: {
                select: {
                  equipped: true,
                  tag: {
                    select: {
                      name: true,
                      inspectVisibility: true,
                      category: true,
                    },
                  },
                },
              },
            },
          });
          if (!concealedChar) return;

          const seen = concealedChar.tags.filter((ct) => seenByBystander(ct.tag, ct));
          // Tag.category stores the display name, not the YAML slug.
          const ailments = seen
            .filter((ct) => ct.tag.category === HEALTH_CATEGORY)
            .map((ct) => ct.tag.name);
          const worn = seen.filter((ct) => ct.tag.category !== HEALTH_CATEGORY).map((ct) => ct.tag.name);

          const hidden = new EmbedBuilder().setDescription(concealedLine(proxy.alias));
          if (ailments.length > 0) hidden.addFields({ name: "Ailments", value: fitField(ailments.join(", ")) });
          if (worn.length > 0) hidden.addFields({ name: "Equipment", value: fitField(worn.join(", ")) });
          if (process.env.WEB_BASE_URL) {
            hidden.setThumbnail(`${process.env.WEB_BASE_URL}/assets/unknown.png`);
          }

          try {
            await sendDm(user, { embeds: [hidden] });
          } catch (err) {
            console.error("Inspect reaction DM failed (concealed):", err);
          }
          return;
        }

        const [character, openTurn, skillCatalog] = await Promise.all([
          prisma.character.findUnique({
            where: { id: proxy.characterId },
            include: {
              tags: { include: { tag: { include: { requirementSkills: { select: { id: true, name: true } } } } } },
              faction: { select: { name: true } },
            },
          }),
          prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
          // Tier chain: holding Medical (Expert) must satisfy a requirement
          // written against Medical (Basic).
          prisma.tag.findMany({ select: { id: true, parentTagId: true } }),
        ]);
        if (!character) return;

        // The doctor's eye: an affliction treatable as ROUTINE is one you can
        // recognise on sight; anything needing a Gambit stays hidden.
        const satisfied = satisfiedSkillIds(
          (viewer?.tags ?? []).map((ct) => ct.tagId),
          buildSkillAncestry(skillCatalog),
        );

        // Treat cost shows for a Health tag only — a bystander has no
        // business learning what forging a worn sword takes.
        const visibleTags = medicallyVisibleTags(character.tags, satisfied).map(({ characterTag: ct, viaSkill }) => {
          const bits = [
            ct.tag.category === HEALTH_CATEGORY ? formatTagRequirement(ct.tag) : null,
            formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurn?.number)),
            viaSkill ? "your diagnosis" : null,
          ].filter(Boolean);
          return bits.length > 0 ? `${ct.tag.name} (${bits.join(" · ")})` : ct.tag.name;
        });

        const embed = new EmbedBuilder()
          .setTitle(character.name)
          .setDescription(fitDescription(character.appearance || "No visible appearance."));
        if (visibleTags.length > 0) {
          embed.addFields({ name: "Tags", value: fitField(visibleTags.join(", ")) });
        }

        // An unseen field is absent, never a "hidden" placeholder — nothing
        // tells the subject they were read either. Once the viewer holds the
        // sight, an empty result gets an explicit "nothing there" line so it
        // reads the same as Inscrutable's block (db/lib/inspectVision.js).
        if (canSeeDesire) {
          const desires = isInscrutable(character.tags)
            ? []
            : await prisma.desire.findMany({
                where: { characterId: character.id, status: "FULFILLED" },
                orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
                take: 1,
                select: { text: true, points: true },
              });
          embed.addFields({
            name: "Last Desire",
            value:
              desires.length > 0
                ? fitField(desires.map((d) => `» ${d.text} (+${d.points})`).join("\n"))
                : "Nothing you can read.",
          });
        }

        // Role is same-faction knowledge, not Silo authority — no ancestor
        // walk, unlike getSiloAccess below.
        if (
          character.factionId &&
          character.faction?.name !== "Unaffiliated" &&
          viewer?.factionId === character.factionId &&
          character.roleTitle
        ) {
          embed.addFields({ name: "Role", value: character.roleTitle, inline: true });
        }

        // Silo authority (Leader/Treasurer, or an ancestor faction's) gates
        // Resources visibility, same as /faction's roster column.
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
        } catch (err) {
          console.error("Inspect reaction DM failed:", err);
        }
      } finally {
        await reaction.users.remove(user.id).catch((err) => console.error("Failed to strip reaction:", err));
      }
    }
  },
};
