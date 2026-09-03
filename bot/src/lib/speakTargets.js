const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { isDesignatedTupperChannel, resolveChannelContext } = require("./channels");

// Where can this player speak as their character right now?
//
// Derived, never hardcoded: a destination qualifies only if it's a tupper
// channel (bot/src/lib/channels.js) and Discord says the member can post
// there, reusing the narrowcast overwrites directly.
//
// A CHANNEL needs SendMessages; a THREAD needs SendMessagesInThreads — a
// different bit. A thread container (forum/private) is never a destination
// itself; walk it for its threads, gated on ViewChannel alone.

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

// Every active thread in the guild, bucketed by the channel it hangs off.
//
// Fetch ONCE, outside the channel walk: ThreadManager#fetchActive is
// guild-wide regardless of which container calls it, and it caches fetched
// threads into guild.channels.cache — the same Map the channel walk
// iterates — so calling it per container both multiplies the requests and
// corrupts that walk with threads treated as containers.
async function fetchThreadsByParent(guild) {
  const byParent = new Map();
  const fetched = await guild.channels.fetchActiveThreads().catch(() => null);
  for (const thread of (fetched?.threads ?? new Map()).values()) {
    if (!thread.parentId) continue;
    if (!byParent.has(thread.parentId)) byParent.set(thread.parentId, []);
    byParent.get(thread.parentId).push(thread);
  }
  return byParent;
}

// Private-thread membership, cached briefly per (thread, member).
//
// The check below is one REST call per private thread, per press, and private
// threads are where the scheming happens — a busy game has dozens live at
// once. The 🔊 button lives on the #turns console anchor, so turn-open
// produces a synchronized burst of players pressing it, each walking every
// live thread. A short TTL collapses a player's repeated presses within a
// turn to a single walk; it is deliberately short because being added to a
// side-room should show up promptly.
const THREAD_MEMBER_TTL_MS = 60_000;
const threadMemberCache = new Map();

async function isThreadMember(thread, member) {
  const key = `${thread.id}:${member.id}`;
  const hit = threadMemberCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await thread.members.fetch(member.id).then(
    () => true,
    () => false,
  );
  threadMemberCache.set(key, { value, expiresAt: Date.now() + THREAD_MEMBER_TTL_MS });

  // Bounded so a month-long process doesn't accumulate an entry per
  // thread-member pair ever seen. Oldest-first, same shape as
  // bot/src/lib/proxy.js#trackProxy.
  if (threadMemberCache.size > 5000) {
    threadMemberCache.delete(threadMemberCache.keys().next().value);
  }
  return value;
}

// A thread is only offered if it is live and joinable: an archived or locked
// thread accepts no messages, and a private thread you are not a member of is
// not yours to speak in even where the parent is visible.
async function threadTargets(threads, member) {
  const out = [];
  for (const thread of threads) {
    if (thread.archived || thread.locked) continue;
    if (!canSpeakInThread(thread, member)) continue;
    // Only a private thread needs the membership round trip; a public one is
    // speakable by anyone who can see the parent. Gating on type keeps a
    // guild full of public threads at zero extra REST calls.
    if (thread.type === ChannelType.PrivateThread) {
      if (!(await isThreadMember(thread, member))) continue;
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
  const threadsByParent = await fetchThreadsByParent(guild);

  // Snapshot the cache before walking it. guild.channels.cache holds threads
  // as well as channels (GuildChannelManager#cache is typed
  // Collection<Snowflake, GuildChannel|ThreadChannel>), and anything that
  // fetches threads adds more mid-walk. Threads are reached through
  // threadsByParent, never by iteration.
  for (const channel of [...guild.channels.cache.values()]) {
    if (channel.isThread?.()) continue;
    if (!isDesignatedTupperChannel(channel)) continue;

    const context = resolveChannelContext(channel);
    const where = context.locationName ?? context.zoneName ?? null;
    const kind = context.channelKind;

    // A Location channel is both a destination (its top level is the open
    // street) and a thread container (its Rooms and Conversations), so it
    // contributes to two buckets rather than being one or the other.
    if (kind === "location") {
      if (canView(channel, member)) {
        for (const thread of await threadTargets(threadsByParent.get(channel.id) ?? [], member)) {
          buckets.threads.push({
            value: thread.id,
            label: thread.name.slice(0, 100),
            description: (where ?? "").slice(0, 100),
          });
        }
      }
      if (!canSpeakInChannel(channel, member)) continue;
      buckets.room.push({
        value: channel.id,
        label: `#${channel.name}`.slice(0, 100),
        description: (where ? `${where} — the open street ‡` : "The open street ‡").slice(0, 100),
      });
      continue;
    }

    if (!canSpeakInChannel(channel, member)) continue;

    if (kind === "summary") {
      buckets.room.push({
        value: channel.id,
        label: `#${channel.name}`.slice(0, 100),
        description: (where ? `${where} — the main room` : "The main room").slice(0, 100),
      });
    } else {
      // Anything tupper-and-speakable that is not tied to a place: #watch,
      // and whatever comes next.
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
  isNavValue,
};
