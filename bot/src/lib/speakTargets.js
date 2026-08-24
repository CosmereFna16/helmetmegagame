const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { isDesignatedTupperChannel, resolveChannelContext } = require("./channels");

// Where can this player speak as their character right now?
//
// Deliberately derived, never a hardcoded list. A destination qualifies on
// two tests only:
//
//   1. it is a tupper channel (bot/src/lib/channels.js), so proxying is
//      actually supported there, and
//   2. Discord says this member may View + Send in it.
//
// That second test is the live answer to every narrowcast rule without a
// second copy of them: syncCharacterNarrowcastAccess already writes exactly
// the ViewChannel/SendMessages overwrite that computeNarrowcastAccess decided
// on, so Radio-in-the-Depths and Intercom-outside-the-Keep fall out for free.
// It also means a narrowcast channel added later shows up here the moment its
// id lands in refreshLocationChannels' tupperOnly set — nothing to edit.

const MAX_OPTIONS = 25;
const NAV_VALUE = "say:nav";

// Discord select menus have no option groups, so a group header is an
// ordinary option carrying NAV_VALUE. Picking one re-renders the panel
// unchanged rather than doing anything.
const GROUPS = [
  { key: "room", header: "── ROOM ───────────────" },
  { key: "threads", header: "── THREADS ────────────" },
  { key: "broadcast", header: "── BROADCAST ──────────" },
];

function canSpeakIn(channel, member) {
  const perms = channel.permissionsFor(member);
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages);
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
    if (thread.type === ChannelType.PrivateThread) {
      const inIt = await thread.members.fetch(member.id).catch(() => null);
      if (!inIt) continue;
    }
    out.push(thread);
  }
  return out;
}

// Returns [{ value, label, description, group }], already ordered
// room -> threads -> broadcast, with a `truncated` count of anything that did
// not fit Discord's 25-option ceiling.
async function listSpeakTargets(guild, member) {
  const buckets = { room: [], threads: [], broadcast: [] };

  for (const channel of guild.channels.cache.values()) {
    if (!isDesignatedTupperChannel(channel)) continue;
    if (!canSpeakIn(channel, member)) continue;

    const context = resolveChannelContext(channel);
    const where = context.locationName ?? null;

    if (context.channelKind === "plain") {
      buckets.room.push({
        value: channel.id,
        label: `#${channel.name}`,
        description: where ? `${where} — the main room` : "The main room",
        group: "room",
      });
    } else if (context.channelKind === "public" || context.channelKind === "private") {
      for (const thread of await threadTargets(channel, member)) {
        buckets.threads.push({
          value: thread.id,
          label: thread.name.slice(0, 100),
          description: [where, context.channelKind === "private" ? "private" : "public"]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 100),
          group: "threads",
        });
      }
    } else {
      // Anything tupper-and-speakable that is not tied to a place: #radio,
      // #intercom, and whatever comes next.
      buckets.broadcast.push({
        value: channel.id,
        label: `#${channel.name}`,
        description: "Heard beyond this room",
        group: "broadcast",
      });
    }
  }

  const options = [];
  let truncated = 0;
  for (const { key, header } of GROUPS) {
    const entries = buckets[key];
    if (entries.length === 0) continue;
    // +1 for this group's own header.
    if (options.length + entries.length + 1 > MAX_OPTIONS) {
      const room = Math.max(0, MAX_OPTIONS - options.length - 2);
      truncated += entries.length - room;
      if (room === 0) continue;
      entries.length = room;
    }
    options.push({ value: NAV_VALUE, label: header, description: null, group: key });
    options.push(...entries);
  }

  return { options, truncated };
}

module.exports = { listSpeakTargets, canSpeakIn, NAV_VALUE };
