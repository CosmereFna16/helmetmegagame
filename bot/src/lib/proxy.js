const { WebhookClient } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { recordArchiveMessage } = require("@lifeweb/db/lib/archive");
const { capitalizeSentences } = require("./textCorrection");
const { resolveChannelContext } = require("./channels");

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
  const { id, token } = await fetchOrCreateWebhook(channel);
  const webhookClient = new WebhookClient({ id, token });
  const threadId = channel.isThread() ? channel.id : undefined;

  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const text = config?.tupperAutocorrectEnabled ? capitalizeSentences(content ?? "") : (content ?? "");

  const webhookMessage = await webhookClient.send({
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
  });

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

// The message-driven path: proxy what a player typed in a tupper channel,
// then delete their original. Everything except the attachment plumbing and
// that deletion lives in postAsCharacterTo above.
async function sendAsCharacter(channel, character, message, { conceal = null, content: override = null } = {}) {
  const { webhookMessage, content } = await postAsCharacterTo(channel, character, {
    content: override ?? message.content,
    files: [...message.attachments.values()].map((a) => a.url),
    discordUserId: message.author.id,
    conceal,
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

module.exports = { recentProxies, sendAsCharacter, postAsCharacterTo, fetchOrCreateWebhook };
