const { ChannelType, MessageFlags, ThreadAutoArchiveDuration } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { clearMessagesExcept } = require("@lifeweb/db/lib/dawnWipe");
const {
  REPORT_CHANNEL_ID,
  OPEN_BUTTON_ID,
  REPORT_ANCHOR_TEXT,
  REPORT_OPEN_ROW,
  REPORT_CLOSE_ROW,
  syncReportChannelAccess,
} = require("@lifeweb/db/lib/reportChannelAccess");
const { resolveActingMember } = require("./interactionGuild");
const { ack, respond } = require("./respond");

// The OOC report channel: one anchor post with an Open Ticket button, and a
// private thread per report with the reporter and every GM in it. See
// db/lib/reportChannelAccess.js for the id, the access spec and the buttons.
//
// Threads here are deliberately NOT recorded as PlayerThread rows. Every
// sweep — dawnWipe, fullWipe, threadExpiryPass, channelDoctor — walks zone
// channels, SPECIAL_CHANNELS or PlayerThread rows, so an untracked thread
// under a channel none of them know about is left alone. A report lives until
// somebody presses Close.

// Thread names are keyed on the Discord username, not the nickname: nicknames
// are character names and get rewritten by the nickname sync, and the name is
// how "you already have a ticket open" is found.
function ticketName(user) {
  return `Report – ${user.username}`.slice(0, 100);
}

function isReportThread(channel) {
  return channel?.type === ChannelType.PrivateThread && channel.parentId === REPORT_CHANNEL_ID;
}

// Cache first, then Discord: the cache is cold during the ready window, and
// fetchActiveThreads at ready never sees an archived thread. An archived
// ticket still counts — Discord unarchives it on the next message, and a
// second thread under the same name is exactly what this is here to prevent.
async function findOpenTicket(channel, user) {
  const name = ticketName(user);
  const byName = (t) => t.name === name;
  const cached = channel.threads.cache.find(byName);
  if (cached) return cached;
  const active = await channel.threads.fetchActive().catch(() => null);
  const live = active?.threads.find(byName);
  if (live) return live;
  const archived = await channel.threads.fetchArchived({ type: "private" }).catch(() => null);
  return archived?.threads.find(byName) ?? null;
}

async function fetchReportChannel(guild) {
  const channel =
    guild.channels.cache.get(REPORT_CHANNEL_ID) ??
    (await guild.channels.fetch(REPORT_CHANNEL_ID).catch(() => null));
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function isAnchor(message, botUserId) {
  if (message.author?.id !== botUserId) return false;
  return message.components?.some((row) => row.components?.some((c) => c.customId === OPEN_BUTTON_ID));
}

// Cold start, every bot ready: re-assert access, make sure the anchor exists
// (found by its button, not a tracked id — no DB column), and sweep anything
// else out of the channel. The anchor is not pinned: it is the only message.
async function ensureReportAnchor(guild) {
  const channel = await fetchReportChannel(guild);
  if (!channel) {
    console.error(`Report channel: no text channel ${REPORT_CHANNEL_ID} in`, guild.name);
    return;
  }

  await syncReportChannelAccess().catch((err) => console.error("Report channel: access sync failed:", err));

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  let anchor = recent?.find((m) => isAnchor(m, guild.client.user.id)) ?? null;
  if (!anchor) {
    anchor = await channel.send({ content: REPORT_ANCHOR_TEXT, components: [REPORT_OPEN_ROW] });
  }
  await clearMessagesExcept(channel.id, anchor.id).catch((err) =>
    console.error("Report channel: sweep failed:", err),
  );
}

// Spam-click guard: a Set for the in-flight create (a double-click races the
// thread-cache check below otherwise), and a short cooldown after it lands.
const inFlight = new Set();
const lastOpened = new Map();
const OPEN_COOLDOWN_MS = 60_000;

async function handleReportOpen(interaction) {
  await ack(interaction);

  const userId = interaction.user.id;
  if (inFlight.has(userId)) {
    await respond(interaction, "» *One moment — your ticket is already being opened.*");
    return;
  }

  const { guild } = await resolveActingMember(interaction);
  const channel = guild ? await fetchReportChannel(guild) : null;
  if (!channel) {
    await respond(interaction, "» *Couldn't create that — try again, or tell a GM.*");
    return;
  }

  const existing = await findOpenTicket(channel, interaction.user);
  if (existing) {
    await respond(interaction, `» *You already have a ticket open.*\n${existing.url}`);
    return;
  }
  if (Date.now() - (lastOpened.get(userId) ?? 0) < OPEN_COOLDOWN_MS) {
    await respond(interaction, "» *Give it a minute before opening another ticket.*");
    return;
  }

  inFlight.add(userId);
  let thread;
  try {
    thread = await channel.threads.create({
      name: ticketName(interaction.user),
      type: ChannelType.PrivateThread,
      invitable: false,
      // The parent's default is 24h, after which the thread archives itself
      // and vanishes from the active-thread cache. A week is the longest
      // Discord allows; a report that idles that long can be reopened.
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: "OOC report",
    });
    await thread.members.add(userId);

    // The role's member list is warm: nickname.js fetches every member at
    // ready. One fetch as a fallback if it somehow isn't.
    const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
    let gmRole = gmRoleId ? guild.roles.cache.get(gmRoleId) : null;
    if (gmRole && gmRole.members.size === 0) {
      await guild.members.fetch().catch(() => {});
      gmRole = guild.roles.cache.get(gmRoleId);
    }
    for (const member of gmRole?.members.values() ?? []) {
      if (member.user.bot || member.id === userId) continue;
      await thread.members.add(member.id).catch((err) =>
        console.error(`Report ticket: couldn't add GM ${member.id}:`, err),
      );
    }

    const pinned = await thread.send({
      content:
        `${gmRoleId ? `<@&${gmRoleId}> — ` : ""}<@${userId}> opened an OOC report.\n` +
        "Describe the problem here. Press **Close** when it's resolved — that deletes this thread.",
      components: [REPORT_CLOSE_ROW],
      allowedMentions: { users: [userId], roles: gmRoleId ? [gmRoleId] : [] },
    });
    await pinned.pin().catch((err) => console.error("Report ticket: pin failed:", err));
  } catch (err) {
    console.error("Failed to open an OOC report ticket:", err);
    // A thread that exists but never got its reporter or its Close button
    // would answer every retry with "you already have a ticket open". Take
    // it down so the retry starts clean.
    if (thread) await thread.delete("failed report ticket").catch(() => {});
    await respond(interaction, "» *Couldn't create that — try again, or tell a GM.*");
    return;
  } finally {
    inFlight.delete(userId);
  }
  lastOpened.set(userId, Date.now());

  await prisma.auditLog
    .create({
      data: { actorDiscordUserId: userId, actionType: "ooc_report_opened", details: { threadId: thread.id } },
    })
    .catch((err) => console.error("Report-opened audit log failed:", err));

  await respond(interaction, `» *Opened.*\n${thread.url}`, { fleeting: true });
}

// The custom id is a hint, not a lock: only honoured inside a private thread
// under the report channel. Anyone in that thread is the reporter or a GM.
async function handleReportClose(interaction) {
  const thread = interaction.channel;
  if (!isReportThread(thread)) {
    await ack(interaction);
    await respond(interaction, "» *That button only works inside a report ticket.*");
    return;
  }

  // deferUpdate, not deferReply: the thread is about to go, and a "thinking"
  // reply would have nowhere to land. Audit before delete so a failed delete
  // still leaves a record of who tried.
  await ack(interaction, { update: true });
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: interaction.user.id,
        actionType: "ooc_report_closed",
        details: { threadId: thread.id, name: thread.name },
      },
    })
    .catch((err) => console.error("Report-closed audit log failed:", err));

  try {
    await thread.delete("OOC report closed");
  } catch (err) {
    // 10003 Unknown Channel: someone else closed it first — that is success.
    if (err?.code === 10003) return;
    console.error("Failed to close an OOC report ticket:", err);
    // Not respond(): after deferUpdate that would editReply the pinned message.
    await interaction
      .followUp({ content: "» *Couldn't close that — try again, or tell a GM.*", flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
}

module.exports = { ensureReportAnchor, handleReportOpen, handleReportClose };
