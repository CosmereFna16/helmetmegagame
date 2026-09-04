const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { prisma } = require("@lifeweb/db");
const { sendDm } = require("@lifeweb/db/lib/dm");
const {
  BIRD_REPLY_MODAL_PREFIX,
  BIRD_REPLY_INPUT_ID,
  MAX_BIRD_BODY,
  TOO_LATE_REPLY,
  canReadLetters,
  STUPID_SLUG,
  replyDm,
} = require("@lifeweb/db/lib/bird");
const { ack, respond } = require("./respond");

// The Reply button on a Bird's letter, and the modal it opens. See
// docs/systemdocs/BIRD.md.
//
// This runs in a DM, so there is no guild and no member — nothing here may
// touch interaction.guild or interaction.member. It doesn't need to: the
// BirdMessage row carries both parties as snapshots, so answering a letter is
// one read and one write with no lookups against live state at all.
//
// THE WINDOW IS THE WHOLE MECHANIC. A letter can be answered during the turn it
// arrived in and the one after, and then the bird is gone. Both handlers check
// it, not just the button: a player can sit on an open modal across a turn
// boundary, and the submit is the only check that can't be outrun.

// A modal must be shown within three seconds and CANNOT be deferred first, so
// the button handler stays to a small, fixed number of reads. Same constraint
// converseModal.js documents.
function buildReplyModal(birdMessageId, recipientName) {
  return new ModalBuilder()
    .setCustomId(`${BIRD_REPLY_MODAL_PREFIX}${birdMessageId}`)
    .setTitle("Reply")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`To ${recipientName}`.slice(0, 45))
        .setDescription("The bird waits. It will not wait past next turn.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(BIRD_REPLY_INPUT_ID)
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MAX_BIRD_BODY)
            .setRequired(true),
        ),
    );
}

// Shared by both handlers so the button and the submit can never disagree
// about whether the window is open — or about whether the replier can write at
// all.
async function windowState(birdMessageId) {
  const message = await prisma.birdMessage.findUnique({ where: { id: birdMessageId } });
  if (!message) return { ok: false, reason: TOO_LATE_REPLY };
  // One reply, never a chain.
  if (message.repliedAt) return { ok: false, reason: "You already sent your answer." };
  if (!message.delivered || message.replyDeadlineTurn == null) {
    return { ok: false, reason: TOO_LATE_REPLY };
  }

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  // No open turn means the game is between turns; the bird is not gone, it is
  // simply waiting, and refusing here would burn a reply on a technicality.
  if (!openTurn) return { ok: false, reason: "The bird is restless. Try again when the turn opens." };
  if (openTurn.number > message.replyDeadlineTurn) return { ok: false, reason: TOO_LATE_REPLY };

  // Answering a letter is writing one, so it wants the same Literate the sender
  // needed. An illiterate recipient is never given the Reply button in the
  // first place (web requestActions.js), but the button is only a hint: a GM
  // can strip the tag between the letter landing and the answer going out.
  // Read last, so the cheap refusals above stay cheap.
  const replier = await prisma.character.findUnique({
    where: { id: message.recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!replier || !canReadLetters(replier.tags) || replier.tags.some((ct) => ct.tag.slug === STUPID_SLUG)) {
    return { ok: false, reason: "You cannot write. The bird leaves without an answer." };
  }

  return { ok: true, message };
}

async function handleBirdReplyOpen(interaction, birdMessageId) {
  const state = await windowState(birdMessageId);
  if (!state.ok) {
    // No ack() first — this path never opened a modal, so a plain ephemeral
    // reply is still available and is the fastest answer.
    return interaction.reply({ content: state.reason, ephemeral: true }).catch(() => {});
  }
  // showModal IS the acknowledgement. Never ack() before one.
  return interaction.showModal(buildReplyModal(birdMessageId, state.message.senderName));
}

async function handleBirdReplySubmit(interaction, birdMessageId) {
  await ack(interaction);

  const body = (interaction.fields.getTextInputValue(BIRD_REPLY_INPUT_ID) ?? "").trim();
  if (!body) return respond(interaction, "You wrote nothing.");

  // Re-checked on submit, not just on open: a modal can sit on screen across a
  // turn boundary, and this is the check that cannot be outrun.
  const state = await windowState(birdMessageId);
  if (!state.ok) return respond(interaction, state.reason);
  const message = state.message;

  // The claim IS the check, the same shape every other race in this codebase
  // uses: two submits of one modal both pass a read-then-write.
  const claimed = await prisma.birdMessage.updateMany({
    where: { id: message.id, repliedAt: null },
    data: { repliedAt: new Date(), replyBody: body.slice(0, MAX_BIRD_BODY) },
  });
  if (claimed.count === 0) return respond(interaction, "You already sent your answer.");

  if (!message.senderDiscordUserId) {
    return respond(interaction, "The bird can't find who sent it.");
  }

  // The original sender is Literate by definition — they could not have sent
  // the letter otherwise — so a reply is never ciphered. Checked anyway rather
  // than assumed, because a GM can strip a tag at any time.
  const sender = await prisma.character.findUnique({
    where: { id: message.senderId },
    include: { tags: { include: { tag: true } } },
  });
  const senderIsLiterate = sender ? canReadLetters(sender.tags) : true;

  const text = replyDm({ replierName: message.recipientName, body, senderIsLiterate });

  await sendDm(prisma, message.senderDiscordUserId, text, {
    source: "bird",
    meta: { kind: "bird_reply", birdMessageId: message.id, plaintext: body },
  }).catch((err) => console.error(`Bird reply DM to ${message.senderDiscordUserId} failed:`, err));

  return respond(interaction, "The bird is away.");
}

module.exports = { handleBirdReplyOpen, handleBirdReplySubmit };
