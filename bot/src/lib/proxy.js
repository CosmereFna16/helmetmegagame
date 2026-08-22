const { WebhookClient } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { recordArchiveMessage } = require("@lifeweb/db/lib/archive");
const { capitalizeSentences } = require("./textCorrection");
const { resolveChannelContext } = require("./channels");

const WEBHOOK_NAME = "Lifeweb Tupper";
const MAX_RECENT = 500;

const webhookCache = new Map(); // channelId -> { id, token }
const recentProxies = new Map(); // webhookMessageId -> { discordUserId, characterId, webhookId, webhookToken, threadId, concealed, alias }

function trackProxy(webhookMessageId, data) {
  recentProxies.set(webhookMessageId, data);
  if (recentProxies.size > MAX_RECENT) {
    const oldestKey = recentProxies.keys().next().value;
    recentProxies.delete(oldestKey);
  }
}

async function fetchOrCreateWebhook(channel) {
  const target = channel.isThread() ? channel.parent : channel;
  const cached = webhookCache.get(target.id);
  if (cached) return cached;

  const webhooks = await target.fetchWebhooks();
  let webhook = webhooks.find((w) => w.owner?.id === channel.client.user.id);
  if (!webhook) {
    webhook = await target.createWebhook({ name: WEBHOOK_NAME });
  }

  const info = { id: webhook.id, token: webhook.token };
  webhookCache.set(target.id, info);
  return info;
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

// `conceal` carries { alias } when the message is going out anonymously (see
// bot/src/events/messageCreate.js). Everything downstream of the send —
// tracking, the original's deletion, the ✏️/❌/⭐/🔍 reactions — is identical
// either way; only the username, the avatar and the recorded alias change.
async function sendAsCharacter(channel, character, message, { conceal = null, content: override = null } = {}) {
  const { id, token } = await fetchOrCreateWebhook(channel);
  const webhookClient = new WebhookClient({ id, token });
  const threadId = channel.isThread() ? channel.id : undefined;

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const raw = override ?? message.content;
  const content = config?.tupperAutocorrectEnabled ? capitalizeSentences(raw) : raw;

  const webhookMessage = await webhookClient.send({
    content,
    username: conceal ? conceal.alias : character.name,
    avatarURL: conceal ? concealedAvatarUrl() : avatarUrlFor(character),
    files: [...message.attachments.values()].map((a) => a.url),
    threadId,
  });

  trackProxy(webhookMessage.id, {
    discordUserId: message.author.id,
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

  await message.delete().catch(() => {});

  return webhookMessage;
}

module.exports = { recentProxies, sendAsCharacter, fetchOrCreateWebhook };
