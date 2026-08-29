const { prisma, concealedAlias } = require("@lifeweb/db");
const { sendAsCharacter } = require("../lib/proxy");
const { isDesignatedTupperChannel, resolveChannelContext } = require("../lib/channels");
const { sendDm } = require("../lib/dm");
const { REPORT_CHANNEL_ID } = require("@lifeweb/db/lib/reportChannelAccess");
const {
  canHearPing,
  isPrivateThread,
  messageLink,
  notifyMentioned,
  resolveMentionedCharacters,
} = require("../lib/mentions");

// A literal prefix rather than a registered slash command: a slash command
// replies through an interaction, which would not be a webhook message, so
// ✏️ / ❌ / ⭐ / 🔍 would all stop working on it. As a prefix it rides the
// ordinary proxy path and every reaction keeps behaving.
const CONCEAL_PREFIX = "/conceal";

// How many character-role mentions one message may relay. Each one is a user
// fetch, a DM channel open, a send and a database insert, strictly serial —
// so an uncapped list is a fan-out anyone can trigger by pasting mentions.
const MAX_MENTION_RELAYS = 10;

// The Create-a-Topic anchor is a pinned but UNLOCKED forum post — locking it
// would grey its own buttons out for every player (db/lib/syncZones.js). So
// the lock's job moves here: anything typed into an anchor is deleted, and
// never proxied or archived. The id set is cached because this runs on every
// threaded message; anchors only change on a db:sync-zones.
const ANCHOR_CACHE_MS = 60_000;
let anchorIds = null;
let anchorFetchedAt = 0;

async function isCreateTopicAnchor(threadId) {
  if (!anchorIds || Date.now() - anchorFetchedAt > ANCHOR_CACHE_MS) {
    const zones = await prisma.zone.findMany({
      where: { createTopicThreadId: { not: null } },
      select: { createTopicThreadId: true },
    });
    anchorIds = new Set(zones.map((z) => z.createTopicThreadId));
    anchorFetchedAt = Date.now();
  }
  return anchorIds.has(threadId);
}

module.exports = {
  name: "messageCreate",
  async execute(message) {
    if (message.author.bot || message.webhookId) return;

    if (!message.inGuild()) {
      const attachmentNames = message.attachments.size > 0 ? [...message.attachments.values()].map((a) => a.name) : null;
      const content = message.content || (attachmentNames ? `*(attachment: ${attachmentNames.join(", ")})*` : "");
      await prisma.directMessage
        .create({
          data: {
            discordUserId: message.author.id,
            direction: "INBOUND",
            content,
            source: "player",
            discordMessageId: message.id,
            meta: attachmentNames ? { attachments: attachmentNames } : undefined,
          },
        })
        .catch(() => {});
      return;
    }

    // #turns is the console channel: the Travel/Move/Speak buttons live on an
    // anchor message there (bot/src/lib/turnsConsole.js) and everything a
    // player types is simply removed. It no longer files a Move — that is a
    // modal now, so nothing a player writes ever sits in a channel waiting to
    // be deleted, and no typing indicator fires under their real account.
    // The report channel is the same kind of surface: one anchor with an Open
    // Ticket button (bot/src/lib/reportChannel.js), everything typed under it
    // removed. A ticket thread reports itself as message.channel, so this only
    // ever matches the channel proper.
    const channelName = message.channel.name?.toLowerCase();
    if (channelName === "turns" || message.channel.id === REPORT_CHANNEL_ID) {
      await message.delete().catch(() => {});
      return;
    }

    // Same treatment as #turns, and for the same reason: the anchor is a
    // control surface, not a scene. Runs before the character gate so a GM's
    // stray line is swept too.
    if (message.channel.isThread?.() && (await isCreateTopicAnchor(message.channel.id))) {
      await message.delete().catch(() => {});
      return;
    }

    if (!isDesignatedTupperChannel(message.channel)) return;

    // Inactivity clock for player-made threads (db/lib/threadExpiryPass.js).
    // Debounced to one write per thread per turn; runs before the character
    // gate on purpose — a GM talking in a scene keeps it alive too.
    if (message.channel.isThread?.()) {
      touchThreadActivity(message.channel.id).catch((err) =>
        console.error("Thread activity write failed:", err),
      );
    }

    const character = await prisma.character.findFirst({
      where: { discordUserId: message.author.id, status: "ALIVE" },
    });
    if (!character) return;

    const trimmed = message.content.trimStart();
    const wantsConceal = trimmed.toLowerCase().startsWith(CONCEAL_PREFIX);

    let conceal = null;
    let content = null;
    if (wantsConceal) {
      content = trimmed.slice(CONCEAL_PREFIX.length).trim();

      // Open to everyone, with nothing equipped and no tag required — a player
      // decides for themselves when to go unnamed. Tag.concealsIdentity still
      // exists in the catalog but nothing reads it; re-gating is one query here.
      if (!content && message.attachments.size === 0) {
        await message.delete().catch(() => {});
        await sendDm(message.author, "» *Add a message after `/conceal`.*", { source: "system_notice" }).catch(() => {});
        return;
      }
      conceal = { alias: concealedAlias(character) };
    }

    // Captured BEFORE proxying: sendAsCharacter deletes the original message,
    // and the mention list goes with it.
    const mentionedRoleIds = [...message.mentions.roles.keys()];
    const channel = message.channel;

    // sendAsCharacter owns the failure path now: it deletes the original on
    // every route and DMs the player their text back, so a message that can't
    // be proxied never sits in the channel under their real name. A null means
    // it refused, and there is no proxied message left to relay mentions for.
    let proxied;
    try {
      proxied = await sendAsCharacter(channel, character, message, { conceal, content });
    } catch (err) {
      console.error("Failed to proxy message:", err);
      return;
    }
    if (!proxied) return;

    // A concealed message deliberately relays nothing: the whole point is that
    // the room doesn't know who spoke, and a DM naming the location would hand
    // the target a thread to pull on.
    if (conceal || mentionedRoleIds.length === 0) return;

    await handleMentions({ message, channel, proxied, mentionedRoleIds }).catch((err) =>
      console.error("Failed to handle mentions:", err),
    );
  },
};

// In-memory debounce: threadId -> the turn number already recorded. A busy
// thread costs one UPDATE per turn instead of one per message; the sweep also
// re-derives activity from each thread's last_message_id snowflake, so a
// restart losing this map costs nothing.
const activityWritten = new Map();

async function touchThreadActivity(threadId) {
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  const turnNumber = openTurn?.number ?? null;
  if (turnNumber !== null && activityWritten.get(threadId) === turnNumber) return;

  const updated = await prisma.playerThread.updateMany({
    where: { threadId },
    data: { lastActivityTurn: turnNumber ?? undefined, lastActivityAt: new Date() },
  });
  // Only remember threads we actually track — a Location topic has no row,
  // and caching its id would just grow the map.
  if (updated.count > 0 && turnNumber !== null) activityWritten.set(threadId, turnNumber);
}

// Two independent things a character-role mention does, both of which the bot
// has to perform itself once the roles are assigned to nobody (see the
// identity/access split): notify the player, and — in a private thread — let
// them in, which Discord used to do for free by auto-adding a mentioned role's
// members.
async function handleMentions({ message, channel, proxied, mentionedRoleIds }) {
  const context = resolveChannelContext(channel);
  const mentioned = await resolveMentionedCharacters(mentionedRoleIds);

  // Every gate on this path used to reject in total silence, and the proxy
  // suppresses the role ping itself (allowedMentions parse: ["users"]), so a
  // swallowed mention looks exactly like a delivered one — the chip renders
  // either way. One line per ping makes the whole thing diagnosable from the
  // Railway logs.
  console.log(
    `[mentions] roles=${mentionedRoleIds.join(",")} resolved=${mentioned.length} ` +
      `zone=${context.zoneId ?? "none"} kind=${context.channelKind ?? "location"}`,
  );
  if (mentioned.length === 0) return;

  // One message can name every character role in the game, and each target
  // costs a user fetch, a DM channel open, a send and a database insert — all
  // serialized, all after the room has already seen the message. Ten is well
  // past any legitimate ping and the refusal names who was dropped, so nothing
  // goes missing silently.
  const relayed = mentioned.slice(0, MAX_MENTION_RELAYS);
  const dropped = mentioned.slice(MAX_MENTION_RELAYS);
  if (dropped.length > 0) {
    console.log(`[mentions] capped at ${MAX_MENTION_RELAYS}, skipped ${dropped.length}`);
    await sendDm(
      message.author,
      `» *That pinged ${mentioned.length} people at once, so only the first ${MAX_MENTION_RELAYS} were told. ` +
        `Not notified: ${dropped.map((t) => t.name).join(", ")}.*`,
      { source: "system_notice" },
    ).catch(() => {});
  }

  const link = messageLink(message.guildId, channel.id, proxied.id);
  const privateThread = isPrivateThread(channel);

  // Collected rather than sent one-per-target: a message naming five people
  // who are all somewhere else used to DM the author five separate times.
  const notHere = [];

  for (const target of relayed) {
    if (privateThread) {
      // A mention into a private thread is an invite, same contract as /add:
      // recorded, applied now if the target can already see the zone, and
      // replayed by applyPendingInvites when they arrive otherwise.
      await prisma.playerThreadInvite
        .upsert({
          where: { threadId_characterId: { threadId: channel.id, characterId: target.id } },
          update: {},
          create: { threadId: channel.id, characterId: target.id },
        })
        .catch((err) => console.error("Failed to record thread invite:", err));
      if (context.zoneId && target.zoneId === context.zoneId) {
        await channel.members.add(target.discordUserId).catch((err) =>
          console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err),
        );
        await notifyMentioned(message.client, target, context, link);
      } else {
        console.log(`[mentions] ${target.name}: not in ${context.zoneName ?? "this zone"}, invite recorded`);
        notHere.push(target.name);
      }
      continue;
    }

    const heard = await canHearPing(target, context);
    console.log(`[mentions] ${target.name}: ${heard ? "notified" : "out of earshot, no DM"}`);
    if (heard) {
      await notifyMentioned(message.client, target, context, link);
    }
  }

  if (notHere.length > 0) {
    const where = context.zoneName ?? "this zone";
    await sendDm(
      message.author,
      notHere.length === 1
        ? `» *${notHere[0]} isn't in ${where} — they're invited, and they'll see this thread when they arrive.*`
        : `» *${notHere.join(", ")} aren't in ${where} — they're invited, and they'll see this thread when they arrive.*`,
      { source: "system_notice" },
    ).catch(() => {});
  }
}
