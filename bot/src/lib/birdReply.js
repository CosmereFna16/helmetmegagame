const { prisma } = require("@lifeweb/db");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { addToStack, dropCharacterTag } = require("@lifeweb/db/lib/tagWrites");
const {
  BIRD_REPLY_PICK_PREFIX,
  TOO_LATE_REPLY,
  canReadLetters,
  STUPID_SLUG,
  replyDm,
} = require("@lifeweb/db/lib/bird");
const { ack, respond } = require("./respond");

// The Reply button on a Bird's letter, and the picker it opens. See
// docs/systemdocs/BIRD.md and docs/systemdocs/PAPERWORK.md.
//
// IT IS A PICKER, NOT A MODAL, since paper landed. Replying means handing the
// bird a letter you are already holding — you write it with the Write button on
// your sheet, which has a real text box and no three-second clock on it. What
// this does is choose which of your papers goes back, and a reply can therefore
// go out sealed, which a modal could never have expressed.
//
// This runs in a DM, so there is no guild and no member — nothing here may
// touch interaction.guild or interaction.member. It doesn't need to: the
// BirdMessage row carries both parties as snapshots.
//
// THE WINDOW IS THE WHOLE MECHANIC. A letter can be answered during the turn it
// arrived in and the one after, and then the bird is gone. Both handlers check
// it, not just the button: a player can sit on an open picker across a turn
// boundary, and the submit is the only check that can't be outrun.

// Discord's cap on a string select's options.
const OPTION_LIMIT = 25;

// Shared by both handlers so the button and the pick can never disagree about
// whether the window is open — or about whether the replier can write at all.
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

  // Working the bird is a literate act, the same one the sender needed. An
  // illiterate recipient is never given the Reply button in the first place
  // (web requestActions.js), but the button is only a hint: a GM can strip the
  // tag between the letter landing and the answer going out. Read last, so the
  // cheap refusals above stay cheap.
  const replier = await prisma.character.findUnique({
    where: { id: message.recipientId },
    include: { tags: { include: { tag: true } } },
  });
  if (!replier || !canReadLetters(replier.tags) || replier.tags.some((ct) => ct.tag.slug === STUPID_SLUG)) {
    return { ok: false, reason: "You cannot write. The bird leaves without an answer. ‡" };
  }

  return { ok: true, message, replier };
}

// What the replier could send back: anything written or sealed that they are
// holding. Deliberately not filtered by whether they can READ it — handing on
// a sealed letter you cannot open is a legitimate and interesting move.
function sendableLetters(replier) {
  return replier.tags
    .filter((ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED")
    .filter((ct) => ct.tag.paperKind === "SEALED" || (ct.tag.paperText ?? "").trim())
    .slice(0, OPTION_LIMIT);
}

async function handleBirdReplyOpen(interaction, birdMessageId) {
  await ack(interaction, { ephemeral: true });

  const state = await windowState(birdMessageId);
  if (!state.ok) return respond(interaction, { content: state.reason, ephemeral: true });

  const letters = sendableLetters(state.replier);
  if (letters.length === 0) {
    return respond(interaction, {
      content:
        "You have nothing written to send back. Write a letter on your sheet, then answer before the bird goes. ‡",
      ephemeral: true,
    });
  }

  return respond(interaction, {
    content: `The bird waits for something to carry back to **${state.message.senderName}**. It will not wait past next turn. ‡`,
    ephemeral: true,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${BIRD_REPLY_PICK_PREFIX}${birdMessageId}`,
            placeholder: "Which letter? ‡",
            options: letters.map((ct) => ({
              label: ct.tag.name.slice(0, 100),
              value: ct.tagId,
              description: ct.tag.paperKind === "SEALED" ? "Sealed" : undefined,
            })),
          },
        ],
      },
    ],
  });
}

async function handleBirdReplyPick(interaction, birdMessageId) {
  await ack(interaction, { ephemeral: true });

  const tagId = interaction.values?.[0];
  if (!tagId) return respond(interaction, { content: "Nothing picked. ‡", ephemeral: true });

  // Re-checked on the pick, not just on open: the panel can sit on screen
  // across a turn boundary, and this is the check that cannot be outrun.
  const state = await windowState(birdMessageId);
  if (!state.ok) return respond(interaction, { content: state.reason, ephemeral: true });
  const { message, replier } = state;

  // Resolved against what they actually hold, never against what was posted.
  const held = replier.tags.find((ct) => ct.tagId === tagId);
  if (!held || !held.tag.paperKind) {
    return respond(interaction, { content: "You aren't holding that. ‡", ephemeral: true });
  }

  if (!message.senderDiscordUserId) {
    return respond(interaction, { content: "The bird can't find who sent it. ‡", ephemeral: true });
  }

  // The claim IS the check, the same shape every other race in this codebase
  // uses: two picks on one panel both pass a read-then-write.
  const claimed = await prisma.birdMessage.updateMany({
    where: { id: message.id, repliedAt: null },
    data: {
      repliedAt: new Date(),
      // A snapshot for the GM desk, null on a sealed reply — the bird did not
      // open that one either.
      replyBody: held.tag.paperKind === "SEALED" ? null : (held.tag.paperText ?? "").trim(),
    },
  });
  if (claimed.count === 0) return respond(interaction, { content: "You already sent your answer.", ephemeral: true });

  // A reply to somebody who has since died goes nowhere, and the letter stays
  // in the replier's hands rather than vanishing into an empty sheet.
  const senderAlive = await prisma.character.findFirst({
    where: { id: message.senderId, status: "ALIVE" },
    select: { id: true },
  });
  if (!senderAlive) {
    return respond(interaction, {
      content: "The bird will not go. Something has happened to whoever sent it. ‡",
      ephemeral: true,
    });
  }

  // The letter changes hands for real — same as an outbound send.
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, replier.id, tagId, 1);
    await addToStack(tx, message.senderId, tagId, 1, {});
  });

  await sendDm(prisma, message.senderDiscordUserId, replyDm({ replierName: message.recipientName, letterName: held.tag.name }), {
    source: "bird",
    meta: { kind: "bird_reply", birdMessageId: message.id, letterName: held.tag.name },
  }).catch((err) => console.error(`Bird reply DM to ${message.senderDiscordUserId} failed:`, err));

  return respond(interaction, { content: `The bird is away with ${held.tag.name}. ‡`, ephemeral: true });
}

module.exports = { handleBirdReplyOpen, handleBirdReplyPick };
