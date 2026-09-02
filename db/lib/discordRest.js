// Low-level Discord REST helpers shared by bot/ and web/ via @lifeweb/db —
// no gateway/discord.js dependency. Single-guild (DISCORD_GUILD_ID), same
// convention as web/lib/discordGuild.js.

const { DISCORD_MESSAGE_LIMIT, chunkMessage } = require("./chunkText");

const DISCORD_API = "https://discord.com/api/v10";

function authHeaders(extra) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error("DISCORD_TOKEN is not set.");
  return { Authorization: `Bot ${token}`, ...extra };
}

// Cloudflare counts 401/403/429 responses and IP-bans a token that emits
// 10,000 of them in a rolling 10 minutes (~1hr ban). 404 doesn't count. This
// breaker trips at a tenth of that ceiling to stay well clear.
const INVALID_WINDOW_MS = 10 * 60 * 1000;
const INVALID_LIMIT = 1000;
const BREAKER_COOLDOWN_MS = 10 * 60 * 1000;

// A 429's retry_after is honored only up to this cap — a channel name/topic
// edit can hand back ~600s, which would wedge a whole sequential run behind
// one call. Past the cap the call fails and the caller's catch moves on.
const MAX_RETRY_AFTER_MS = 30_000;

const invalidTimestamps = [];
let breakerOpenUntil = 0;

// Persisted to GameConfig (Cloudflare's count is keyed on egress IP, so a
// restart would otherwise zero it). Loaded once, written only on error.
let persist = null;
let loaded = false;
let sinceLastWrite = 0;
const WRITE_EVERY = 25;

function attachBreakerStore(store) {
  persist = store;
  loaded = false;
}

async function loadBreakerState() {
  if (loaded || !persist) return;
  loaded = true;
  try {
    const saved = await persist.read();
    if (!saved) return;

    const now = Date.now();
    const openUntil = saved.restBreakerOpenUntil ? new Date(saved.restBreakerOpenUntil).getTime() : 0;
    if (openUntil > now) breakerOpenUntil = openUntil;

    // Only a still-live window is worth restoring, as a count rather than
    // individual timestamps (which were never stored).
    const windowStart = saved.restInvalidWindowStart
      ? new Date(saved.restInvalidWindowStart).getTime()
      : 0;
    if (windowStart && now - windowStart < INVALID_WINDOW_MS && saved.restInvalidCount > 0) {
      for (let i = 0; i < saved.restInvalidCount; i++) invalidTimestamps.push(windowStart);
      console.warn(
        `Discord REST: inherited ${saved.restInvalidCount} invalid responses from a previous ` +
          `process in the current 10-minute window. A non-zero count here means the last one ` +
          `died mid-burst.`,
      );
    }
  } catch (err) {
    console.error("Failed to load the persisted Discord breaker state:", err);
  }
}

function saveBreakerState() {
  if (!persist) return;
  persist
    .write({
      restInvalidCount: invalidTimestamps.length,
      restInvalidWindowStart: invalidTimestamps.length > 0 ? new Date(invalidTimestamps[0]) : null,
      restBreakerOpenUntil: breakerOpenUntil > Date.now() ? new Date(breakerOpenUntil) : null,
    })
    .catch((err) => console.error("Failed to persist the Discord breaker state:", err));
}

function pruneInvalid(now) {
  while (invalidTimestamps.length > 0 && now - invalidTimestamps[0] > INVALID_WINDOW_MS) {
    invalidTimestamps.shift();
  }
}

function recordInvalidResponse(status, path) {
  const now = Date.now();
  invalidTimestamps.push(now);
  pruneInvalid(now);

  // Not awaited — sits inside discordRequest and must not add retry latency.
  loadBreakerState();

  if (invalidTimestamps.length >= INVALID_LIMIT && now >= breakerOpenUntil) {
    breakerOpenUntil = now + BREAKER_COOLDOWN_MS;
    console.error(
      `Discord circuit breaker OPEN: ${invalidTimestamps.length} invalid responses ` +
        `(401/403/429) in the last 10 minutes, most recently ${status} on ${path}. ` +
        `Pausing all outbound Discord REST from this process for 10 minutes to stay ` +
        `clear of Cloudflare's 10,000-per-10-minutes IP ban.`,
    );
    invalidTimestamps.length = 0;
    sinceLastWrite = 0;
    saveBreakerState();
    return;
  }

  sinceLastWrite += 1;
  if (sinceLastWrite >= WRITE_EVERY) {
    sinceLastWrite = 0;
    saveBreakerState();
  }
}

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

// Per-bucket rate-limit bookkeeping: a reset is recorded against the bucket
// and paid at the start of the next request on that bucket, not slept on
// immediately, so one exhausted route doesn't stall an unrelated one.
const bucketByRoute = new Map();
const resetAtByBucket = new Map();

// Discord buckets by major parameter (channel/guild/webhook id) plus route
// shape — two channels are two different buckets.
function routeKey(method, path) {
  const [, top, majorId, ...rest] = path.split("?")[0].split("/");
  const hasMajor = ["channels", "guilds", "webhooks"].includes(top);
  const major = hasMajor ? `${top}/${majorId}` : top;
  const tail = (hasMajor ? rest : [majorId, ...rest])
    .filter((segment) => segment !== undefined)
    .join("/")
    .replace(/\d{15,}/g, ":id");
  return `${method} ${major}/${tail}`;
}

// Read by db/lib/dawnWipe.js for its report.
let requestCount = 0;
let sleepMsTotal = 0;
let retryCount = 0;

function beginRequestMetrics() {
  return { requests: requestCount, sleepMs: sleepMsTotal, retries: retryCount };
}

function readRequestMetrics(since) {
  return {
    requests: requestCount - since.requests,
    sleepMs: sleepMsTotal - since.sleepMs,
    retries: retryCount - since.retries,
  };
}

async function meteredSleep(ms) {
  sleepMsTotal += ms;
  await sleep(ms);
}

// Failures carry the HTTP status and Discord's own JSON error code — callers
// must tell them apart by code, never by matching message text.
function discordError(message, { status = null, discordCode = null } = {}) {
  const err = new Error(message);
  err.status = status;
  err.discordCode = discordCode;
  return err;
}

// Central fetch wrapper: bounded retry on 429 honoring retry_after, throws
// on any other non-2xx (unless allow404). `auth: false` omits the bot
// header for webhook-token URLs; `formData` is a factory (not a value)
// since a consumed body can't re-send on retry.
async function discordRequest(
  path,
  { method = "GET", body, allow404 = false, auth = true, formData = null } = {},
) {
  const jsonBody = formData === null && body !== undefined;
  const contentType = jsonBody ? { "Content-Type": "application/json" } : undefined;
  const headers = auth ? authHeaders(contentType) : contentType;

  const route = routeKey(method, path);

  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() < breakerOpenUntil) {
      throw discordError(
        `Discord ${method} ${path} refused: circuit breaker open until ` +
          `${new Date(breakerOpenUntil).toISOString()} (too many 401/403/429 responses).`,
      );
    }

    // Pay the deferred reset, if this route's bucket is the one that ran out.
    const knownBucket = bucketByRoute.get(route);
    const resetAt = knownBucket ? resetAtByBucket.get(knownBucket) : undefined;
    if (resetAt !== undefined) {
      const waitMs = resetAt - Date.now();
      resetAtByBucket.delete(knownBucket);
      if (waitMs > 0) await meteredSleep(Math.min(waitMs, MAX_RETRY_AFTER_MS));
    }

    requestCount += 1;
    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: formData !== null ? formData() : jsonBody ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 || res.status === 403 || res.status === 429) {
      recordInvalidResponse(res.status, path);
    }

    if (res.status === 429) {
      // A global 429 is the actual ban-adjacent signal — surface it loudly.
      const payload = await res.json().catch(() => ({}));
      if (payload.global || res.headers.get("X-RateLimit-Global") === "true") {
        console.error(`Discord GLOBAL rate limit hit on ${method} ${path}. This is the ban warning shot.`);
      }
      const retryAfterMs = (Number(payload.retry_after) || 1) * 1000;
      if (retryAfterMs > MAX_RETRY_AFTER_MS) {
        throw discordError(
          `Discord ${method} ${path} failed: 429 with retry_after ${Math.round(retryAfterMs / 1000)}s, ` +
            `over the ${MAX_RETRY_AFTER_MS / 1000}s cap — not waiting.`,
          { status: 429, discordCode: payload.code ?? null },
        );
      }
      retryCount += 1;
      await meteredSleep(retryAfterMs);
      continue;
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      const text = await res.text();
      let discordCode = null;
      try {
        discordCode = JSON.parse(text)?.code ?? null;
      } catch {
        // A non-JSON error body (a Cloudflare HTML page) carries no code.
      }
      throw discordError(`Discord ${method} ${path} failed: ${res.status} ${text}`, {
        status: res.status,
        discordCode,
      });
    }

    // Pre-empt the next 429 by spending the reset window lazily, at the
    // next request on the SAME bucket, rather than stalling here.
    const bucket = res.headers.get("X-RateLimit-Bucket");
    if (bucket) bucketByRoute.set(route, bucket);
    if (res.headers.get("X-RateLimit-Remaining") === "0") {
      const resetAfterMs = (Number(res.headers.get("X-RateLimit-Reset-After")) || 0) * 1000;
      if (resetAfterMs > 0) {
        if (bucket) resetAtByBucket.set(bucket, Date.now() + resetAfterMs);
        else await meteredSleep(Math.min(resetAfterMs, MAX_RETRY_AFTER_MS));
      }
    }

    if (res.status === 204) return null;
    return res.json();
  }
  throw discordError(`Discord ${method} ${path} failed: exhausted retries on 429`, { status: 429 });
}

// Discord takes attachments as multipart/form-data only. The body is a
// `payload_json` part plus one `files[n]` part per file; `attachments[].id`
// is the part index and must match the `files[n]` suffix or Discord drops it.
async function postAttachment(channelId, filePath, content = "", components = undefined) {
  const fs = require("node:fs");
  const path = require("node:path");
  const filename = path.basename(filePath);
  const bytes = fs.readFileSync(filePath);

  const buildBody = () => {
    const body = new FormData();
    body.append(
      "payload_json",
      JSON.stringify({ content, attachments: [{ id: 0, filename }], ...(components ? { components } : {}) }),
    );
    body.append("files[0]", new Blob([bytes]), filename);
    return body;
  };

  return discordRequest(`/channels/${channelId}/messages`, { method: "POST", formData: buildBody });
}

async function getGuildChannels() {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`);
}

async function createChannel(payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`, { method: "POST", body: payload });
}

async function patchGuildChannelPositions(updates) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/channels`, { method: "PATCH", body: updates });
}

async function getChannel(channelId, { allow404 = false } = {}) {
  return discordRequest(`/channels/${channelId}`, { allow404 });
}

async function deleteChannel(channelId) {
  return discordRequest(`/channels/${channelId}`, { method: "DELETE", allow404: true });
}

async function patchChannel(channelId, payload) {
  return discordRequest(`/channels/${channelId}`, { method: "PATCH", body: payload });
}

// Opens (or returns the cached) DM channel with a user. A real POST every
// time otherwise — the id is stable for the guild's lifetime, so caching it
// avoids reopening it per player per turn.
const dmChannelCache = new Map(); // discordUserId -> channelId

function forgetDmChannel(discordUserId) {
  dmChannelCache.delete(discordUserId);
}

async function createDmChannel(discordUserId) {
  const cached = dmChannelCache.get(discordUserId);
  if (cached) return { id: cached };

  const channel = await discordRequest("/users/@me/channels", {
    method: "POST",
    body: { recipient_id: discordUserId },
  });
  if (channel?.id) dmChannelCache.set(discordUserId, channel.id);
  return channel;
}

async function postMessage(channelId, content, components = undefined) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: { content, ...(components ? { components } : {}) },
  });
}

// Posts text as one message, or several in order if it exceeds Discord's
// 2000-char limit. Sequential and throws on the first chunk that fails.
async function postMessageBatched(channelId, text) {
  for (const chunk of chunkMessage(text)) {
    await postMessage(channelId, chunk);
  }
}

// Discord JSON error code for a channel it no longer recognises.
const UNKNOWN_CHANNEL = 10003;

async function postDmOnce(discordUserId, content, components = undefined) {
  const channel = await createDmChannel(discordUserId);
  try {
    return await postMessage(channel.id, content, components);
  } catch (err) {
    if (err.discordCode !== UNKNOWN_CHANNEL && err.status !== 404) throw err;
    forgetDmChannel(discordUserId);
    const fresh = await createDmChannel(discordUserId);
    return postMessage(fresh.id, content, components);
  }
}

// DM equivalent of postMessageBatched. The `»` prefix (applied by the
// caller) lands only on the first chunk; `components` rides the LAST chunk
// only, or Discord renders one live row per chunk.
async function postDmBatched(discordUserId, text, components = undefined) {
  const chunks = chunkMessage(text);
  if (chunks.length === 0) chunks.push(text);

  let sent = null;
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    sent = await postDmOnce(discordUserId, chunks[i], last ? components : undefined);
  }
  return sent;
}

// type 11 = GUILD_PUBLIC_THREAD, no starter message — the caller posts it.
async function startThread(channelId, name, autoArchiveMinutes = 10080) {
  return discordRequest(`/channels/${channelId}/threads`, {
    method: "POST",
    body: { name, type: 11, auto_archive_duration: autoArchiveMinutes },
  });
}

// Edits a message the bot itself sent — used to rewrite a forum post's
// STARTER message (id == thread id) in place rather than recreate the post.
async function editMessage(channelId, messageId, content, components = undefined) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: components ? { content, components } : { content },
  });
}

// A forum thread cannot exist without its starter message, so it's created
// here in one call rather than via startThread. `thread.id` doubles as the
// starter message's id.
async function createForumPost(
  forumChannelId,
  { name, content, appliedTags = [], autoArchiveMinutes = 10080, components = undefined, allowedMentions = undefined },
) {
  // allowedMentions: pass one whenever content carries user text — Discord's
  // default parses everything, and a character named "@everyone" would ping.
  const message = { content, ...(components ? { components } : {}), ...(allowedMentions ? { allowed_mentions: allowedMentions } : {}) };
  return discordRequest(`/channels/${forumChannelId}/threads`, {
    method: "POST",
    body: {
      name,
      applied_tags: appliedTags,
      auto_archive_duration: autoArchiveMinutes,
      message,
    },
  });
}

// type 12, invitable:false — only ManageThreads (bot, GMs) may add members,
// which is what keeps /add the only door in.
async function startPrivateThread(channelId, name, autoArchiveMinutes = 10080) {
  return discordRequest(`/channels/${channelId}/threads`, {
    method: "POST",
    body: { name, type: 12, auto_archive_duration: autoArchiveMinutes, invitable: false },
  });
}

// Silent add — channel.members.add would ping-mention the target.
async function addThreadMember(threadId, userId) {
  return discordRequest(`/channels/${threadId}/thread-members/${userId}`, {
    method: "PUT",
    allow404: true,
  });
}

// A thread is a channel, so this is patchChannel under a clearer name.
// flags bit 1 (value 2) is PINNED, pinning a forum post to the top of its
// forum — there is no /pins endpoint for forum posts.
const THREAD_FLAG_PINNED = 2;

async function patchThread(threadId, payload) {
  return patchChannel(threadId, payload);
}

// Pins a MESSAGE via the real /pins endpoint — not to be confused with
// THREAD_FLAG_PINNED above. Idempotent: PUT returns 204 either way.
async function pinMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/pins/${messageId}`, {
    method: "PUT",
    allow404: true,
  });
}

async function deleteMessage(channelId, messageId) {
  return discordRequest(`/channels/${channelId}/messages/${messageId}`, { method: "DELETE", allow404: true });
}

// Paginates GET .../messages (newest-first per page) until short of a full
// page, then reverses to chronological order. `before` seeds Discord's own
// cursor to bound the walk — see snowflakeForTimestamp and dawnWipe.js.
async function fetchAllMessages(channelId, { before: startBefore } = {}) {
  const pageSize = 100;
  const messages = [];
  let before = startBefore;

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

// Discord's epoch: the upper 42 bits of a message id are ms since 2015-01-01.
const DISCORD_EPOCH = 1_420_070_400_000n;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// Inverse of messageTimestamp: the smallest snowflake a message at `ms`
// could have — usable anywhere a before/after cursor is accepted.
function snowflakeForTimestamp(ms) {
  return String((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n);
}

// Cap on one-at-a-time deletes for over-age messages, since each is its own
// request.
const OLD_MESSAGE_DELETE_CAP = 50;

function messageTimestamp(messageId) {
  try {
    return Number((BigInt(messageId) >> 22n) + DISCORD_EPOCH);
  } catch {
    return null;
  }
}

// Bulk-delete takes 2-100 ids and rejects the WHOLE batch if any one is over
// 14 days old, so ids are split by age: young ones bulk-delete together, old
// ones go one at a time up to the cap.
async function bulkDeleteMessages(channelId, messageIds) {
  const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
  const young = [];
  const old = [];
  for (const id of messageIds) {
    const at = messageTimestamp(id);
    // An unparseable id is treated as young; Discord rejects it if wrong.
    (at !== null && at < cutoff ? old : young).push(id);
  }

  for (let i = 0; i < young.length; i += 100) {
    const chunk = young.slice(i, i + 100);
    if (chunk.length === 1) {
      await deleteMessage(channelId, chunk[0]);
    } else if (chunk.length > 1) {
      await discordRequest(`/channels/${channelId}/messages/bulk-delete`, {
        method: "POST",
        body: { messages: chunk },
      });
    }
  }

  if (old.length === 0) return;

  const deleting = old.slice(0, OLD_MESSAGE_DELETE_CAP);
  console.warn(
    `Bulk delete: ${old.length} message(s) in ${channelId} are over 14 days old and can't be ` +
      `batched. Deleting ${deleting.length} one at a time` +
      (old.length > deleting.length ? `; ${old.length - deleting.length} left for the next run.` : "."),
  );
  for (const id of deleting) {
    await deleteMessage(channelId, id);
  }
}

// Empties a thread but keeps it alive — the starter message's id IS the
// thread id, and deleting it destroys the whole post, so it's always skipped.
async function clearThreadExceptStarter(threadId, { before } = {}) {
  const messages = await fetchAllMessages(threadId, { before });
  const ids = messages.filter((m) => m.id !== threadId).map((m) => m.id);
  if (ids.length === 0) return;
  await bulkDeleteMessages(threadId, ids);
}

// No per-channel "active threads" endpoint, only guild-wide — filtered
// client-side by parent_id. `snapshot` lets a caller fetch once and reuse.
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

async function deleteThread(threadId) {
  return discordRequest(`/channels/${threadId}`, { method: "DELETE", allow404: true });
}

async function getForumTagId(channelId, tagName) {
  const channel = await getChannel(channelId);
  return channel.available_tags?.find((t) => t.name === tagName)?.id ?? null;
}

// PATCHing available_tags is a full replacement, so this always includes the
// channel's existing tags plus the new one if not already present.
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

// Discord JSON error code for a webhook that no longer exists.
const UNKNOWN_WEBHOOK = 10015;

// REST twin of bot/src/lib/proxy.js#fetchOrCreateWebhook — reuse the bot's
// webhook on a channel, create one only if there isn't one. Cached per
// channel for the process lifetime so a per-character loop isn't a GET each.
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

// `auth: false`: the webhook token in the URL IS the credential — a bot auth
// header alongside it can make Discord reject the request. Bucketed at
// roughly 5 per 5 seconds per channel, so a 429 here is routine.
async function executeWebhook({ id, token }, { content, username, avatarUrl }) {
  return discordRequest(`/webhooks/${id}/${token}?wait=true`, {
    method: "POST",
    auth: false,
    body: {
      content,
      username,
      avatar_url: avatarUrl,
      // Never let player-authored text ping a role or @everyone by typing it.
      allowed_mentions: { parse: ["users"] },
    },
  });
}

// REST equivalent of a tupper proxy for text composed by the game itself.
// Chunked since the biggest caller posts player-authored text that can
// exceed 2000 chars. Returns the FIRST message, what the archive anchors to.
async function postAsCharacter(channelId, character, content) {
  const chunks = chunkMessage(String(content ?? ""));
  if (chunks.length <= 1) return postAsCharacterChunk(channelId, character, content);

  let first = null;
  for (const chunk of chunks) {
    const sent = await postAsCharacterChunk(channelId, character, chunk);
    if (!first) first = sent;
  }
  return first;
}

async function postAsCharacterChunk(channelId, character, content) {
  try {
    return await postAsCharacterOnce(channelId, content, character);
  } catch (err) {
    // Keyed on the error CODE, never message text — a 429 shouldn't rebuild.
    if (err.discordCode === UNKNOWN_WEBHOOK || err.status === 404) {
      forgetChannelWebhook(channelId);
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

// Role and channel-permission helpers, all routed through discordRequest so
// they sit behind the circuit breaker too. `type` 0 = role, 1 = member.

async function getGuildRoles() {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles`);
}

async function createGuildRole(payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles`, { method: "POST", body: payload });
}

async function patchGuildRole(roleId, payload) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles/${roleId}`, { method: "PATCH", body: payload });
}

async function deleteGuildRole(roleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/roles/${roleId}`, { method: "DELETE", allow404: true });
}

// allow404: a player who left the guild between the DB read and this call
// is a fact to reconcile later, not a reason to abort the loop.
async function addMemberRole(userId, roleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    allow404: true,
  });
}

async function removeMemberRole(userId, roleId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
    allow404: true,
  });
}

// One member, or null if they've left — cheaper than letting a DM-channel
// create for a departed user 403 into the breaker's tally.
async function getGuildMember(userId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/members/${userId}`, { allow404: true });
}

async function setGuildNickname(userId, nick) {
  const guildId = process.env.DISCORD_GUILD_ID;
  return discordRequest(`/guilds/${guildId}/members/${userId}`, {
    method: "PATCH",
    body: { nick },
    allow404: true,
  });
}

// Paginates the full member list (1000/page). Each entry carries
// { user: { id, ... }, roles: [...] }, what the channel doctor diffs.
async function listGuildMembers() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const members = [];
  let after = "0";
  for (;;) {
    const page = await discordRequest(`/guilds/${guildId}/members?limit=1000&after=${after}`);
    members.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return members;
}

async function putChannelOverwrite(channelId, targetId, { allow = "0", deny = "0", type = 0 } = {}) {
  return discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
    method: "PUT",
    body: { id: targetId, type, allow: String(allow), deny: String(deny) },
  });
}

// Removes an overwrite; falls back to the inherited permission. allow404
// because no-overwrite-here is success, not an error.
async function deleteChannelOverwrite(channelId, targetId) {
  return discordRequest(`/channels/${channelId}/permissions/${targetId}`, {
    method: "DELETE",
    allow404: true,
  });
}

module.exports = {
  discordRequest,
  getInvalidResponseStats,
  attachBreakerStore,
  loadBreakerState,
  recordInvalidResponse,
  getGuildChannels,
  createDmChannel,
  forgetDmChannel,
  getChannel,
  deleteChannel,
  createChannel,
  patchGuildChannelPositions,
  patchChannel,
  postMessage,
  postMessageBatched,
  postDmBatched,
  postAttachment,
  chunkMessage,
  editMessage,
  createForumPost,
  patchThread,
  THREAD_FLAG_PINNED,
  pinMessage,
  deleteMessage,
  fetchAllMessages,
  bulkDeleteMessages,
  clearThreadExceptStarter,
  snowflakeForTimestamp,
  beginRequestMetrics,
  readRequestMetrics,
  listActiveThreadsForChannel,
  fetchActiveThreads,
  listArchivedPublicThreads,
  listArchivedPrivateThreads,
  deleteThread,
  getForumTagId,
  ensureForumTag,
  startThread,
  startPrivateThread,
  addThreadMember,
  getGuildRoles,
  createGuildRole,
  patchGuildRole,
  deleteGuildRole,
  addMemberRole,
  removeMemberRole,
  getGuildMember,
  setGuildNickname,
  listGuildMembers,
  messageTimestamp,
  putChannelOverwrite,
  deleteChannelOverwrite,
  ensureChannelWebhook,
  executeWebhook,
  postAsCharacter,
};
