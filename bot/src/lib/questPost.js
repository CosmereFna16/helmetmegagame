// Quest posts: a GM's hand-made forum post, re-authored as the bot.
//
// A GM hangs a quest hook by pressing Discord's own New Post button in a
// location forum — not the Create-a-Topic flow, which is a player surface and
// files everything through a modal. Two things are wrong with what Discord
// leaves behind, and this module fixes both in one pass:
//
//   1. The post is authored by the GM's REAL account, which is exactly the
//      player/character separation the proxy pipeline exists to protect. And
//      if that GM also has a living character, the ordinary proxy path would
//      try to repost the starter message — deleting a forum post's starter
//      message destroys the whole post. So this runs BEFORE the proxy gate in
//      messageCreate.js.
//   2. It carries no PlayerThread row, so the Dawn wipe adopts it at
//      persistent: false and deletes it, thread and all, on the second Dawn.
//
// The conversion: delete the post, immediately re-create it verbatim as
// Bascinet, tagged Quest, starter message pinned, and recorded as a
// PlayerThread with keepStarter (db/lib/dawnWipe.js then empties it every Dawn
// but never touches its starter, and never deletes it). A GM removes it by
// hand when the quest is over.
//
// Text only, on purpose: re-uploading attachments would mean downloading and
// re-posting multipart bodies on the gateway's hot path. An attachment is
// reported back to the GM by DM instead of silently vanishing.
//
// Why "any hand-made post is a GM's": players are denied CREATE_PUBLIC_THREADS
// on every location forum (db/lib/zoneChannelSpec.js#forumSpec), and every
// legitimate bot-made post — the Location topics, the Create-a-Topic anchor, a
// player's topic — arrives with a bot author, which messageCreate.js has
// already filtered out before this is reached. So there is no role check here.
const { ChannelType } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { QUEST_TAG_NAME } = require("@lifeweb/db/lib/persistence");
const { ensureForumTag, createForumPost, deleteThread, pinMessage } = require("@lifeweb/db/lib/discordRest");
const { resolveChannelContext } = require("./channels");
const { sendDm } = require("./dm");
const { messageLink } = require("./mentions");

// True only for the STARTER message of a post in a zone's location forum. A
// forum post's starter message shares the thread's own id, which is what makes
// this a free check — no fetch, no round trip.
function isNewForumPost(message) {
  const channel = message.channel;
  if (message.id !== channel?.id) return false;
  if (typeof channel.isThread !== "function" || !channel.isThread()) return false;
  if (channel.parent?.type !== ChannelType.GuildForum) return false;
  const context = resolveChannelContext(channel);
  return context.channelKind === "public" && Boolean(context.zoneId);
}

async function recordQuestThread({ threadId, name, zoneId, discordUserId }) {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  await prisma.playerThread.create({
    data: {
      threadId,
      kind: "PUBLIC",
      name,
      zoneId,
      // A GM acts as a GM here, so there is no creator character — only the
      // user id, as a snapshot, same posture as every other creator field.
      creatorDiscordUserId: discordUserId,
      persistent: true,
      keepStarter: true,
      lastActivityTurn: openTurn?.number ?? null,
    },
  });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "gm_quest_created",
        details: { threadId, name, zoneId },
      },
    })
    .catch((err) => console.error("Quest-post audit log failed:", err));
}

// Returns true when the message was handled (converted, or deliberately
// refused) and messageCreate should stop. False means "not a quest post" and
// the ordinary pipeline continues.
async function convertToQuestPost(message) {
  if (!isNewForumPost(message)) return false;

  const channel = message.channel;
  const forumId = channel.parentId;
  const { zoneId } = resolveChannelContext(channel);
  const title = channel.name ?? "Quest";
  const content = message.content?.trim() ?? "";
  const attachments = [...message.attachments.values()];

  // Discord refuses a forum post with no message body, so an image-only post
  // cannot be re-sent at all. Leave it standing rather than destroying it —
  // it is the GM's own post, and nothing is exposed by it living one moment
  // longer.
  if (!content) {
    await sendDm(
      message.author,
      "» *A Quest post needs some text — an image-only post can't be re-sent as the bot, so yours was left as it is.*",
      { source: "system_notice" },
    ).catch(() => {});
    return true;
  }

  const questTagId = await ensureForumTag(forumId, QUEST_TAG_NAME, null).catch((err) => {
    console.error(`Couldn't ensure the ${QUEST_TAG_NAME} tag on ${forumId}:`, err);
    return null;
  });

  // The replacement goes up BEFORE the original comes down: a failed create
  // must cost nothing.
  let thread;
  try {
    thread = await createForumPost(forumId, {
      name: title,
      content,
      appliedTags: questTagId ? [questTagId] : [],
      // Mention chips still render; nothing pings. The GM's own post already
      // fired every notification once, and re-firing them from a bot message
      // would double it — while an "@everyone" in GM-typed prose would fire
      // for real out of a message the bot signs.
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`Failed to re-post a Quest post in ${forumId}:`, err);
    await sendDm(
      message.author,
      "» *Couldn't re-post that as the bot, so it's been left under your own name. Try again, or tell the host.*",
      { source: "system_notice" },
    ).catch(() => {});
    return true;
  }

  // The starter message's id IS the thread's id (db/lib/discordRest.js
  // #createForumPost). Best-effort — a failed pin is a missing cue, not a
  // reason to undo a post that is already up.
  await pinMessage(thread.id, thread.id).catch((err) =>
    console.error(`Failed to pin the Quest starter in ${thread.id}:`, err),
  );

  await recordQuestThread({ threadId: thread.id, name: title, zoneId, discordUserId: message.author.id }).catch(
    (err) => console.error(`Failed to record the Quest thread ${thread.id}:`, err),
  );

  // Last, and only now. The original never had a PlayerThread row, so there
  // are no books to clean.
  await deleteThread(channel.id).catch((err) =>
    console.error(`Failed to remove the original Quest post ${channel.id}:`, err),
  );

  if (attachments.length > 0) {
    const link = messageLink(message.guildId, thread.id, thread.id);
    await sendDm(
      message.author,
      `» *Your Quest post was re-posted as the bot, but its ${attachments.length === 1 ? "attachment" : "attachments"} couldn't come along — re-add ${attachments.length === 1 ? "it" : "them"} as a reply.*\n${link}`,
      { source: "system_notice" },
    ).catch(() => {});
  }

  return true;
}

module.exports = { convertToQuestPost, isNewForumPost };
