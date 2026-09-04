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
  const label = sealLabel(stampTag);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await tx.tag.update({
        where: { id: paperTag.id },
        data: {
          // Whose wax is on it is PUBLIC — that is the whole point of sealing
          // a letter — so unlike a note's title this one says something.
          name: attempt ? `${sealedName(label)} (${attempt + 1})` : sealedName(label),
          paperKind: "SEALED",
          sealMark: stampTag.sealMark ?? null,
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
  appendToPaper,
  sealPaper,
  breakSeal,
  paperSlug,
};
