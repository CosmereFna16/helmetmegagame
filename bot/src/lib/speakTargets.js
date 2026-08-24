const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { isDesignatedTupperChannel, resolveChannelContext } = require("./channels");

// Where can this player speak as their character right now?
//
// Deliberately derived, never a hardcoded list. A destination qualifies on
// two tests only:
//
//   1. it is a tupper channel (bot/src/lib/channels.js), so proxying is
//      actually supported there, and
//   2. Discord says this member may actually post in it.
//
// That second test is the live answer to every narrowcast rule without a
// second copy of them: syncCharacterNarrowcastAccess already writes exactly
// the ViewChannel/SendMessages overwrite that computeNarrowcastAccess decided
// on, so Radio-in-the-Depths and Intercom-outside-the-Keep fall out for free.
// It also means a narrowcast channel added later shows up here the moment its
// id lands in refreshLocationChannels' tupperOnly set — nothing to edit.
//
// "Actually post in it" is two different permissions, and conflating them is
// what broke this the first time round:
//
//   - a text/forum CHANNEL needs SendMessages;
//   - a THREAD needs SendMessagesInThreads, which is a different bit.
//
// And the two thread containers are never offered as destinations themselves.
// You cannot post a message to a forum channel (only create a post), and
// `-private` denies SendMessages for @everyone by design — it exists solely to
// spin up private threads (db/lib/syncLocations.js#locationChannelSpec). So
// they are walked for their threads and gated on ViewChannel alone.

const MAX_OPTIONS = 25;

// Group headers are ordinary options — Discord select menus have no option
// groups. Each carries its OWN value: option values must be unique within a
// menu, and reusing one string across every header is what made Discord reject
// the whole payload with a 400, which surfaced as a permanently "thinking"
// ephemeral rather than an error.
const NAV_PREFIX = "say:nav";

const GROUPS = [
  { key: "room", header: "── ROOM ───────────────", emoji: "🏠" },
  { key: "threads", header: "── THREADS ────────────", emoji: "🧵" },
  { key: "broadcast", header: "── BROADCAST ──────────", emoji: "📡" },
];

function isNavValue(value) {
  return typeof value === "string" && value.startsWith(NAV_PREFIX);
}

function canView(channel, member) {
  return Boolean(channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel));
}

function canSpeakInChannel(channel, member) {
  const perms = channel.permissionsFor(member);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
}

function canSpeakInThread(thread, member) {
  const perms = thread.permissionsFor(member);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessagesInThreads);
}

// The one predicate every caller outside this module should use — it picks the
// right permission by what it was handed, so a stale-picker re-check can't
// apply the channel rule to a thread.
function canSpeakInTarget(target, member) {
  if (!target || !member) return false;
  return target.isThread() ? canSpeakInThread(target, member) : canSpeakInChannel(target, member);
}

// A thread is only offered if it is live and joinable: an archived or locked
// thread accepts no messages, and a private thread you are not a member of is
// not yours to speak in even where the parent is visible.
async function threadTargets(channel, member) {
  const out = [];
  const fetched = await channel.threads.fetchActive().catch(() => null);
  const threads = fetched?.threads ?? channel.threads.cache;

  for (const thread of threads.values()) {
    if (thread.archived || thread.locked) continue;
    if (!canSpeakInThread(thread, member)) continue;
    if (thread.type === ChannelType.PrivateThread) {
      const inIt = await thread.members.fetch(member.id).then(
        (m) => m,
        () => null,
      );
      if (!inIt) continue;
    }
    out.push(thread);
  }
  return out;
}

// Returns { options, truncated }, options already ordered room -> threads ->
// broadcast with a header before each non-empty group, and `truncated`
// counting anything that did not fit Discord's 25-option ceiling.
async function listSpeakTargets(guild, member) {
  const buckets = { room: [], threads: [], broadcast: [] };

  for (const channel of guild.channels.cache.values()) {
    if (!isDesignatedTupperChannel(channel)) continue;

    const context = resolveChannelContext(channel);
    const where = context.locationName ?? null;
    const kind = context.channelKind;

    if (kind === "public" || kind === "private") {
      // A thread container, never a destination itself.
      if (!canView(channel, member)) continue;
      for (const thread of await threadTargets(channel, member)) {
        buckets.threads.push({
          value: thread.id,
          label: thread.name.slice(0, 100),
          description: [where, kind === "private" ? "private" : "public"]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 100),
        });
      }
      continue;
    }

    if (!canSpeakInChannel(channel, member)) continue;

    if (kind === "plain") {
      buckets.room.push({
        value: channel.id,
        label: `#${channel.name}`.slice(0, 100),
        description: (where ? `${where} — the main room` : "The main room").slice(0, 100),
      });
    } else {
      // Anything tupper-and-speakable that is not tied to a place: #radio,
      // #intercom, and whatever comes next.
      buckets.broadcast.push({
        value: channel.id,
        label: `#${channel.name}`.slice(0, 100),
        description: "Heard beyond this room",
      });
    }
  }

  const options = [];
  let truncated = 0;
  for (const { key, header, emoji } of GROUPS) {
    const entries = buckets[key];
    if (entries.length === 0) continue;

    // +1 for this group's own header.
    let take = entries;
    if (options.length + entries.length + 1 > MAX_OPTIONS) {
      const room = Math.max(0, MAX_OPTIONS - options.length - 1);
      truncated += entries.length - room;
      if (room === 0) continue;
      take = entries.slice(0, room);
    }

    options.push({ value: `${NAV_PREFIX}:${key}`, label: header });
    options.push(...take.map((o) => ({ ...o, emoji })));
  }

  return { options, truncated };
}

module.exports = {
  listSpeakTargets,
  canSpeakInTarget,
  canSpeakInChannel,
  canSpeakInThread,
  isNavValue,
  NAV_PREFIX,
};
