// The Bird — one written letter a day, to a named person in a GUESSED zone.
// Full rules in docs/systemdocs/BIRD.md.
//
// Everything here is pure: constants, the zone filter, and the exact text of
// every message the feature sends. It requires nothing at all, so all three
// callers share one copy — the web server action that sends the letter, the
// turn pass that reports a failure, and the bot handler that takes the reply.
// Copy that lived in three places would drift, and this feature's copy is
// load-bearing: "The message wasn't delivered." has to be identical whether
// the guess was wrong or the recipient was dead, or the difference between
// those two is readable from the wording.
//
// THE BIRD CARRIES AN OBJECT NOW. It used to hold text of its own, ciphered
// into runes for a recipient who could not read (db/lib/gribble.js, deleted).
// Paper replaced that: you write a letter, and the bird delivers the letter —
// so an illiterate recipient holds a real thing they cannot read, and can hand
// it to somebody who can. See docs/systemdocs/PAPERWORK.md.
//
// Client-safe: import it by path as `@lifeweb/db/lib/bird`, never through the
// @lifeweb/db barrel.

const BIRD_SLUG = "bird";
const LITERATE_SLUG = "literate";
// Blind reads nothing, whatever else is on the sheet. A blind character can
// still be SENT a letter and still carry one — the paper arrives either way,
// and handing it to someone who can read is the play. What they cannot do is
// work the bird themselves.
const BLIND_SLUG = "blind";

// A bird will not fly underground, and will not carry a letter out either.
// Both directions, on purpose: one-way would let someone sitting in the
// Depths send freely while being unreachable, which is a hiding place with a
// mail service.
const UNREACHABLE_ZONE_SLUGS = new Set(["caves", "depths"]);

// customId prefixes for the Reply button and the select it opens. Routed in
// bot/src/events/interactionCreate.js, handled in bot/src/lib/birdReply.js.
//
// A SELECT, not a modal, since the rework: replying means handing the bird a
// letter you are already holding, not typing one — you write with the Write
// button and post it here. That also means a reply can go out sealed.
const BIRD_REPLY_PREFIX = "bird:reply:";
const BIRD_REPLY_PICK_PREFIX = "bird:replypick:";

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

// Stupid cannot compose a sentence, so it cannot compose a letter either —
// the Bird is the one place a written message leaves a character without
// passing through the proxy, so without this it was the loophole that let a
// Squeeze-eater keep talking. Checked as part of canSendBird below rather than
// garbling the body: a letter nobody could have written should not arrive.
const STUPID_SLUG = "stupid";

// Whether written words reach this character at all. Literate and not blind:
// the one place in the game those two facts have to be asked as one question,
// so a caller can never check half of it.
//
// The FULLER gate is db/lib/reading.js#readBlock, which adds the rest of the
// eyes — blind drunk, nearsighted with no spectacles, sun-blind at Dawn. This
// one stays because it is what the Bird's own surfaces ask, and because it is
// pure of any turn or Location context. A tag chip uses readBlock; a bird
// asks this.
function canReadLetters(tags) {
  return hasSlug(tags, LITERATE_SLUG) && !hasSlug(tags, BLIND_SLUG);
}

// Holding the bird is not enough. Working it is still a literate act — you
// address it, and you have to know which of the papers in your hands is the
// one you meant to send.
function canSendBird(tags) {
  return hasSlug(tags, BIRD_SLUG) && canReadLetters(tags) && !hasSlug(tags, STUPID_SLUG);
}

// The letter as the recipient sees it.
//
// The DM no longer contains the words — the PAPER does, and it is in their
// hands now. That is the whole change: an illiterate recipient holds a real
// object they cannot read and can walk it to somebody who can, instead of
// being handed a block of runes and a footnote. What the DM says is that a
// bird came and what it left.
//
// It deliberately does NOT say whether the letter is sealed or what is on it.
// Both are facts about the object, and the object is on their sheet.
//
// The `»` that opens every DM is added by sendDm itself, so the sender's line
// is written bare here.
function deliveryDm({ senderName, letterName }) {
  return (
    `A bird finds you, and there is a letter tied to its leg. It is from **${senderName}**.\n\n` +
    `You take it: **${letterName}**. It is on your sheet. ‡`
  );
}

// The reply, as the original sender sees it. Same shape as the delivery: an
// object arrived, and it is on their sheet.
function replyDm({ replierName, letterName }) {
  return (
    `Your bird's returned, and it is carrying an answer from **${replierName}**.\n\n` +
    `You take it: **${letterName}**. It is on your sheet. ‡`
  );
}

// The sender's own record of what went out. Sent whether or not the letter
// landed, and worded so it gives away nothing about which of those happened.
//
// Note what it CANNOT say: whether the letter left their hands. It did only if
// the guess was right, and saying so here would turn the receipt into the
// instant answer the delayed failure notice exists to withhold. The player
// finds out by looking at their own sheet a turn later, which is the same
// information at the same cost as everybody else's.
function sentReceiptDm({ recipientName, zoneName, letterName }) {
  return `You let the bird go with **${letterName}**, for **${recipientName}**, in the **${zoneName}**. ‡`;
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
  BLIND_SLUG,
  STUPID_SLUG,
  canReadLetters,
  BIRD_SLUG,
  LITERATE_SLUG,
  UNREACHABLE_ZONE_SLUGS,
  BIRD_REPLY_PREFIX,
  BIRD_REPLY_PICK_PREFIX,
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
