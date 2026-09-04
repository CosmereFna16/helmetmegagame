// Whether a character can read a piece of writing right now.
//
// Two halves, and they answer to different things. Letters are a SKILL — the
// `literate` tag, bought or taught. Eyes are a CONDITION — blind, blind drunk,
// nearsighted with your spectacles in a sack, or sun-sensitive standing
// outdoors at Dawn. Both have to be true, and db/lib/examineVision.js already
// owns the whole second half, so this file is mostly a composition.
//
// ONE MESSAGE FOR EVERY CAUSE. A blind man and an illiterate one see exactly
// the same line, because the alternative leaks a condition: a tag chip that
// said "your eyes are too bad for this" would tell anyone looking over your
// shoulder something they had no business learning. It also matters that the
// line is the same on a noticeboard, in a DM and on the sheet — a written
// thing you cannot read should look the same everywhere in the game.
//
// No Prisma import, same posture as examineVision.js and inspectVision.js
// beside it: the sheet wants the answer to compose a chip, the server action
// wants it to refuse, and neither should be able to drift from the other.
const { examineBlock } = require("./examineVision");

const LITERATE_SLUG = "literate";

// What every blocked reader sees, whatever blocked them.
const CANNOT_READ = "You can't read this. ‡";

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`),
// and tolerates a bare Tag[] as well. Same as examineVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Null when they can read, CANNOT_READ when they can't.
//
// `where` carries the two facts Sun Sensitivity needs — the open turn's phase
// and whether they are under a roof — and both default to the permissive side,
// so a caller that cannot resolve a turn or a Location never blinds somebody
// by accident. Exactly examineBlock's contract, passed straight through.
function readBlock(characterTags = [], where = {}) {
  if (examineBlock(characterTags, where)) return CANNOT_READ;
  if (!slugSet(characterTags).has(LITERATE_SLUG)) return CANNOT_READ;
  return null;
}

// The positive form, for a caller that only wants to show or hide a button.
function canRead(characterTags = [], where = {}) {
  return readBlock(characterTags, where) === null;
}

module.exports = { readBlock, canRead, CANNOT_READ, LITERATE_SLUG };
