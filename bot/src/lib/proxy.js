const { WebhookClient, RESTJSONErrorCodes, GuildPremiumTier } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { recordArchiveMessage } = require("@lifeweb/db/lib/archive");
const { touchCharacterActivity } = require("@lifeweb/db/lib/characterActivity");
const { capitalizeSentences, fixContractions } = require("./textCorrection");
const { resolveChannelContext } = require("./channels");
const { sendDm } = require("./dm");

const WEBHOOK_NAME = "Bascinet Tupper";
// One entry per proxied message, and the ✏️/❌/⭐/🔍 reactions only work on
// messages still in here. At 500 that cap was reachable *within a single
// turn* at roster scale — 15 locations of active play — so a player scrolling
// up to edit something they said an hour earlier found the reaction silently
// inert. PROXYING.md §2 describes the bound as the bot's last restart, which
// is the behaviour this restores.
//
// The entries are small (a few ids and two short strings), so 20k of them is
// on the order of a few MB — cheap next to losing the feature mid-turn.
const MAX_RECENT = 20_000;

// Two caches, both keyed for the process lifetime, mirroring the REST twin in
// db/lib/discordRest.js.
//
//   webhookCache   channelId -> { id, token }
//   clientCache    webhookId -> WebhookClient
//
// The second one exists because a WebhookClient is not free: it carries its
// own REST manager, and a brand-new one starts with *zero* knowledge of the
// rate limits it is about to hit. Building one per message meant N
// simultaneous messages in a busy room fired N rate-limit-blind requests into
// a ~5-per-5s bucket. Keyed on the webhook rather than the channel so the
// ❌/✏️ reaction handlers, which only hold an id and a token, share it too.
const webhookCache = new Map();
const clientCache = new Map();

// A cold channel hit by two messages in the same tick would otherwise run
// fetchWebhooks twice and, finding nothing both times, create two webhooks.
const webhookPending = new Map(); // channelId -> Promise<{ id, token }>

const recentProxies = new Map(); // webhookMessageId -> { discordUserId, characterId, webhookId, webhookToken, threadId, concealed, alias }

function trackProxy(webhookMessageId, data) {
  recentProxies.set(webhookMessageId, data);
  if (recentProxies.size > MAX_RECENT) {
    const oldestKey = recentProxies.keys().next().value;
    recentProxies.delete(oldestKey);
  }
}

// Returns the WebhookClient for a webhook, building it at most once.
function webhookClientFor({ id, token }) {
  const cached = clientCache.get(id);
  if (cached) return cached;
  const client = new WebhookClient({ id, token });
  clientCache.set(id, client);
  return client;
}

// Un-learn a channel's webhook. Nothing did this before, so a GM deleting the
// "Bascinet Tupper" webhook broke every proxy in that room until the next
// restart — and each of those failures left the player's real name on screen.
function forgetChannelWebhook(channelId) {
  const info = webhookCache.get(channelId);
  webhookCache.delete(channelId);
  webhookPending.delete(channelId);
  if (info) {
    clientCache.get(info.id)?.destroy?.();
    clientCache.delete(info.id);
  }
}

function webhookChannelFor(channel) {
  return channel.isThread() ? channel.parent : channel;
}

async function fetchOrCreateWebhook(channel) {
  const target = webhookChannelFor(channel);
  const cached = webhookCache.get(target.id);
  if (cached) return cached;

  const inflight = webhookPending.get(target.id);
  if (inflight) return inflight;

  const pending = (async () => {
    const webhooks = await target.fetchWebhooks();
    let webhook = webhooks.find((w) => w.owner?.id === channel.client.user.id);
    if (!webhook) {
      webhook = await target.createWebhook({ name: WEBHOOK_NAME });
    }

    const info = { id: webhook.id, token: webhook.token };
    webhookCache.set(target.id, info);
    return info;
  })();

  webhookPending.set(target.id, pending);
  try {
    return await pending;
  } finally {
    webhookPending.delete(target.id);
  }
}

// Attachments are recorded as a placeholder and nothing more. Storing the CDN
// url would be worse than useless: Discord's links now carry expiry
// parameters, so the archive would fill with dead images. Actually preserving
// them would mean downloading and re-hosting the bytes (the way avatars are
// stored) — a deliberate non-goal for now, but the placeholder at least makes
// the gap visible in the transcript instead of silent, which is what the old
// Dawn-wipe archive did.
function attachmentPlaceholders(message) {
  return [...(message.attachments?.values() ?? [])].map((a) =>
    a.contentType?.startsWith("image/") ? "[image]" : "[attachment]",
  );
}

function avatarUrlFor(character) {
  const base = process.env.WEB_BASE_URL;
  if (!base) return undefined;
  return `${base}/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`;
}

// The silhouette every concealed message posts under. A static file served
// straight out of web/public by Next — no /api/avatar round trip, and
// deliberately identical for everyone, since a per-character concealed avatar
// would be a fingerprint.
function concealedAvatarUrl() {
  const base = process.env.WEB_BASE_URL;
  return base ? `${base}/assets/unknown.png` : undefined;
}

// The core send: post `content` (and any files) into `channel` as
// `character`, track it, and write the transcript row. Deliberately takes no
// Message — the Speak modal (bot/src/lib/speakModal.js) has no source message
// to read or delete, only an interaction. sendAsCharacter below is the
// message-driven wrapper, and is the only thing that deletes an original.
//
// `conceal` carries { alias } when the message is going out anonymously.
// Everything downstream of the send — tracking, the ✏️/❌/⭐/🔍/⚜️ reactions —
// is identical either way; only the username, the avatar and the recorded
// alias change.
//
// Tracking through trackProxy is not optional for either caller: every
// reaction in bot/src/events/messageReactionAdd.js is gated on recentProxies,
// so an untracked message is inert to all of them.
async function postAsCharacterTo(channel, character, { content, files = [], discordUserId, conceal = null }) {
  const threadId = channel.isThread() ? channel.id : undefined;

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const text = config?.tupperAutocorrectEnabled
    ? capitalizeSentences(fixContractions(content ?? ""))
    : (content ?? "");

  const payload = {
    content: text,
    username: conceal ? conceal.alias : character.name,
    avatarURL: conceal ? concealedAvatarUrl() : avatarUrlFor(character),
    files,
    threadId,
    // Role mentions render as a chip but notify nobody — allowed_mentions
    // governs notification, not display. Character-role pings are relayed as a
    // DM instead (bot/src/lib/mentions.js), gated on whether the target could
    // actually hear it; letting Discord also fire the role would double-notify
    // now and, once the roles are assigned to nobody, notify no one at all.
    // Matches db/lib/discordRest.js#executeWebhook, which already does this.
    allowedMentions: { parse: ["users"] },
  };

  const send = async () => {
    const info = await fetchOrCreateWebhook(channel);
    const message = await webhookClientFor(info).send(payload);
    return { info, message };
  };

  let info;
  let webhookMessage;
  try {
    ({ info, message: webhookMessage } = await send());
  } catch (err) {
    // Only a webhook Discord no longer has is worth rebuilding for. Anything
    // else — a 429, an oversized attachment, a payload it rejected — is not
    // fixed by a second identical attempt, and retrying a 429 immediately
    // makes it worse.
    if (err.code !== RESTJSONErrorCodes.UnknownWebhook) throw err;
    forgetChannelWebhook(webhookChannelFor(channel).id);
    ({ info, message: webhookMessage } = await send());
  }

  const { id, token } = info;

  trackProxy(webhookMessage.id, {
    discordUserId,
    characterId: character.id,
    webhookId: id,
    webhookToken: token,
    threadId,
    // Read by messageReactionAdd.js: 🔍 swaps to the anonymous embed, ⭐ files
    // the alias rather than the real name, and ❓ refuses outright. Because
    // recentProxies is in-memory and capped, a bot restart makes an old
    // concealed message inert to every reaction — which is the safe direction.
    concealed: Boolean(conceal),
    alias: conceal?.alias ?? null,
  });

  return { webhookMessage, content: text };
}

const DISCORD_MESSAGE_LIMIT = 2000;
const DM_CHUNK = 1900;

// Discord's per-file upload ceiling for this guild. discord.js exposes
// maximumBitrate but not this, so it is derived from the boost tier.
function uploadLimitBytes(guild) {
  switch (guild?.premiumTier) {
    case GuildPremiumTier.Tier2:
      return 50 * 1024 * 1024;
    case GuildPremiumTier.Tier3:
      return 100 * 1024 * 1024;
    default:
      return 10 * 1024 * 1024;
  }
}

// What, if anything, makes this message impossible to repost as a webhook.
// Checked BEFORE sending, because the failure mode of finding out afterwards
// is the one this whole file exists to prevent (see sendAsCharacter).
function proxyRefusal(message, content) {
  const text = content ?? "";

  if (text.length > DISCORD_MESSAGE_LIMIT) {
    return (
      `That was ${text.length} characters, and a reposted message has to fit Discord's 2000. ` +
      "Nitro's higher limit is yours, not the bot's. Here it is back:"
    );
  }

  const limit = uploadLimitBytes(message.guild);
  const tooBig = [...message.attachments.values()].find((a) => a.size > limit);
  if (tooBig) {
    return (
      `${tooBig.name} is bigger than the ${Math.round(limit / 1024 / 1024)} MB the bot can repost. ` +
      "Your text is below — send it again without that file."
    );
  }

  // A sticker-only message, or one carrying nothing but a Discord effect,
  // arrives with empty content and no attachments. The webhook would reject
  // it as an empty message.
  if (!text.trim() && message.attachments.size === 0) {
    return "There was nothing in that the bot could repost. Stickers and Discord's own effects don't survive being proxied.";
  }

  return null;
}

// Deleting the original is what keeps a player's real account off the screen,
// so a failure here is a real problem and never a shrug. It used to be a bare
// .catch(() => {}).
async function deleteOriginal(message) {
  try {
    await message.delete();
  } catch (err) {
    console.error(`Failed to delete the original message ${message.id} after proxying:`, err);
  }
}

// Gives the player their words back after a refusal, so nothing they typed is
// lost along with the message. Sent in pieces because the commonest refusal is
// "this was too long for one message", and the hand-back would hit the same
// wall.
async function handBack(message, reason, text) {
  try {
    await sendDm(message.author, `» *${reason}*`);
    const body = (text ?? "").trim();
    for (let i = 0; i < body.length; i += DM_CHUNK) {
      await sendDm(message.author, body.slice(i, i + DM_CHUNK));
    }
  } catch (err) {
    // DMs closed. Nothing else to try — but the original is already gone,
    // which is the half that mattered.
    console.error(`Couldn't return the unproxied message to ${message.author.id}:`, err);
  }
}

// The message-driven path: proxy what a player typed in a tupper channel,
// then delete their original. Everything except the attachment plumbing and
// that deletion lives in postAsCharacterTo above.
//
// THE ORIGINAL IS DELETED ON EVERY PATH, including the failing ones. That is
// the whole point of the file: this game's premise is that a player's account
// and their character are separate, and a message left sitting un-proxied
// under a real Discord name breaks that premise for everyone reading the
// channel. It used to delete only after a successful send, so anything the
// webhook rejected — an over-length message, an oversized attachment, a
// sticker, a webhook a GM had deleted — stayed on screen under the player's
// own name with nobody told. For /conceal it was worse still: the text they
// wanted anonymous, over their real name.
//
// Losing a message is recoverable, and handBack recovers it. Losing the mask
// is not.
//
// Returns null when the message could not be proxied; the caller has nothing
// left to do in that case.
async function sendAsCharacter(channel, character, message, { conceal = null, content: override = null } = {}) {
  const text = override ?? message.content;

  const refusal = proxyRefusal(message, text);
  if (refusal) {
    await deleteOriginal(message);
    await handBack(message, refusal, text);
    return null;
  }

  let webhookMessage;
  let content;
  try {
    ({ webhookMessage, content } = await postAsCharacterTo(channel, character, {
      content: text,
      files: [...message.attachments.values()].map((a) => a.url),
      discordUserId: message.author.id,
      conceal,
    }));
  } catch (err) {
    console.error("Failed to proxy message, returning it to its author:", err);
    await deleteOriginal(message);
    await handBack(message, "Something went wrong reposting that. Here it is back:", text);
    return null;
  }

  // The transcript row, written here rather than reconstructed at Dawn. Both
  // halves of a concealed send are kept: the alias is what the room saw,
  // character.name is who it actually was. recordArchiveMessage swallows its
  // own failures — a transcript row is never worth breaking a message over.
  await recordArchiveMessage(prisma, {
    discordMessageId: webhookMessage.id,
    content: [content, ...attachmentPlaceholders(message)].filter(Boolean).join("\n"),
    character,
    concealedAlias: conceal?.alias ?? null,
    ...resolveChannelContext(channel),
  });
  await touchCharacterActivity(prisma, character.id);

  await deleteOriginal(message);

  return webhookMessage;
}

module.exports = {
  recentProxies,
  sendAsCharacter,
  postAsCharacterTo,
  fetchOrCreateWebhook,
  webhookClientFor,
  forgetChannelWebhook,
};
