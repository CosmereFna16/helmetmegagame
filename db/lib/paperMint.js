// Writing on a sheet, and the two rows that come out of a broken seal.
//
// This is the FOURTH runtime authoring door onto the tag catalog, beside
// docs/tags.yaml, the GM form at /gm/dev/tags, and the corpse/headstone/crate
// minters. Every row it writes carries `custom: true` so db:sync-tags never
// sees it and db:prune-tags skips it, plus `ephemeral: true` so a Restart Game
// sweeps it up — which is the flag a crate and a headstone were both missing
// until this landed. See docs/systemdocs/PAPERWORK.md.
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays off the @lifeweb/db barrel.

const {
  PAPER_GROUP_SLUG,
  paperName,
  noteCode,
  sealedName,
  brokenSealName,
  appendText,
  sealLabel,
  bookName,
  BOOK_SHEETS,
} = require("./paper");
const { addToStack, dropCharacterTag } = require("./tagWrites");

// Slugified with the `custom-` prefix that keeps a runtime row out of the
// YAML's namespace forever. Unlike a corpse, a sheet has no natural name to
// slugify — two notes by one hand on one day are genuinely different objects —
// so the uniquifier is the character and the clock rather than a suffix.
function paperSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-paper-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

function bookSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-book-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

function sealSlug(characterId, attempt = 0) {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `custom-envelope-${characterId.slice(-8)}-${stamp}-${rand}${attempt ? `-${attempt}` : ""}`;
}

// Every runtime paper row wears the same shape. Weightless on purpose: a sheet
// of paper against a carry cap measured in pounds is noise, and CARRY.md's
// band table has no rung below 1 lb for a reason.
const PAPER_SHAPE = {
  category: "items",
  pointCost: 0,
  custom: true,
  ephemeral: true,
  tradeable: true,
  weightLbs: 0,
  // One sheet is one sheet. Two notes are never the same object, so the
  // non-stackable pin in tagWrites.js is doing real work here.
  stackable: false,
  // Not binnable from the Destroy menu. Paper leaves the world by being torn
  // off a noticeboard and expiring, or by a GM — burning a letter is a thing
  // the fiction should have to say out loud.
  removable: false,
  purchasable: false,
  purchasableAfterStart: false,
  // A letter in your hand is a letter anyone can see you holding. What it SAYS
  // is a different question, and paperDescription answers that one.
  inspectVisibility: "HIDDEN",
};

// Tag.name is @unique across the whole catalog, so retry on the violation
// rather than checking first: two players writing in the same millisecond
// would both pass a pre-check and then one would throw. Six attempts is far
// past anything the game can produce.
// The Paper group, looked up once per mint. It carries the chip colour, and it
// is also what any future "is this paper?" check should match on — the same
// reason corpses are grouped rather than flagged.
async function paperGroupId(tx) {
  const group = await tx.tagGroup.findUnique({ where: { slug: PAPER_GROUP_SLUG }, select: { id: true } });
  return group?.id ?? null;
}

async function createWithRetry(tx, buildData) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await tx.tag.create({ data: buildData(attempt) });
    } catch (err) {
      // P2002 is the @unique on name or slug.
      if (err?.code !== "P2002") throw err;
    }
  }
  return null;
}

// A blank sheet becomes a written one: one unit off the stack, one new row on
// the sheet. Returns the new Tag row.
//
// `character` needs { id, name } — the PRESENTED name, resolved by the caller
// through db/lib/presentedIdentity.js, so a Beast's letter is in the Beast's
// hand and a concealed writer does not sign their own name by accident.
async function writeNewPaper(tx, character, blankTagId, text) {
  await dropCharacterTag(tx, character.id, blankTagId, 1);
  return mintPaperRow(tx, character.id, character.name, text);
}

// A sheet out of nowhere, landing in somebody's hands. The GM letter's minter
// (docs/systemdocs/BIRD.md §9) — a God-King has no sheet to take a page off,
// so unlike writeNewPaper there is no blank stack to spend.
//
// `authorName` is free text the GM typed, and it goes on paperAuthor exactly
// like a writer's presented name would. That is the whole feature: the letter
// is FROM somebody, and who that somebody is was never checked against the
// roster in the first place.
async function mintLetterFor(tx, recipientId, authorName, text) {
  return mintPaperRow(tx, recipientId, authorName, text);
}

// The shared core. Mints the row and puts it in `ownerId`'s hands; what it
// deliberately does NOT do is spend anything, so each caller decides what the
// paper cost.
async function mintPaperRow(tx, ownerId, authorName, text) {
  const character = { id: ownerId, name: authorName };
  const groupId = await paperGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PAPER_SHAPE,
    groupId,
    slug: paperSlug(character.id, attempt),
    // A fresh code per attempt, so a collision is resolved by re-rolling the
    // waybill rather than by appending "(2)" — two sheets called "A Note
    // (TG-4596)" and "A Note (TG-4596) (2)" would look related and are not.
    name: paperName(noteCode()),
    // Never the text. The description column is broadcast to every browser;
    // paperDescription composes what a given reader is allowed to see.
    description: null,
    paperKind: "PAPER",
    paperText: (text ?? "").trim(),
    paperAuthor: character.name,
  }));
  if (!tag) throw new Error("Could not name the paper.");

  await addToStack(tx, character.id, tag.id, 1, {});
  return tag;
}

// Binding ten sheets into a book: the stack pays, one row comes back, and the
// text is fixed there and then. That last part is the only rule a book has
// that a sheet does not — appendToPaper refuses a BOOK, so what is bound in is
// what it says forever. See docs/systemdocs/PAPERWORK.md.
//
// Unlike a note, a book's NAME is its title and is meant to be read off the
// shelf. That is not the leak a note's title would be: a title is what the
// writer chose to advertise, and the contents still sit behind the literacy
// gate in paperDescription.
//
// `character` needs { id, name } — the PRESENTED name, same as writeNewPaper.
async function bindBook(tx, character, blankTagId, title, text) {
  await dropCharacterTag(tx, character.id, blankTagId, BOOK_SHEETS);
  const groupId = await paperGroupId(tx);

  const tag = await createWithRetry(tx, (attempt) => ({
    ...PAPER_SHAPE,
    groupId,
    slug: bookSlug(character.id, attempt),
    name: attempt ? `${bookName(title)} (${attempt + 1})` : bookName(title),
    // A book has real heft, unlike a sheet — ten of them bound between boards
    // is the first thing in the paper group a carry cap should notice.
    weightLbs: 1,
    // And unlike a note, a book is something anyone can see you carrying, the
    // title included. What it SAYS is still paperDescription's question.
    inspectVisibility: "ALWAYS",
    description: null,
    paperKind: "BOOK",
    paperText: (text ?? "").trim(),
    paperAuthor: character.name,
  }));
  if (!tag) throw new Error("Could not name the book.");

  await addToStack(tx, character.id, tag.id, 1, {});
  return tag;
}

// Tearing one up, in either direction: a bound book becomes ten blank sheets
// again. The row goes rather than being renamed, because unlike a broken seal
// there is nothing left worth keeping — the words are the thing, and tearing
// them up is the point.
//
// An AUTHORED book (docs/tags.yaml, not `custom`) is left in the catalog and
// only taken out of the character's hands. Deleting it would take a Library
// book out of the game for good on one player's whim, and the next
// db:sync-tags would put it straight back.
async function tearUpBook(tx, characterId, bookTag, blankTagId) {
  await dropCharacterTag(tx, characterId, bookTag.id, 1);
  if (bookTag.custom) {
    await tx.tag.deleteMany({ where: { id: bookTag.id, custom: true } });
  }
  // `stackable: true` is load-bearing: without it addToStack caps the add at
  // one and refuses to increment a stack that already exists, so tearing up a
  // book would return a single sheet — or none at all if you were already
  // holding paper.
  await addToStack(tx, characterId, blankTagId, BOOK_SHEETS, { stackable: true });
}

// Writing more on a sheet that already has words on it. Append-only, always —
// there is no path anywhere in the game that shortens paperText.
async function appendToPaper(tx, tagId, existingText, addition) {
  return tx.tag.update({
    where: { id: tagId },
    data: { paperText: appendText(existingText, addition) },
  });
}

// Sealing RENAMES THE ROW IN PLACE, the same move a corpse makes when it rots
// (db/lib/corpseRotPass.js). A second row would mean a letter somebody is
// carrying changing hands mid-seal, and a holding to reconcile; renaming means
// the sheet in your hand is the sheet that was always in your hand.
//
// The stamp is NOT consumed. A wax stamp presses as many letters as you have
// wax for, and metering the wax is a system nobody asked for.
async function sealPaper(tx, paperTag, stampTag) {
  return sealWithMark(tx, paperTag, { label: sealLabel(stampTag), mark: stampTag.sealMark ?? null });
}

// The same seal, pressed with wax nobody owns. Every mark in the game
// otherwise comes off a real stamp Tag, and that is right for players — a seal
// is a physical object you can be robbed of. A GM letter has no stamp, so it
// says outright what the wax carries, and the mark then flows through
// paperDescription like any other.
async function sealWithMark(tx, paperTag, { label, mark }) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await tx.tag.update({
        where: { id: paperTag.id },
        data: {
          // Whose wax is on it is PUBLIC — that is the whole point of sealing
          // a letter — so unlike a note's title this one says something.
          name: attempt ? `${sealedName(label)} (${attempt + 1})` : sealedName(label),
          paperKind: "SEALED",
          sealMark: mark ?? null,
          // Consuming a sealed letter is how you break the seal.
          consumable: true,
        },
      });
    } catch (err) {
      if (err?.code !== "P2002") throw err;
    }
  }
  throw new Error("Could not name the sealed letter.");
}

// Breaking one. Two writes, and both matter: the letter comes back exactly as
// it was written, and the spent envelope stays behind as evidence that
// somebody opened it and whose wax was on it.
//
// Returns { paper, envelope }.
async function breakSeal(tx, characterId, sealedTag) {
  const label = sealLabel(sealedTag);

  let paper = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      paper = await tx.tag.update({
        where: { id: sealedTag.id },
        data: {
          // Back to an anonymous note. The letter inside says whatever it
          // said; who sealed it survives on the envelope, not on the paper.
          name: paperName(noteCode()),
          paperKind: "PAPER",
          sealMark: null,
          consumable: false,
        },
      });
      break;
    } catch (err) {
      if (err?.code !== "P2002") throw err;
    }
  }
  if (!paper) throw new Error("Could not name the opened letter.");

  const envelopeGroupId = await paperGroupId(tx);
  const envelope = await createWithRetry(tx, (attempt) => ({
    ...PAPER_SHAPE,
    groupId: envelopeGroupId,
    slug: sealSlug(characterId, attempt),
    name: attempt ? `${brokenSealName(label)} (${attempt + 1})` : brokenSealName(label),
    description: null,
    paperKind: "BROKEN_SEAL",
    sealMark: sealedTag.sealMark ?? null,
  }));
  if (envelope) await addToStack(tx, characterId, envelope.id, 1, {});

  return { paper, envelope };
}

module.exports = {
  PAPER_SHAPE,
  writeNewPaper,
  bindBook,
  tearUpBook,
  mintLetterFor,
  sealWithMark,
  appendToPaper,
  sealPaper,
  breakSeal,
  paperSlug,
};
