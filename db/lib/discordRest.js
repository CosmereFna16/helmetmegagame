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

// --- Cloudflare invalid-response circuit breaker -------------------------
//
// Discord fronts its API with Cloudflare, which counts 401/403/429 responses
// and temporarily IP-bans a token that emits 10,000 of them inside a rolling
// 10 minutes. The ban lands on the container's egress IP and lasts about an
// hour. 404 is NOT counted, which is why the deliberately-blind sweeps in
// db/lib/locationAccess.js (allow404, ~58 of every 62 calls hitting nothing)
// are free rather than dangerous.
//
// Reaching 10,000 needs ~17 invalid responses per second sustained, which no
// sequential path here can produce. The breaker exists for the case that can:
// an unattended crash-restart loop replaying the `ready` catch-up burst. It
// trips at a tenth of Discord's ceiling, because the cost of stopping early is
// a delayed sync and the cost of stopping late is an hour of total blackout.
const INVALID_WINDOW_MS = 10 * 60 * 1000;
const INVALID_LIMIT = 1000;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

// A 429's retry_after is honored, but not unboundedly: a channel name/topic
// edit sits in a 2-per-10-minutes bucket and can hand back ~600s, which would
// wedge an entire sequential run (a Dawn wipe, a location sync) behind one
// call. Past the cap it is better to fail that call and let the caller's own
// catch move on.
const MAX_RETRY_AFTER_MS = 30_000;

const invalidTimestamps = [];
let breakerOpenUntil = 0;

function pruneInvalid(now) {
  while (invalidTimestamps.length > 0 && now - invalidTimestamps[0] > INVALID_WINDOW_MS) {
    invalidTimestamps.shift();
  }
}

function recordInvalidResponse(status, path) {
  const now = Date.now();
  invalidTimestamps.push(now);
  pruneInvalid(now);

  if (invalidTimestamps.length >= INVALID_LIMIT && now >= breakerOpenUntil) {
    breakerOpenUntil = now + BREAKER_COOLDOWN_MS;
    console.error(
      `Discord circuit breaker OPEN: ${invalidTimestamps.length} invalid responses ` +
        `(401/403/429) in the last 10 minutes, most recently ${status} on ${path}. ` +
        `Pausing all outbound Discord REST from this process for 10 minutes to stay ` +
        `clear of Cloudflare's 10,000-per-10-minutes IP ban.`,
    );
  }
}

// Observability: the count is meaningless unless someone can see it. Logged at
// bot startup (bot/src/events/ready.js) so a climbing number is visible before
// it becomes a ban rather than after.
function getInvalidResponseStats() {
  const now = Date.now();
  pruneInvalid(now);
  return {
    invalidInWindow: invalidTimestamps.length,
    limit: INVALID_LIMIT,
    breakerOpen: now < breakerOpenUntil,
    breakerOpenUntil: breakerOpenUntil > now ? new Date(breakerOpenUntil).toISOString() : null,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Central fetch wrapper: bounded retry on 429 honoring Discord's
// `retry_after`, throws on any other non-2xx (unless allow404).
async function discordRequest(path, { method = "GET", body, allow404 = false } = {}) {
  const headers = authHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined);

  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() < breakerOpenUntil) {
      throw new Error(
        `Discord ${method} ${path} refused: circuit breaker open until ` +
          `${new Date(breakerOpenUntil).toISOString()} (too many 401/403/429 responses).`,
      );
    }

    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      recordInvalidResponse(res.status, path);
    }

    if (res.status === 429) {
      // A global 429 (or one with no JSON body) is the actual ban-adjacent
      // signal, distinct from an ordinary per-bucket 429 — surface it loudly
      // rather than retrying it silently like any other.
      const payload = await res.json().catch(() => ({}));
      if (payload.global || res.headers.get("X-RateLimit-Global") === "true") {
        console.error(`Discord GLOBAL rate limit hit on ${method} ${path}. This is the ban warning shot.`);
      }
      const retryAfterMs = (Number(payload.retry_after) || 1) * 1000;
      if (retryAfterMs > MAX_RETRY_AFTER_MS) {
        throw new Error(
          `Discord ${method} ${path} failed: 429 with retry_after ${Math.round(retryAfterMs / 1000)}s, ` +
            `over the ${MAX_RETRY_AFTER_MS / 1000}s cap — not waiting.`,
        );
      }
      await sleep(retryAfterMs);
      continue;
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      throw new Error(`Discord ${method} ${path} failed: ${res.status} ${await res.text()}`);
    }

    // Proactive pre-emption: without this the wrapper only ever learns about a
    // bucket by exhausting it, so every sequential run pays a guaranteed 429
    // (and a tick on the ban counter) at each bucket boundary. Spending the
    // reset window here instead costs the same wall-clock and zero 429s.
    if (res.headers.get("X-RateLimit-Remaining") === "0") {
      const resetAfterMs = (Number(res.headers.get("X-RateLimit-Reset-After")) || 0) * 1000;
      if (resetAfterMs > 0) await sleep(Math.min(resetAfterMs, MAX_RETRY_AFTER_MS));
    }

    if (res.status === 204) return null;
    return res.json();
  }
  throw new Error(`Discord ${method} ${path} failed: exhausted retries on 429`);
}

// Posts a local file as a message attachment. Discord takes attachments as
// `multipart/form-data` only — a JSON body can never carry one, which is why
// discordRequest (JSON-only, by design) can't be reused here. The multipart
// body is a `payload_json` part holding the normal message object plus one
// `files[n]` part per file; `attachments[].id` is the *part index*, not a
// snowflake, and must line up with the `files[n]` suffix or Discord drops the
// file silently. fetch sets the multipart boundary itself, so the
// Content-Type header is deliberately left off.
async function postAttachment(channelId, filePath, content = "", components = undefined) {
  const fs = require("node:fs");
  const path = require("node:path");
  const filename = path.basename(filePath);
  const body = new FormData();

  body.append(
    "payload_json",
    JSON.stringify({ content, attachments: [{ id: 0, filename }], ...(components ? { components } : {}) }),
  );
  body.append("files[0]", new Blob([fs.readFileSync(filePath)]), filename);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    if (res.status === 429) {
      const retryAfter = Number((await res.json().catch(() => ({}))).retry_after) || 1;
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Discord POST attachment ${filename} failed: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
  throw new Error(`Discord POST attachment ${filename} failed: exhausted retries on 429`);
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

// allow404 is opt-in: most callers want a stale channel id to fail the run
// loudly (a recorded id pointing at nothing means the DB and Discord disagree),
// but a generated forum post a GM deleted by hand is an ordinary state the sync
// is expected to repair by rebuilding it.
async function getChannel(channelId, { allow404 = false } = {}) {
  return discordRequest(`/channels/${channelId}`, { allow404 });
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

async function postMessage(channelId, content, components = undefined) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: { content, ...(components ? { components } : {}) },
  });
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

// Edits a message the bot itself sent. Used to rewrite a generated forum
// post's STARTER message in place (whose id equals the thread's own id) rather
// than deleting and recreating the whole post — recreating would lose the
// thread id, unpin it, and spam the forum with a new entry on every edit.
async function editMessage(channelId, messageId, content) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: { content },
  });
}

// Creates a forum POST (a thread with a starter message) on a forum channel.
// Distinct from startThread above, which makes a bare type-11 thread on a TEXT
// channel: a forum thread cannot exist without its starter message, and
// `applied_tags` can only be set here or by a later PATCH.
//
// Returns the thread object; `thread.id` doubles as the starter message's id.
async function createForumPost(
  forumChannelId,
  { name, content, appliedTags = [], autoArchiveMinutes = 10080 },
) {
  return discordRequest(`/channels/${forumChannelId}/threads`, {
    method: "POST",
    body: {
      name,
      applied_tags: appliedTags,
      auto_archive_duration: autoArchiveMinutes,
      message: { content },
    },
  });
}

// A thread is a channel as far as the API is concerned, so this is patchChannel
// under a name that says what it's for. The payload keys that matter here:
// `locked`, `archived`, `applied_tags`, and `flags` — where flags bit 1 (value
// 2) is PINNED, which is how a forum post gets pinned to the top of its forum.
// There is no /pins endpoint for forum posts.
const THREAD_FLAG_PINNED = 2;

async function patchThread(threadId, payload) {
  return patchChannel(threadId, payload);
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
//
// Which makes the naive call pattern quietly expensive: the Dawn wipe asks
// once for each Location's forum AND once for its private channel, so 15
// locations pulled the entire guild's thread list 30 times over. `snapshot`
// lets a caller fetch it once and pass it down; see db/lib/dawnWipe.js.
async function fetchActiveThreads() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const { threads } = await discordRequest(`/guilds/${guildId}/threads/active`);
  return threads;
}

async function listActiveThreadsForChannel(channelId, snapshot = null) {
  const threads = snapshot ?? (await fetchActiveThreads());
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

const WEBHOOK_NAME = "Bascinet Tupper";

// REST twin of bot/src/lib/proxy.js#fetchOrCreateWebhook — same webhook name
// and same "reuse the bot's own webhook on this channel, create one only if
// there isn't one" rule, so a channel never ends up with two.
//
// Cached per channel for the process lifetime, mirroring the gateway twin's
// webhookCache in bot/src/lib/proxy.js. The comment here used to claim this
// ran "once per turn at most" and therefore needed no cache; that was wrong.
// postAsCharacter calls it, and db/index.js calls postAsCharacter in a loop
// over every Default Move summary — so a turn with ~100 defaults spent ~100
// redundant GETs on the same handful of location channels, each one a tick
// against that channel's webhook bucket.
//
// A webhook the cache knows about but Discord no longer has is the one stale
// case; executeWebhook throws on it, so the entry is dropped and rebuilt.
const webhookCache = new Map();

function forgetChannelWebhook(channelId) {
  webhookCache.delete(channelId);
}

async function ensureChannelWebhook(channelId) {
  const cached = webhookCache.get(channelId);
  if (cached) return cached;

  const webhook = await fetchOrCreateChannelWebhook(channelId);
  webhookCache.set(channelId, webhook);
  return webhook;
}

async function fetchOrCreateChannelWebhook(channelId) {
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
  try {
    return await postAsCharacterOnce(channelId, content, character);
  } catch (err) {
    // The cached webhook may have been deleted in Discord since we stored it.
    // Forget it and rebuild once before giving up, so one hand-deleted webhook
    // doesn't silently kill every summary post for that channel until restart.
    forgetChannelWebhook(channelId);
    if (String(err.message).includes("webhook")) {
      return postAsCharacterOnce(channelId, content, character);
    }
    throw err;
  }
}

async function postAsCharacterOnce(channelId, content, character) {
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

// Removes a single permission overwrite, so the target falls back to whatever
// it inherits from the category. The counterpart to putChannelOverwrite, and
// the only way to undo an overwrite that shouldn't be there — a PUT can create
// or replace a named target but never delete one, which left the location sync
// structurally unable to repair a channel someone had opened up by hand.
//
// allow404 because "there is no overwrite for this target" is the state the
// caller wanted; a concurrent removal is success, not an error.
async function deleteChannelOverwrite(channelId, targetId) {
  return discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
    method: "DELETE",
    allow404: true,
  });
}

module.exports = {
  // The central wrapper itself, for one-off scripts that need an endpoint
  // with no named helper here and shouldn't hand-roll a fetch without the
  // 429 retry.
  discordRequest,
  // Rolling 401/403/429 count behind discordRequest's circuit breaker; logged
  // at bot startup so the number is observable before it becomes a ban.
  getInvalidResponseStats,
  getGuildChannels,
  createDmChannel,
  getChannel,
  deleteChannel,
  createChannel,
  patchGuildChannelPositions,
  patchChannel,
  postMessage,
  postMessageBatched,
  postAttachment,
  chunkMessage,
  editMessage,
  createForumPost,
  patchThread,
  THREAD_FLAG_PINNED,
  deleteMessage,
  fetchAllMessages,
  bulkDeleteMessages,
  listActiveThreadsForChannel,
  fetchActiveThreads,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  getForumTagId,
  ensureForumTag,
  startThread,
  putChannelOverwrite,
  deleteChannelOverwrite,
  ensureChannelWebhook,
  executeWebhook,
  postAsCharacter,
};
