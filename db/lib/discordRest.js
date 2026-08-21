// Low-level Discord REST helpers shared by bot/ and web/ via @lifeweb/db —
// no gateway/discord.js dependency, no `prisma` dependency (kept separate
// from turnAnnouncement.js/dawnWipe.js to avoid a circular require with
// db/index.js, which imports those two). Single-guild (DISCORD_GUILD_ID),
// same convention as web/lib/discordGuild.js and db/prisma/sync-locations.js.

const DISCORD_API = "https://discord.com/api/v10";

function authHeaders(extra) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");
  return { Authorization: `Bot ${token}`, ...extra };
}

// Central fetch wrapper: bounded retry on 429 honoring Discord's
// `retry_after`, throws on any other non-2xx (unless allow404).
async function discordRequest(path, { method = "GET", body, allow404 = false } = {}) {
  const headers = authHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      const retryAfter = Number((await res.json().catch(() => ({}))).retry_after) || 1;
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      throw new Error(`Discord ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
  throw new Error(`Discord ${method} ${path} failed: exhausted retries on 429`);
}

async function getGuildChannels() {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`);
}

async function createChannel(payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`, { method: "POST", body: payload });
}

// Bulk channel/category reorder — Discord's PATCH .../channels endpoint takes
// an array of { id, position } and moves just those, leaving every other
// channel's position untouched.
async function patchGuildChannelPositions(updates) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`, { method: "PATCH", body: updates });
}

async function getChannel(channelId) {
  return discordRequest(`/channels/${channelId}`);
}

async function deleteChannel(channelId) {
  return discordRequest(`/channels/${channelId}`, { method: "DELETE", allow404: true });
}

async function patchChannel(channelId, payload) {
  return discordRequest(`/channels/${channelId}`, { method: "PATCH", body: payload });
}

// Opens (or returns the existing) DM channel with a user. Discord treats this
// as idempotent — repeated calls return the same channel — so there's nothing
// to cache. The logged wrapper that actually sends is db/lib/dm.js#sendDm,
// which lives elsewhere because it needs prisma (see this file's header).
async function createDmChannel(discordUserId) {
  return discordRequest("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: discordUserId },
  });
}

async function postMessage(channelId, content) {
  return discordRequest(`/channels/${channelId}/messages`, { method: "POST", body: { content } });
}

const DISCORD_MESSAGE_LIMIT = 2000;

// Splits text into as few ≤2000-char chunks as possible, preferring to
// break on paragraph boundaries (blank lines) and falling back to a hard
// split for any single paragraph that alone exceeds the cap.
function chunkMessage(text) {
  const paragraphs = text.split("\n\n");
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    for (let i = 0; i < paragraph.length; i += DISCORD_MESSAGE_LIMIT) {
      const piece = paragraph.slice(i, i + DISCORD_MESSAGE_LIMIT);
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length > DISCORD_MESSAGE_LIMIT) {
        if (current) chunks.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Posts text as one message, or as several in order if it exceeds Discord's
// 2000-char limit — used for #info's directory message and thread bodies,
// which are hand-authored and occasionally run long.
async function postMessageBatched(channelId, text) {
  for (const chunk of chunkMessage(text)) {
    await postMessage(channelId, chunk);
  }
}

// Creates a standalone public thread on a text channel with no starter
// message (type 11 = GUILD_PUBLIC_THREAD) — the caller posts the thread's
// first message(s) separately via postMessage/postMessageBatched.
async function startThread(channelId, name, autoArchiveMinutes = 10080) {
  return discordRequest(`/channels/${channelId}/threads`, {
    method: "POST",
    body: { name, type: 11, auto_archive_duration: autoArchiveMinutes },
  });
}

async function deleteMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE", allow404: true });
}

// Paginates GET .../messages (Discord returns newest-first per page) until a
// page comes back short of the page size, then reverses to chronological
// (oldest -> newest) order — ready for archiving in send order.
async function fetchAllMessages(channelId) {
  const pageSize = 100;
  const messages = [];
  let before;

  for (;;) {
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (before) query.set("before", before);
    const page = await discordRequest(`/channels/${channelId}/messages?${query}`);
    if (!page || page.length === 0) break;
    messages.push(...page);
    before = page[page.length - 1].id;
    if (page.length < pageSize) break;
  }

  return messages.reverse();
}

// Bulk-delete requires 2-100 ids and all <14 days old (always true here —
// Dawn cycles every ~12h); a 1-element array errors, so that case falls
// back to a single delete instead.
async function bulkDeleteMessages(channelId, messageIds) {
  for (let i = 0; i < messageIds.length; i += 100) {
    const chunk = messageIds.slice(i, i + 100);
    if (chunk.length === 1) {
      await deleteMessage(channelId, chunk[0]);
    } else if (chunk.length > 1) {
      await discordRequest(`/channels/${channelId}/messages/bulk-delete`, {
        method: "POST",
        body: { messages: chunk },
      });
    }
  }
}

// There's no per-channel "active threads" REST endpoint — only a
// guild-wide one — so this filters client-side by parent_id.
async function listActiveThreadsForChannel(channelId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const { threads } = await discordRequest(`/guilds/${guildId}/threads/active`);
  return threads.filter((t) => t.parent_id === channelId);
}

async function listArchivedThreads(channelId, visibility) {
  const threads = [];
  let before;

  for (;;) {
    const query = before ? `?before=${encodeURIComponent(before)}&limit=100` : "?limit=100";
    const page = await discordRequest(`/channels/${channelId}/threads/archived/${visibility}${query}`);
    if (!page?.threads?.length) break;
    threads.push(...page.threads);
    if (!page.has_more) break;
    before = page.threads[page.threads.length - 1].thread_metadata?.archive_timestamp;
    if (!before) break;
  }

  return threads;
}

async function listArchivedPublicThreads(channelId) {
  return listArchivedThreads(channelId, "public");
}

async function listArchivedPrivateThreads(channelId) {
  return listArchivedThreads(channelId, "private");
}

// Deleting a thread removes it and all its messages in one call.
async function deleteThread(threadId) {
  return discordRequest(`/channels/${threadId}`, { method: "DELETE", allow404: true });
}

async function getForumTagId(channelId, tagName) {
  const channel = await getChannel(channelId);
  return channel.available_tags?.find((t) => t.name === tagName)?.id ?? null;
}

// Idempotent: PATCHing available_tags is a full replacement, so this always
// includes the channel's existing tags plus the new one (omitting `id` lets
// Discord assign it) if it isn't already present. Returns the tag's id,
// read straight off the PATCH response rather than a re-fetch.
async function ensureForumTag(channelId, tagName, emojiName) {
  const channel = await getChannel(channelId);
  const existing = channel.available_tags?.find((t) => t.name === tagName);
  if (existing) return existing.id;

  const updated = await patchChannel(channelId, {
    available_tags: [...(channel.available_tags ?? []), { name: tagName, emoji_name: emojiName }],
  });
  return updated.available_tags.find((t) => t.name === tagName)?.id ?? null;
}

const WEBHOOK_NAME = "Lifeweb Tupper";

// REST twin of bot/src/lib/proxy.js#fetchOrCreateWebhook — same webhook name
// and same "reuse the bot's own webhook on this channel, create one only if
// there isn't one" rule, so a channel never ends up with two. No cache here:
// this runs once per turn at most (db/lib/defaultMovePass.js), not per
// message.
async function ensureChannelWebhook(channelId) {
  const existing = await discordRequest(`/channels/${channelId}/webhooks`);
  const mine = existing?.find((w) => w.token);
  if (mine) return { id: mine.id, token: mine.token };

  const created = await discordRequest(`/channels/${channelId}/webhooks`, {
    method: "POST",
    body: { name: WEBHOOK_NAME },
  });
  return { id: created.id, token: created.token };
}

// Deliberately a bare fetch rather than discordRequest: the webhook token in
// the URL *is* the credential, and sending a bot Authorization header
// alongside it makes Discord authorize the request as the bot instead, which
// it may reject outright.
async function executeWebhook({ id, token }, { content, username, avatarUrl }) {
  const res = await fetch(`${DISCORD_API}/webhooks/${id}/${token}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      username,
      avatar_url: avatarUrl,
      // Player-authored text posted under a character's name — never let it
      // ping a role or @everyone just by typing it.
      allowed_mentions: { parse: ["users"] },
    }),
  });
  if (!res.ok) throw new Error(`Discord webhook execute failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Posts `content` into `channelId` under a character's name and avatar — the
// REST equivalent of a tupper proxy, for anything composed by the game itself
// rather than by a player typing in a channel.
async function postAsCharacter(channelId, character, content) {
  const webhook = await ensureChannelWebhook(channelId);
  const base = process.env.WEB_BASE_URL;
  return executeWebhook(webhook, {
    content,
    username: character.name,
    avatarUrl: base ? `${base}/api/avatar/${character.id}?v=${character.updatedAt?.getTime?.() ?? ""}` : undefined,
  });
}

// Replaces a single permission overwrite on a channel. `type` is 0 for a
// role, 1 for a member; allow/deny are decimal permission bit strings.
async function putChannelOverwrite(channelId, targetId, { allow = "0", deny = "0", type = 0 } = {}) {
  return discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: { id: targetId, type, allow: String(allow), deny: String(deny) },
  });
}

module.exports = {
  getGuildChannels,
  createDmChannel,
  getChannel,
  deleteChannel,
  createChannel,
  patchGuildChannelPositions,
  patchChannel,
  postMessage,
  postMessageBatched,
  deleteMessage,
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  getForumTagId,
  ensureForumTag,
  startThread,
  putChannelOverwrite,
  ensureChannelWebhook,
  executeWebhook,
  postAsCharacter,
};
