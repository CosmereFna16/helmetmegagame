const { WebhookClient } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { capitalizeSentences } = require("./textCorrection");

const WEBHOOK_NAME = "Lifeweb Tupper";
const MAX_RECENT = 500;

const webhookCache = new Map(); // channelId -> { id, token }
const recentProxies = new Map(); // webhookMessageId -> { discordUserId, characterId, webhookId, webhookToken, threadId }

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

function avatarUrlFor(character) {
  const base = process.env.WEB_BASE_URL;
  if (!base) return undefined;
  return `${base}/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`;
}

async function sendAsCharacter(channel, character, message) {
  const { id, token } = await fetchOrCreateWebhook(channel);
  const webhookClient = new WebhookClient({ id, token });
  const threadId = channel.isThread() ? channel.id : undefined;

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const content = config?.tupperAutocorrectEnabled ? capitalizeSentences(message.content) : message.content;

  const webhookMessage = await webhookClient.send({
    content,
    username: character.name,
    avatarURL: avatarUrlFor(character),
    files: [...message.attachments.values()].map((a) => a.url),
    threadId,
  });

  trackProxy(webhookMessage.id, {
    discordUserId: message.author.id,
    characterId: character.id,
    webhookId: id,
    webhookToken: token,
    threadId,
  });

  await message.delete().catch(() => {});

  return webhookMessage;
}

module.exports = { recentProxies, sendAsCharacter, fetchOrCreateWebhook };
