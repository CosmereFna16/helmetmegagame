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

// Every active thread in the guild, bucketed by the channel it hangs off.
//
// ONE fetch, outside the channel walk, and that is not an optimisation — the
// per-container version was a live bug. ThreadManager#fetchActive calls
// guild.channels.rawFetchGuildActiveThreads(), which is guild-wide however it
// is invoked, so calling it per container fetched the same whole-guild list
// ~77 times over. Worse, _mapThreads caches every thread it returns into
// guild.channels.cache — the very Map listSpeakTargets was iterating. A JS
// Map iterator visits entries appended during iteration, so those threads
// were then walked as if they were containers, and ThreadChannel extends
// BaseChannel and has no `.threads` (only BaseGuildTextChannel and
// ThreadOnlyChannel get one), so the walk threw
// "Cannot read properties of undefined (reading 'fetchActive')" the moment
// any location had one live thread. That is the Speak hang.
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
    const where = context.locationName ?? null;
    const kind = context.channelKind;

    if (kind === "public" || kind === "private") {
      // A thread container, never a destination itself.
      if (!canView(channel, member)) continue;
      for (const thread of await threadTargets(threadsByParent.get(channel.id) ?? [], member)) {
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
