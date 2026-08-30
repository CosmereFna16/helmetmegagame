// Editing a message you posted as your character, without typing into a DM.
//
// This used to be a DM collector: ✏️ sent "Reply here with the new text (60
// seconds)", then awaitMessages ate whatever came back. Two things were wrong
// with it. For the player, sixty seconds is not long enough to retype a
// paragraph they had already written once, and the whole message had to be
// composed from scratch because nothing was prefilled. For the GMs, every one
// of those replies landed in the DirectMessage log — ~21 a day — and a
// long in-character post sitting in the inbox reads exactly like mail.
//
// A reaction carries no interaction token, so a modal cannot open straight
// off ✏️. The path is: reaction → a DM carrying one button → the button click
// IS an interaction → modal, prefilled with the current text. Nothing the
// player writes ever travels as a DM message, so there is nothing to filter.

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { updateArchiveMessage } = require("@lifeweb/db/lib/archive");
const { recentProxies, webhookClientFor } = require("./proxy");
const { ack, respond } = require("./respond");

const OPEN_PREFIX = "edit:open:";
const MODAL_PREFIX = "edit:send:";
const BODY_ID = "edit:body";

// Discord's own ceiling for a message. The modal's TextInput would take 4000,
// but anything past 2000 would only be rejected by the webhook edit after the
// player had written it.
const MESSAGE_LIMIT = 2000;

// The text to prefill the modal with, stashed when ✏️ is pressed.
//
// Why stash rather than fetch at click time: showModal IS the acknowledgement
// (see lib/respond.js), so it has to land inside Discord's three-second
// window and cannot wait on a REST fetchMessage first. The content is already
// in hand at reaction time — messageReactionAdd fetches the message before it
// reaches the ✏️ branch — so pressing ✏️ again after an edit re-arms this with
// the new text.
//
// In memory, like recentProxies next door, and capped the same way. A restart
// loses it, but a restart also loses recentProxies, so the button would refuse
// anyway.
const MAX_PENDING = 500;
const PENDING_TTL_MS = 15 * 60_000; // matches an interaction token's life
const pendingEdits = new Map(); // webhookMessageId -> { content, expiresAt }

function stashEdit(webhookMessageId, content) {
  pendingEdits.set(webhookMessageId, { content: content ?? "", expiresAt: Date.now() + PENDING_TTL_MS });
  if (pendingEdits.size > MAX_PENDING) {
    const oldest = pendingEdits.keys().next().value;
    pendingEdits.delete(oldest);
  }
}

function takeStashed(webhookMessageId) {
  const entry = pendingEdits.get(webhookMessageId);
  if (!entry) return null;
  // Left in place rather than deleted: a player who opens the modal, closes it
  // and presses the button again should get their text back, not an empty box.
  if (entry.expiresAt <= Date.now()) {
    pendingEdits.delete(webhookMessageId);
    return null;
  }
  return entry.content;
}

// The DM the ✏️ reaction sends. One button, carrying the message id — the
// submit handler needs no state of its own beyond recentProxies.
function buildEditPrompt(webhookMessageId) {
  return {
    content: "» *Edit that message.*",
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${OPEN_PREFIX}${webhookMessageId}`)
          .setLabel("Edit text")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildEditModal(webhookMessageId, currentContent) {
  return new ModalBuilder()
    .setCustomId(`${MODAL_PREFIX}${webhookMessageId}`)
    .setTitle("Edit message")
    .addLabelComponents(
      new LabelBuilder().setLabel("Message").setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(BODY_ID)
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MESSAGE_LIMIT)
          .setRequired(true)
          .setValue((currentContent ?? "").slice(0, MESSAGE_LIMIT)),
      ),
    );
}

// Resolves the proxy a button/modal id points at, and checks the presser owns
// it. `interaction.guild` and `.member` are null in a DM and this runs in one,
// so ownership is interaction.user.id against the tracked author — which is
// all this flow needs.
function resolveOwnedProxy(interaction, prefix) {
  const messageId = interaction.customId.slice(prefix.length);
  const proxy = recentProxies.get(messageId);
  if (!proxy || proxy.discordUserId !== interaction.user.id) return { messageId, proxy: null };
  return { messageId, proxy };
}

// NO ack() here on purpose: showModal is the acknowledgement, and a deferred
// interaction can no longer open a modal.
async function handleEditOpen(interaction) {
  const { messageId, proxy } = resolveOwnedProxy(interaction, OPEN_PREFIX);
  if (!proxy) {
    await ack(interaction);
    await respond(interaction, "» *That message can no longer be edited.*");
    return;
  }
  await interaction.showModal(buildEditModal(messageId, takeStashed(messageId)));
}

async function handleEditSubmit(interaction) {
  await ack(interaction);

  const { messageId, proxy } = resolveOwnedProxy(interaction, MODAL_PREFIX);
  if (!proxy) {
    await respond(interaction, "» *That message can no longer be edited.*");
    return;
  }

  const content = interaction.fields.getTextInputValue(BODY_ID);

  try {
    // threadId rides in the options object here. Webhook#deleteMessage takes
    // it positionally instead, and mixing the two 400'd every ❌ in a thread
    // until recently — check the signature, don't copy by eye.
    await webhookClientFor({ id: proxy.webhookId, token: proxy.webhookToken }).editMessage(messageId, {
      content,
      threadId: proxy.threadId,
    });
  } catch (err) {
    console.error(`Failed to edit proxied message ${messageId}:`, err);
    await respond(interaction, "» *Couldn't update that message, it may be too old.*");
    return;
  }

  // Only after Discord has accepted the edit, or /archive would show text that
  // was never actually posted.
  await updateArchiveMessage(prisma, messageId, content).catch((err) =>
    console.error(`Edited message ${messageId} but couldn't mirror it into the archive:`, err),
  );
  stashEdit(messageId, content);
  await respond(interaction, "» *Updated.*");
}

module.exports = {
  OPEN_PREFIX,
  MODAL_PREFIX,
  buildEditPrompt,
  stashEdit,
  handleEditOpen,
  handleEditSubmit,
};
