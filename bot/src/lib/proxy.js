const { WebhookClient, RESTJSONErrorCodes, GuildPremiumTier } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { presentedIdentity } = require("@lifeweb/db/lib/presentedIdentity");
const { recordArchiveMessage } = require("@lifeweb/db/lib/archive");
const { touchCharacterActivity } = require("@lifeweb/db/lib/characterActivity");
const { capitalizeSentences, fixContractions } = require("./textCorrection");
const { resolveChannelContext } = require("./channels");
const { sendDm } = require("./dm");

const WEBHOOK_NAME = "Bascinet Tupper";
// One entry per proxied message; the ✏️/❌/⭐/🔍 reactions only work on
// messages still in here (bound: bot's last restart, PROXYING.md §2).
const MAX_RECENT = 20_000;

// webhookCache: channelId -> { id, token }. clientCache: webhookId ->
// WebhookClient, kept because a fresh client starts rate-limit-blind
// against a ~5-per-5s bucket.
const webhookCache = new Map();
const clientCache = new Map();

// Guards a cold channel hit by two messages in the same tick from running
// fetchWebhooks twice and creating two webhooks.
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

// Un-learn a channel's webhook (e.g. after a GM deletes it), so proxying
// recovers instead of breaking until the next restart.
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

// Attachments are recorded as a placeholder, not the CDN url — Discord's
// links expire, so the archive would fill with dead images.
function attachmentPlaceholders(message) {
  return [...(message.attachments?.values() ?? [])].map((a) =>
    a.contentType?.startsWith("image/") ? "[image]" : "[attachment]",
  );
}

// The core send: post `content` (and any files) into `channel` as
// `character`, track it, and write the transcript row. Takes no Message —
// the Speak modal has no source message, only an interaction.
// `identity` is the resolved presentedIdentity(character, ...) — forced >
// concealed > own name (db/lib/presentedIdentity.js). Tracking via
// trackProxy is mandatory: every reaction handler is gated on recentProxies.
// A caller that passes no identity gets the plain one — never a crash on the
// hottest path in the bot.
async function postAsCharacterTo(channel, character, { content, files = [], discordUserId, identity = presentedIdentity(character) }) {
  const threadId = channel.isThread() ? channel.id : undefined;

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const text = config?.tupperAutocorrectEnabled
    ? capitalizeSentences(fixContractions(content ?? ""))
    : (content ?? "");

  const payload = {
    content: text,
    username: identity.name,
    avatarURL: process.env.WEB_BASE_URL ? `${process.env.WEB_BASE_URL}${identity.avatarPath}` : undefined,
    files,
    threadId,
    // Role mentions render but never notify — character-role pings are
    // relayed as a DM instead (bot/src/lib/mentions.js). Matches
    // db/lib/discordRest.js#executeWebhook.
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
    // Only rebuild for a webhook Discord no longer has — retrying a 429
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
    // Read by messageReactionAdd.js: 🔍 swaps to the anonymous embed, ⭐
    // files the alias. recentProxies is in-memory and capped, so a restart
    // makes an old concealed message inert to every reaction — the safe
    // direction.
    concealed: identity.concealed,
    alias: identity.alias,
  });

  return { webhookMessage, content: text };
}

const DISCORD_MESSAGE_LIMIT = 2000;
const DM_CHUNK = 1900;

// Discord's per-file upload ceiling for this guild, derived from boost tier
// (discord.js doesn't expose it directly).
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
// Checked before sending.
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

  // A sticker-only or effect-only message arrives empty; the webhook would
  // reject it.
  if (!text.trim() && message.attachments.size === 0) {
    return "There was nothing in that the bot could repost. Stickers and Discord's own effects don't survive being proxied.";
  }

  return null;
}

// Deleting the original keeps a player's real account off the screen.
async function deleteOriginal(message) {
  try {
    await message.delete();
  } catch (err) {
    console.error(`Failed to delete the original message ${message.id} after proxying:`, err);
  }
}

// Gives the player their words back after a refusal. Sent in pieces since
// the commonest refusal is the message being too long for one DM too.
async function handBack(message, reason, text) {
  try {
    await sendDm(message.author, `» *${reason}*`, { source: "system_notice" });
    const body = (text ?? "").trim();
    for (let i = 0; i < body.length; i += DM_CHUNK) {
      await sendDm(message.author, body.slice(i, i + DM_CHUNK), { source: "system_notice" });
    }
  } catch (err) {
    console.error(`Couldn't return the unproxied message to ${message.author.id}:`, err);
  }
}

// The message-driven path: proxy what a player typed in a tupper channel,
// then delete their original. The original is deleted on every path,
// including failing ones — a message left under a real Discord name breaks
// the character/account separation the game depends on. Returns null when
// the message could not be proxied.
async function sendAsCharacter(channel, character, message, { identity = presentedIdentity(character), content: override = null } = {}) {
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
      identity,
    }));
  } catch (err) {
    console.error("Failed to proxy message, returning it to its author:", err);
    await deleteOriginal(message);
    await handBack(message, "Something went wrong reposting that. Here it is back:", text);
    return null;
  }

  // Both halves of a forced or concealed send are kept: alias is what the
  // room saw, character.name is who it was. recordArchiveMessage swallows
  // its own failures.
  await recordArchiveMessage(prisma, {
    discordMessageId: webhookMessage.id,
    content: [content, ...attachmentPlaceholders(message)].filter(Boolean).join("\n"),
    character,
    concealedAlias: identity.alias,
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
