const { EmbedBuilder } = require("discord.js");
const { prisma, formatTagRequirement, turnsLeft, formatTurnsLeft, concealedLine } = require("@lifeweb/db");
const { getSiloAccess } = require("@lifeweb/db/lib/factionPermissions");
const { inspectVision } = require("@lifeweb/db/lib/inspectVision");
const {
  HEALTH_CATEGORY,
  buildSkillAncestry,
  satisfiedSkillIds,
  medicallyVisibleTags,
} = require("@lifeweb/db/lib/medicalVision");
const { updateArchiveMessage, deleteArchiveMessage } = require("@lifeweb/db/lib/archive");
const { recentProxies, webhookClientFor } = require("../lib/proxy");
const { resolveChannelContext } = require("../lib/channels");
const { GHOST_LINE, claimGhostWhisper } = require("@lifeweb/db/lib/ghostWhisper");

// Discord's embed limits. An embed that breaches either is rejected whole, and
// on the inspect path that meant no DM, no channel fallback, both errors
// swallowed, and the 🔍 left sitting on the message doing nothing. A
// tag-heavy character — the Demoness with a pile of new tags, i.e. exactly who
// gets inspected — reached the field cap easily.
//
// The dossier branch below had this trim inline and the inspect branch had a
// comment reminding itself to and then didn't; now there is one of them.
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

const DELETE_EMOJI = "❌"; // ❌
const EDIT_EMOJIS = ["✏️", "📝"]; // ✏️ pencil, 📝 memo (pencil and paper)
const INSPECT_EMOJIS = ["🔍", "🔎"]; // 🔍 left-pointing, 🔎 right-pointing (rotated) magnifying glass
const STAR_EMOJI = "⭐"; // ⭐
const FOG_EMOJI = "🌫️"; // :fog:
const WIND_EMOJI = "🌬️"; // :wind_blowing_face: — the ghost whisper. Unlike every
                         // other emoji here it works on ANY message, not just a
                         // tracked proxy, and only a Cursed player may press it.
const DOSSIER_EMOJI = "⚜️"; // ⚜️ fleur-de-lis, GM only — also the Move button's
                            // emoji on the #turns console, which is fine:
                            // buttons and reactions share no namespace.

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
      // A concealed message is filed under the alias it was posted as. The
      // note is already private to the starrer, but recording the real name
      // would quietly hand them the answer the concealment was hiding.
      characterName: proxy.concealed ? (proxy.alias ?? "Unknown") : character.name,
      zoneId: character.zoneId ?? null,
      content: reaction.message.content ?? "",
      sentAt: reaction.message.createdAt,
      discordUserId: user.id,
    },
    update: {},
  });
}

// GM-only: everything a GM needs about whoever just spoke, in one DM.
//
// Structurally a sibling of the 🔍 inspect branch below, with every vision
// gate removed — no inspectVision, no medicallyVisibleTags, no Silo check,
// and concealment ignored (a GM sees through it, though the alias is noted so
// they know the room did not).
//
// There is deliberately NO channel fallback when the DM bounces; doing that
// here would hand the room every tag and the Desire. The 🔍 inspect
// branch below used to have one, and it leaked exactly that into a public
// channel whenever the reactor had DMs closed. Both now log and drop instead.
// If a future embed in this file needs a fallback, it is not this kind.
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

  const [action, desire] = await Promise.all([
    openTurn
      ? prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id } })
      : null,
    prisma.desire.findFirst({
      where: { characterId: character.id, status: "ACTIVE" },
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
          action.opposed ? "Opposed" : null,
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

  if (desire) embed.addFields({ name: "Desire", value: `${desire.text} (+${desire.points})` });

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

// The wind emoji reaches us with or without its U+FE0F variation selector
// depending on the client that sent it, and a bare `=== WIND_EMOJI` misses
// half of them. FOG_EMOJI has never had this problem in practice, so it is
// left alone rather than churned.
function isWindEmoji(name) {
  return typeof name === "string" && name.replace(/️/g, "") === WIND_EMOJI.replace(/️/g, "");
}

// Cursed-only: a ghost breathes through the room. Posts one line as the bot
// itself, in whatever channel or forum post the reaction landed in, at most
// once every 12 real hours per ghost (db/lib/ghostWhisper.js).
//
// Silence is the failure mode throughout. A non-ghost who presses it, or a
// ghost who presses it somewhere it doesn't work, gets nothing at all beyond
// their reaction being stripped — a refusal posted in the channel would tell
// the living that a specific someone is watching, which is precisely what the
// mechanic is meant to leave ambiguous. Only the cooldown answers, and it
// answers by DM.
async function handleWindReaction(reaction, user) {
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (!cursedRoleId) return;

  const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
  if (!member?.roles.cache.has(cursedRoleId)) return;

  // "Any summary channel or forum post" — a message inside a forum post
  // reports the thread as its channel, and resolveChannelContext walks to the
  // parent for us. Anything else (a Location's -private channel, #watch,
  // #intercom, #turns, an unmapped channel) resolves to some other kind or to
  // null, and is refused.
  const { channelKind } = resolveChannelContext(reaction.message.channel);
  if (channelKind !== "plain" && channelKind !== "public") return;

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

    // Everything below the fetch used to sit above it, which meant every
    // reaction on any message in the guild cost two REST calls before the
    // handler decided it didn't care about it. Partials.Message/Reaction are
    // enabled, so after every deploy that is *every* reaction in the guild.
    //
    // The gateway payload already carries the emoji, the message id and the
    // guild id, so all three gates below are free — only a reaction that has
    // actually reached a handler pays for the fetch.
    const emojiName = reaction.emoji?.name;

    // Move DMs are handled entirely by select menus/buttons now (see
    // bot/src/events/interactionCreate.js) — DMs no longer carry any
    // reaction-driven flow, so there's nothing to do for a DM reaction.
    // guildId rather than guild: a partial message has the former, not always
    // the latter.
    if (!reaction.message.guildId) return;
    // 🌬️ joins 🌫️ as an emoji that works on ANY guild message. Every other
    // reaction below needs a tracked proxy, and a ghost has to be able to
    // haunt whatever is on screen — including a plain bot post.
    if (emojiName !== FOG_EMOJI && !isWindEmoji(emojiName) && !recentProxies.has(reaction.message.id)) return;

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
      // Stripped like every other handled reaction, so no count accumulates —
      // and so the next ghost's press is a fresh event rather than a no-op on
      // an existing reaction.
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    const proxy = recentProxies.get(reaction.message.id);
    if (!proxy) return;

    const emoji = reaction.emoji.name;
    const isOwner = user.id === proxy.discordUserId;

    if (emoji === DOSSIER_EMOJI) {
      if (!(await isGm(reaction, user.id))) return;
      await handleDossierReaction(reaction, proxy, user).catch((err) =>
        console.error("Dossier reaction failed:", err),
      );
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

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
      const webhookClient = webhookClientFor({ id: proxy.webhookId, token: proxy.webhookToken });
      await webhookClient
        .deleteMessage(reaction.message.id, { threadId: proxy.threadId })
        .catch(() => {});
      // The transcript honors the deletion, so ❌ means gone everywhere and a
      // player can trust the button. The accepted cost is that /archive is an
      // incomplete record — someone can quietly retract what they said.
      await deleteArchiveMessage(prisma, reaction.message.id);
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

      const webhookClient = webhookClientFor({ id: proxy.webhookId, token: proxy.webhookToken });
      await webhookClient
        .editMessage(reaction.message.id, { content: reply.content, threadId: proxy.threadId })
        // Only mirror the edit into the transcript once Discord has accepted
        // it, or a rejected edit (too old) would leave /archive showing text
        // that was never actually posted.
        .then(() => updateArchiveMessage(prisma, reaction.message.id, reply.content))
        .then(() => sendDm(user, "» *Updated.*"))
        .catch(() => sendDm(user, "» *Couldn't update that message, it may be too old.*"));
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    if (INSPECT_EMOJIS.includes(emoji)) {
      // The reaction comes off in a finally, not at the end of the branch.
      // Anything that throws in here — a rejected embed, a Prisma hiccup —
      // used to leave the 🔍 sitting on the message: no embed, no error the
      // player could see, and re-clicking did nothing because the reaction was
      // still theirs. Clearing it means a retry is always one click away.
      try {
        // The inspected character, and the inspector — what the embed shows
        // depends on both. Seductive (and its Demoness twin) is read off the
        // REACTOR, not the subject: it's the sight, not the thing seen.
        // A concealed message answers with a hardcoded, deliberately impoverished
        // embed: what a stranger could see, and nothing else. It returns before
        // any of the normal field logic below, so no appearance, name, Desire,
        // or Resources can leak through a gate that happens to be
        // open for this particular viewer.
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
                      visibleOnInspect: true,
                      category: true,
                    },
                  },
                },
              },
            },
          });
          if (!concealedChar) return;

          const seen = concealedChar.tags.filter((ct) => ct.tag.visibleOnInspect);
          // Health is its own category now, so it IS the ailment set and the
          // category is the right thing to test — this used to have to reach for
          // the status-health group slug to avoid dragging Hungry and the other
          // Status tags in with it. Note the capital: Tag.category stores the display name, not
          // the YAML slug (syncTags.js).
          const ailments = seen
            .filter((ct) => ct.tag.category === HEALTH_CATEGORY)
            .map((ct) => ct.tag.name);
          const worn = seen.filter((ct) => ct.equipped).map((ct) => ct.tag.name);

          const hidden = new EmbedBuilder().setDescription(concealedLine(proxy.alias));
          if (ailments.length > 0) hidden.addFields({ name: "Ailments", value: fitField(ailments.join(", ")) });
          if (worn.length > 0) hidden.addFields({ name: "Equipment", value: fitField(worn.join(", ")) });
          if (process.env.WEB_BASE_URL) {
            hidden.setThumbnail(`${process.env.WEB_BASE_URL}/assets/unknown.png`);
          }

          try {
            await sendDm(user, { embeds: [hidden] });
          } catch (err) {
            // No channel fallback: see handleDossierReaction's header. A
            // bounced DM means this inspect goes nowhere, which is the only
            // safe outcome — a reaction has no ephemeral reply to fall back to.
            console.error("Inspect reaction DM failed (concealed):", err);
          }
          // The finally below clears the reaction on the way out of this return.
          return;
        }

        const [character, viewer, openTurn, skillCatalog] = await Promise.all([
          prisma.character.findUnique({
            where: { id: proxy.characterId },
            include: {
              // requirementSkills carries `id` as well as `name` because the
              // doctor's eye below matches on it, not on the label.
              tags: { include: { tag: { include: { requirementSkills: { select: { id: true, name: true } } } } } },
              faction: { select: { name: true } },
            },
          }),
          prisma.character.findFirst({
            where: { discordUserId: user.id, status: "ALIVE" },
            select: { tags: { select: { tagId: true, tag: { select: { slug: true } } } } },
          }),
          prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
          // Just the tier chain, for the same reason healCharacterRequest reads
          // it: holding Medical (Expert) has to satisfy a requirement written
          // against Medical (Basic).
          prisma.tag.findMany({ select: { id: true, parentTagId: true } }),
        ]);
        if (!character) return;

        const { canSeeDesire } = inspectVision(viewer?.tags ?? []);

        // The doctor's eye: an affliction you could treat as ROUTINE is one you
        // can recognise on sight, even when it's invisible to everyone else —
        // appendicitis, cracked ribs, a bellyful of parasites. Anything needing
        // a Gambit stays hidden, because guessing isn't diagnosing.
        const satisfied = satisfiedSkillIds(
          (viewer?.tags ?? []).map((ct) => ct.tagId),
          buildSkillAncestry(skillCatalog),
        );

        // Each entry is the tag name, plus a parenthetical carrying the minified
        // "cost to add/remove" (see formatTagRequirement, @lifeweb/db) and how
        // long it has left, whichever are set. Same `·` separator the web
        // tooltip uses, so both faces of the game read alike — mind Discord's
        // 1024-char embed field cap.
        const visibleTags = medicallyVisibleTags(character.tags, satisfied).map(({ characterTag: ct, viaSkill }) => {
          const bits = [
            formatTagRequirement(ct.tag, { resources: false }),
            formatTurnsLeft(turnsLeft(ct.expiresTurn, openTurn?.number)),
            // Only the reader is seeing this one. Worth saying so plainly: the
            // patient isn't showing it to the room, and a medic who repeats it
            // as common knowledge has said something nobody else could know.
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

        // An unseen field is ABSENT, never a "hidden" placeholder — a
        // placeholder advertises that there's something worth going after.
        // Same posture as the Resources field below. Nothing tells the subject
        // they were read, either; every inspect is silent.
        //
        // But once the VIEWER holds the sight, an empty result gets an
        // explicit "nothing there" line instead of staying absent — without
        // it, a Seductive holder can't tell "no tag", "tag fired but
        // the target has none set", and "broken" apart, and it reads as
        // scripted. Absence still means "you can't see this" to everyone
        // without the tag, so the no-advertising rule for non-holders is
        // untouched.
        if (canSeeDesire) {
          const desire = await prisma.desire.findFirst({
            where: { characterId: character.id, status: "ACTIVE" },
            select: { text: true, points: true },
          });
          embed.addFields({
            name: "Desire",
            value: desire ? fitField(`${desire.text} (+${desire.points})`) : "Nothing you can read.",
          });
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
        } catch (err) {
          // Same as the concealed branch above, and for a stronger reason:
          // this embed carries the Desire and the doctor's-eye tags.
          console.error("Inspect reaction DM failed:", err);
        }
      } finally {
        // Runs on the concealed branch's early return too.
        await reaction.users.remove(user.id).catch(() => {});
      }
    }
  },
};
