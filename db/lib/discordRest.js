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

// --- persistence ---------------------------------------------------------
//
// The counters above are module-level JS, and that was the hole: the breaker's
// stated purpose is to stop a crash-restart loop, and a restart zeroes them.
// Cloudflare's count is keyed on the egress IP and does not reset, so the one
// scenario this was written for was the one it could never catch. The health
// line at bot startup could only ever print 0/1000.
//
// So the state is mirrored onto GameConfig. Deliberately NOT read per request:
// that would put a database round trip in front of every Discord call. Loaded
// once when the process first touches this module, and written only on the
// error path.
//
// `attach` is called by db/index.js, which owns the prisma singleton — this
// file is required BY it and cannot require it back (see the header).
let persist = null;
let loaded = false;
let sinceLastWrite = 0;
const WRITE_EVERY = 25;

function attachBreakerStore(store) {
  persist = store;
  loaded = false;
}

// Pulls the persisted count and open-until into this process. Called on the
// first invalid response and at bot startup, never on the hot path.
async function loadBreakerState() {
  if (loaded || !persist) return;
  loaded = true;
  try {
    const saved = await persist.read();
    if (!saved) return;

    const now = Date.now();
    const openUntil = saved.restBreakerOpenUntil ? new Date(saved.restBreakerOpenUntil).getTime() : 0;
    if (openUntil > now) breakerOpenUntil = openUntil;

    // A window that has already lapsed carries no information; only a live one
    // is worth restoring, and it is restored as a count rather than as
    // individual timestamps, which were never stored.
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

  // Fire-and-forget: the first invalid response of a process pulls in whatever
  // the last one left behind. Deliberately not awaited — this sits inside
  // discordRequest and must not add latency to the retry.
  loadBreakerState();

  if (invalidTimestamps.length >= INVALID_LIMIT && now >= breakerOpenUntil) {
    breakerOpenUntil = now + BREAKER_COOLDOWN_MS;
    console.error(
      `Discord circuit breaker OPEN: ${invalidTimestamps.length} invalid responses ` +
        `(401/403/429) in the last 10 minutes, most recently ${status} on ${path}. ` +
        `Pausing all outbound Discord REST from this process for 10 minutes to stay ` +
        `clear of Cloudflare's 10,000-per-10-minutes IP ban.`,
    );
    // Clear the window along with the trip. The window and the cooldown are
    // both ten minutes, so without this every entry that tripped the breaker
    // is still in the array when it closes, and the very next stray failure
    // re-trips it for another ten.
    invalidTimestamps.length = 0;
    sinceLastWrite = 0;
    saveBreakerState();
    return;
  }

  // Writing on every failure would be a database round trip per 429. Every
  // 25th is often enough that a process dying mid-burst leaves a number close
  // to the truth, which is all the next one needs.
  sinceLastWrite += 1;
  if (sinceLastWrite >= WRITE_EVERY) {
    sinceLastWrite = 0;
    saveBreakerState();
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

// Every failure this wrapper throws carries the HTTP status and Discord's own
// JSON error code, because callers need to tell one failure from another and
// the message text cannot do it. postAsCharacter below is the worked example:
// it used to match `err.message.includes("webhook")` to spot a deleted
// webhook, and every error on that path contains the word — a 429, a 500,
// even the breaker's own refusal, whose path is `/webhooks/...`. So a
// rate-limited post was read as a dead webhook and retried instantly into the
// same exhausted bucket.
function discordError(message, { status = null, discordCode = null } = {}) {
  const err = new Error(message);
  err.status = status;
  err.discordCode = discordCode;
  return err;
}

// Central fetch wrapper: bounded retry on 429 honoring Discord's
// `retry_after`, throws on any other non-2xx (unless allow404).
//
// Two options exist so that nothing has to hand-roll a second, weaker copy of
// the retry loop just to change its headers or its body encoding:
//
//   auth: false   omit the bot Authorization header. A webhook token in the
//                 URL *is* the credential, and sending the bot header
//                 alongside it makes Discord authorize as the bot instead.
//   formData      a factory returning a FormData, for the multipart uploads a
//                 JSON body can never carry. It is a factory, not a value,
//                 because a consumed request body may not re-send on a retry.
//
// Both used to be bare fetches, and both were therefore invisible to the
// circuit breaker while making exactly the calls it exists to count.
async function discordRequest(
  path,
  { method = "GET", body, allow404 = false, auth = true, formData = null } = {},
) {
  const jsonBody = formData === null && body !== undefined;
  const contentType = jsonBody ? { "Content-Type": "application/json" } : undefined;
  // fetch sets the multipart boundary itself, so a FormData body gets no
  // Content-Type of ours at all.
  const headers = auth ? authHeaders(contentType) : contentType;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() < breakerOpenUntil) {
      throw discordError(
        `Discord ${method} ${path} refused: circuit breaker open until ` +
          `${new Date(breakerOpenUntil).toISOString()} (too many 401/403/429 responses).`,
      );
    }

    const res = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: formData !== null ? formData() : jsonBody ? JSON.stringify(body) : undefined,
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
        throw discordError(
          `Discord ${method} ${path} failed: 429 with retry_after ${Math.round(retryAfterMs / 1000)}s, ` +
            `over the ${MAX_RETRY_AFTER_MS / 1000}s cap — not waiting.`,
          { status: 429, discordCode: payload.code ?? null },
        );
      }
      await sleep(retryAfterMs);
      continue;
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      const text = await res.text();
      let discordCode = null;
      try {
        discordCode = JSON.parse(text)?.code ?? null;
      } catch {
        // A non-JSON error body (a Cloudflare HTML page, most often) carries
        // no code. The status is still the useful half.
      }
      throw discordError(`Discord ${method} ${path} failed: ${res.status} ${text}`, {
        status: res.status,
        discordCode,
      });
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
  throw discordError(`Discord ${method} ${path} failed: exhausted retries on 429`, { status: 429 });
}

// Posts a local file as a message attachment. Discord takes attachments as
// `multipart/form-data` only, which is why this goes through discordRequest's
// `formData` option rather than its JSON body. The multipart body is a
// `payload_json` part holding the normal message object plus one `files[n]`
// part per file; `attachments[].id` is the *part index*, not a snowflake, and
// must line up with the `files[n]` suffix or Discord drops the file silently.
//
// This used to run its own retry loop, which is how the single largest request
// the bot makes — the weather banner, once per turn advance — ended up with no
// breaker check, no invalid-response counting, and an *uncapped* retry_after
// sleep that could park a turn advance for ten minutes where discordRequest
// would have failed fast at thirty seconds.
async function postAttachment(channelId, filePath, content = "", components = undefined) {
  const fs = require("node:fs");
  const path = require("node:path");
  const filename = path.basename(filePath);
  const bytes = fs.readFileSync(filePath);

  // A factory, not a value: a retry needs a fresh body, since the first
  // attempt may already have consumed the stream.
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

// Opens (or returns the existing) DM channel with a user, and remembers it.
//
// The comment here used to say that Discord treats this as idempotent and so
// there was nothing to cache — which confuses the response being identical
// with the request being free. It is a real POST: a round trip, its own
// rate-limit bucket, and a tick on the Cloudflare counter if it 429s. The
// channel id, meanwhile, is stable for the lifetime of the guild, which makes
// it the most cacheable value in this file.
//
// It cost roughly 390 redundant calls a turn. advanceTurn's side effects walk
// three separate DM loops — Default Move summaries, tag progression, hunger —
// and a player who slept through a turn is usually in all three, so the same
// channel was opened from scratch three times over. The webhookCache below
// carries a comment about learning this exact lesson the hard way.
//
// The logged wrapper that actually sends is db/lib/dm.js#sendDm, which lives
// elsewhere because it needs prisma (see this file's header).
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

// Discord JSON error code for a channel it no longer recognises.
const UNKNOWN_CHANNEL = 10003;

async function postDmOnce(discordUserId, content) {
  const channel = await createDmChannel(discordUserId);
  try {
    return await postMessage(channel.id, content);
  } catch (err) {
    // A cached id Discord has stopped recognising. Forget it and open a fresh
    // one — once, and only for that specific answer.
    if (err.discordCode !== UNKNOWN_CHANNEL && err.status !== 404) throw err;
    forgetDmChannel(discordUserId);
    const fresh = await createDmChannel(discordUserId);
    return postMessage(fresh.id, content);
  }
}

// The DM equivalent of postMessageBatched: opens the channel (cached) and
// sends `text` across as many messages as it takes.
//
// Both REST sendDm twins go through this, because neither had ANY length
// handling. A GM's Move result or broadcast over 2000 characters was rejected
// by Discord, the error was swallowed by the caller's .catch, and the GM saw
// the Move go green with the player never told. The `» ` prefix made it
// worse by adding two characters after the last place anyone was counting.
//
// The prefix is applied by the caller BEFORE chunking, so it lands on the
// first chunk and the continuations run on bare — which is what the `»` rule
// in CLAUDE.md means anyway. Chunking after prefixing also means the chunker
// needs no special allowance for it.
async function postDmBatched(discordUserId, text) {
  const chunks = chunkMessage(text);
  if (chunks.length === 0) chunks.push(text);

  let sent = null;
  for (const chunk of chunks) {
    sent = await postDmOnce(discordUserId, chunk);
  }
  return sent;
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

// Discord's epoch, for turning a snowflake back into a timestamp. The upper 42
// bits of a message id are milliseconds since 2015-01-01.
const DISCORD_EPOCH = 1_420_070_400_000n;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// How many over-age messages a single wipe will delete one at a time before
// giving up on the rest. Each is its own request, so an unbounded fallback on
// a channel with months of backlog would be its own rate-limit incident.
const OLD_MESSAGE_DELETE_CAP = 50;

function messageTimestamp(messageId) {
  try {
    return Number((BigInt(messageId) >> 22n) + DISCORD_EPOCH);
  } catch {
    return null;
  }
}

// Bulk-delete requires 2-100 ids and rejects the WHOLE batch if any one of
// them is over 14 days old; a 1-element array errors, so that case falls back
// to a single delete instead.
//
// The age rule used to be assumed away — "always true here, Dawn cycles every
// ~12h". That holds only while the wipe has actually been running, and
// GameConfig.messageWipeEnabled defaults to false: a guild that plays for two
// weeks and then turns it on hits the floor on its very first run, and every
// batch containing one old message is rejected whole. The failure is
// self-worsening, because the longer it is broken the more certainly it stays
// broken.
//
// So the ids are split by age: the young ones bulk-delete as before, and a
// bounded number of old ones go one at a time. Anything past the cap is
// reported rather than silently skipped.
async function bulkDeleteMessages(channelId, messageIds) {
  const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS;
  const young = [];
  const old = [];
  for (const id of messageIds) {
    const at = messageTimestamp(id);
    // An unparseable id is treated as young: bulk delete is the cheaper guess,
    // and Discord will reject it if that was wrong.
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

// Discord JSON error code for a webhook that no longer exists. The gateway
// twin gets it from discord.js's RESTJSONErrorCodes; there is no such enum
// here, so it is written out.
const UNKNOWN_WEBHOOK = 10015;

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

// `auth: false` because the webhook token in the URL *is* the credential, and
// sending a bot Authorization header alongside it makes Discord authorize the
// request as the bot instead, which it may reject outright.
//
// That header rule is the only thing special about this call, and it used to
// be the justification for a bare fetch — which meant the one path driven in a
// loop over the whole roster had no 429 handling at all. Webhook execution is
// bucketed at roughly 5 per 5 seconds per channel, so on a busy turn a 429
// here is the expected steady state, not an exotic case.
async function executeWebhook({ id, token }, { content, username, avatarUrl }) {
  return discordRequest(`/webhooks/${id}/${token}?wait=true`, {
    method: "POST",
    auth: false,
    body: {
      content,
      username,
      avatar_url: avatarUrl,
      // Player-authored text posted under a character's name — never let it
      // ping a role or @everyone just by typing it.
      allowed_mentions: { parse: ["users"] },
    },
  });
}

// Posts `content` into `channelId` under a character's name and avatar — the
// REST equivalent of a tupper proxy, for anything composed by the game itself
// rather than by a player typing in a channel.
//
// Chunked, because the biggest caller is the Default Move summary loop in
// db/index.js and that text is PLAYER-authored (DefaultEffortPanel's summary
// message). It went to the webhook whole, so a long one was rejected outright
// and the narration for that character simply never appeared.
//
// Returns the FIRST message, which is what the archive row anchors to.
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
    // The cached webhook may have been deleted in Discord since we stored it.
    // Forget it and rebuild once before giving up, so one hand-deleted webhook
    // doesn't silently kill every summary post for that channel until restart.
    //
    // Keyed on the error CODE, never on its text. Matching the word "webhook"
    // in the message matched every failure on this path — including a 429,
    // whose correct answer is to back off, not to immediately spend two more
    // requests rebuilding a webhook that was never broken.
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
  attachBreakerStore,
  loadBreakerState,
  // Exported so the bot can feed discord.js's own REST responses into the
  // same counter — see bot/src/events/ready.js.
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
