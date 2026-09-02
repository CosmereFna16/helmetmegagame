// The Bird — one written letter a day, to a named person in a GUESSED zone.
// Full rules in docs/systemdocs/BIRD.md.
//
// Everything here is pure: constants, the zone filter, and the exact text of
// every message the feature sends. It requires nothing but lib/gribble.js
// (itself a leaf), so all three callers share one copy — the web server action
// that sends the letter, the turn pass that reports a failure, and the bot
// handler that takes the reply. Copy that lived in three places would drift,
// and this feature's copy is load-bearing: "The message wasn't delivered." has
// to be identical whether the guess was wrong or the recipient was dead, or
// the difference between those two is readable from the wording.
//
// Client-safe by the same rule gribble.js follows — import it by path as
// `@lifeweb/db/lib/bird`, never through the @lifeweb/db barrel.
const { encodeGribble } = require("./gribble");

const BIRD_SLUG = "bird";
const LITERATE_SLUG = "literate";

// A bird will not fly into the deep caves, and will not carry a letter out of
// them either. Both directions, on purpose: one-way would let someone sitting
// on the Railroad send freely while being unreachable, which is a hiding place
// with a mail service.
const UNREACHABLE_ZONE_SLUGS = new Set(["railroad", "aberrant-pits"]);

// Long enough for a real letter, short enough that the ciphered form stays
// inside Discord's 2000-character message limit: 900 characters of ASCII
// become ~1208 runes, and the framing around them is under a hundred more.
// Enforced server-side as well as in the textarea — a server action is a
// public endpoint.
const MAX_BIRD_BODY = 900;

// customId prefixes for the Reply button and the modal it opens. Routed in
// bot/src/events/interactionCreate.js, handled in bot/src/lib/birdReply.js.
const BIRD_REPLY_PREFIX = "bird:reply:";
const BIRD_REPLY_MODAL_PREFIX = "bird:replymodal:";
const BIRD_REPLY_INPUT_ID = "body";

// Deliberately identical for a wrong guess and for a dead recipient. Telling
// those apart would make the bird a once-a-day test for whether somebody is
// still alive, which is a far better deal than the letter it is supposed to be.
const NOT_DELIVERED_DM = "The message wasn't delivered.";

const TOO_LATE_REPLY = "It's too late. The bird flew away.";

// Which zones a letter may be addressed to. Takes Zone rows, returns the ones
// a player may pick: everywhere standable except the two deep cave levels.
// CAVE_GROUP is dropped because "Caves" is not a place anyone stands — the
// same rule performTravel enforces (MAP.md §1).
function birdZones(zones) {
  return zones.filter((z) => z.kind !== "CAVE_GROUP" && !UNREACHABLE_ZONE_SLUGS.has(z.slug));
}

function isBirdReachableZone(zone) {
  return Boolean(zone) && zone.kind !== "CAVE_GROUP" && !UNREACHABLE_ZONE_SLUGS.has(zone.slug);
}

function hasSlug(tags, slug) {
  return Array.isArray(tags) && tags.some((ct) => (ct.tag ? ct.tag.slug : ct.slug) === slug);
}

// Holding the bird is not enough — you have to be able to write the letter.
function canSendBird(tags) {
  return hasSlug(tags, BIRD_SLUG) && hasSlug(tags, LITERATE_SLUG);
}

// The letter as the recipient sees it.
//
// An illiterate recipient gets the real thing, ciphered, rather than a refusal
// — the letter did arrive, they simply cannot read it, and the footer tells
// them what to do about that. That turns illiteracy into something they play
// through (find someone who reads) instead of a dead end. They get no Reply
// button, though — see the caller in web requestActions.js.
//
// The `»` that opens every DM is added by sendDm itself, so the sender's line
// is written bare here.
function deliveryDm({ senderName, body, recipientIsLiterate }) {
  if (recipientIsLiterate) {
    return `A bird finds you, and there is a letter tied to its leg. It is from **${senderName}**.\n\n> ${body.replace(/\n/g, "\n> ")}`;
  }
  return (
    `A bird brings you a letter. You can’t read it because you’re illiterate.\n\n` +
    `${encodeGribble(body)}\n\n` +
    `-# Show this to someone with the Literate tag. They can decode it with the Read button.`
  );
}

// The reply, as the original sender sees it.
//
// They are Literate by definition — they could not have sent the letter
// otherwise — so in practice this is never ciphered. The branch exists anyway,
// because a GM can strip a tag between the letter going out and the answer
// coming back, and a sender who lost their letters in the meantime should get
// the same unreadable block anyone else would.
function replyDm({ replierName, body, senderIsLiterate = true }) {
  const opening = `Your bird's returned. It is from **${replierName}**.`;
  if (senderIsLiterate) {
    return `${opening}\n\n> ${body.replace(/\n/g, "\n> ")}`;
  }
  return (
    `${opening}\n\nYou cannot read a word of it.\n\n${encodeGribble(body)}\n\n` +
    `-# Show this to someone with the Literate tag. They can decode it with the Read button.`
  );
}

// The sender's own record of what went out. Sent whether or not the letter
// landed, and worded so it gives away nothing about which of those happened.
function sentReceiptDm({ recipientName, zoneName, body }) {
  return (
    `You let the bird go. It carries your letter to **${recipientName}**, in the **${zoneName}**.\n\n` +
    `> ${body.replace(/\n/g, "\n> ")}`
  );
}

// One button, on the letter itself. The id is the BirdMessage row's, which is
// what the handler needs to check the reply window against.
function replyButtonRow(birdMessageId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 2, custom_id: `${BIRD_REPLY_PREFIX}${birdMessageId}`, label: "Reply" },
      ],
    },
  ];
}

module.exports = {
  BIRD_SLUG,
  LITERATE_SLUG,
  UNREACHABLE_ZONE_SLUGS,
  MAX_BIRD_BODY,
  BIRD_REPLY_PREFIX,
  BIRD_REPLY_MODAL_PREFIX,
  BIRD_REPLY_INPUT_ID,
  NOT_DELIVERED_DM,
  TOO_LATE_REPLY,
  birdZones,
  isBirdReachableZone,
  canSendBird,
  deliveryDm,
  replyDm,
  sentReceiptDm,
  replyButtonRow,
};
