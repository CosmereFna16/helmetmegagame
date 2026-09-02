// Acknowledging and answering a Discord interaction correctly.
//
// Discord gives a bot three seconds to acknowledge an interaction, so `ack`
// must run before any database work, not after. A reply over 2000 characters
// is rejected outright after that work has already committed, so `respond`
// clamps it instead. Every handler that touches the database calls `ack`
// first and answers via `respond`, not `interaction.reply` — the exception is
// a handler that opens a modal, where `showModal` IS the acknowledgement.

const { MessageFlags } = require("discord.js");

const DISCORD_MESSAGE_LIMIT = 2000;
const TRUNCATION_NOTE = "\n-# …trimmed to fit Discord's 2000-character limit.";

// How long an ephemeral reply sits before it self-deletes. Well inside the
// interaction token's 15-minute life, and long enough to actually read.
const FLEETING_DELETE_DELAY_MS = 60_000;

// Trims to Discord's limit rather than letting the send fail. Truncating a
// long reply costs the tail of one message; failing loses the whole reply on
// work that already happened.
function clampContent(content) {
  const text = String(content ?? "");
  if (text.length <= DISCORD_MESSAGE_LIMIT) return text;
  return text.slice(0, DISCORD_MESSAGE_LIMIT - TRUNCATION_NOTE.length) + TRUNCATION_NOTE;
}

// Schedules an already-answered interaction's reply (or, for a `deferUpdate`
// component interaction, its own picker message) to self-delete after
// FLEETING_DELETE_DELAY_MS. `respond` calls this itself; exported for the
// handful of sites (a raw `interaction.update(...)`, the Speak flow's own
// defer/edit pair) that answer without going through `respond` but still
// want the same 60s expiry.
function scheduleDismiss(interaction) {
  // The user may dismiss it, restart their client, or the token may have
  // gone dead in the meantime — any of which makes this a routine no-op.
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, FLEETING_DELETE_DELAY_MS);
}

// Acknowledge before doing any work. `update: true` for a component
// interaction whose own message is being edited in place, so Discord doesn't
// post a second "thinking" message above it.
async function ack(interaction, { update = false, ephemeral = true } = {}) {
  if (interaction.deferred || interaction.replied) return;
  try {
    if (update) {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
    }
  } catch (err) {
    // A dead token cannot be revived, and a handler that can't ack still has
    // real work to finish. Log and carry on.
    console.error("Failed to acknowledge interaction:", err);
  }
}

// Answers, picking edit/follow-up/reply from what has already happened to
// this interaction. Never throws: a failed reply must not become an
// unhandled rejection on top of database work that's already done. Self-
// deletes after FLEETING_DELETE_DELAY_MS by default; pass `fleeting: false`
// to opt a specific reply out.
async function respond(interaction, payload, { fleeting = true } = {}) {
  const options = typeof payload === "string" ? { content: payload } : { ...payload };
  if (options.content !== undefined) options.content = clampContent(options.content);

  try {
    if (interaction.deferred) {
      await interaction.editReply(options);
    } else if (interaction.replied) {
      await interaction.followUp({ ...options, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ ...options, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error("Failed to respond to interaction:", err);
    return;
  }

  if (fleeting) scheduleDismiss(interaction);
}

module.exports = { ack, respond, scheduleDismiss, DISCORD_MESSAGE_LIMIT };
