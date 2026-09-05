"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { readBlock } from "@lifeweb/db/lib/reading";
import { PAPER_SLUG, BOOK_SHEETS, isBook, isPaper, isSeal, paperDescription } from "@lifeweb/db/lib/paper";
import { writeNewPaper, appendToPaper, sealPaper, bindBook, tearUpBook } from "@lifeweb/db/lib/paperMint";
import {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} from "@lifeweb/db/lib/presentedIdentity";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { guarded, UserError } from "@/lib/actionResult";
import { auth } from "@/lib/auth";

// Writing and sealing. See docs/systemdocs/PAPERWORK.md.
//
// NEITHER FILES A REQUEST, and that is deliberate — the same call
// equipActions.js makes. Writing costs nothing, spends no Move, and is the
// single most frequent thing a scribe does; a Request per sentence would drown
// /gm/turns and /gm/audit at 100+ players, and there is nothing for a GM to
// adjudicate. What a GM needs is to READ the letters, and they can: the text
// is on the tag, and every GM surface that renders a tag renders it.
//
// The one paper verb that IS a Request is breaking a seal, because that
// destroys something and has to be undoable — it lives in requestActions.js
// with the rest of Consume.

// Long enough for a real letter, short enough that nobody pastes a novel into
// a column every browser then loads. A sheet can be written on again, so this
// is a per-pass cap, not a lifetime one.
const WRITE_MAX = 2000;

// A book holds more than a letter does — that is most of why anyone would bind
// one — but it is still one column every reader of that book then loads.
const BOOK_MAX = 12000;

// Long enough for a real title, short enough to read off a shelf. Tag.name has
// the suffix bookName adds on top of this.
const TITLE_MAX = 60;

// The same shape readBlock and paperDescription both want, resolved once.
async function requireWriter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // From the session, never from a posted id: a server action is a public
  // endpoint, and an id on the wire would let anyone write on anyone's sheet.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      updatedAt: true,
      location: { select: { indoors: true } },
      tags: {
        select: {
          tagId: true,
          quantity: true,
          equipped: true,
          tag: {
            select: {
              id: true,
              slug: true,
              name: true,
              paperKind: true,
              paperText: true,
              paperAuthor: true,
              sealMark: true,
              forcedName: true,
              ...CONCEALMENT_TAG_FIELDS,
            },
          },
        },
      },
    },
  });
  if (!character) redirect("/character");

  const turn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    orderBy: { number: "desc" },
    select: { phase: true },
  });

  return {
    session,
    character,
    where: { phase: turn?.phase ?? null, indoors: character.location?.indoors ?? true },
  };
}

function revalidateAll() {
  revalidatePath("/character");
  revalidatePath("/faction");
}

// Who signs the paper, internally. The PRESENTED name, so a hooded writer does
// not put their real one on a sheet somebody may later find — and so a forced
// name (Apex Form) writes as the Beast. Never rendered to another player: it
// only tells a GM whose hand it was, since Tag.name is deliberately anonymous
// (db/lib/paper.js#paperName). Read off the tags already loaded rather than
// through loadForcedName, so this costs no second query.
function writerName(character) {
  return presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  }).name;
}

async function writePaperImpl({ tagId: rawTagId, text: rawText }) {
  const { character, where } = await requireWriter();

  if (readBlock(character.tags, where)) {
    // The same sentence a paper shows a reader who can't read it. Saying
    // WHICH of letters or eyes stopped them would leak a condition.
    throw new UserError("You can't read this. ‡");
  }

  const text = String(rawText ?? "").trim().slice(0, WRITE_MAX);
  if (!text) throw new UserError("Write something first. ‡");

  const targetId = String(rawTagId ?? "");
  const held = character.tags.find((ct) => ct.tagId === targetId);
  if (!held) throw new UserError("You aren't holding that. ‡");

  const hand = writerName(character);

  let result;
  await prisma.$transaction(async (tx) => {
    // A blank sheet becomes a written one: a unit off the stack, a new row.
    if (held.tag.slug === PAPER_SLUG) {
      result = await writeNewPaper(tx, { id: character.id, name: hand }, held.tagId, text);
      return;
    }
    // Writing more on a sheet that already has words on it. APPEND-ONLY —
    // nothing anywhere in the game shortens paperText.
    if (held.tag.paperKind === "PAPER") {
      result = await appendToPaper(tx, held.tagId, held.tag.paperText, text);
      return;
    }
    if (held.tag.paperKind === "SEALED") {
      throw new UserError("It's sealed. Break the seal first. ‡");
    }
    // The one rule a book has that a sheet does not. What is bound in is what
    // it says; there is no page left to add.
    if (isBook(held.tag)) {
      throw new UserError("It's bound. You'd have to tear it up and start again. ‡");
    }
    throw new UserError("You can't write on that. ‡");
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: result.name, tagId: result.id };
}

// Binding. Ten blank sheets go in, one book comes out, and the text is fixed
// at that moment — see bindBook in db/lib/paperMint.js for why.
//
// Files no Request, for the same reason writing files none: it costs no Move
// and there is nothing to adjudicate. It DOES need literacy, unlike sealing —
// you are writing the whole thing in one pass.
async function bindBookImpl({ title: rawTitle, text: rawText }) {
  const { character, where } = await requireWriter();

  if (readBlock(character.tags, where)) {
    throw new UserError("You can't read this. ‡");
  }

  const title = String(rawTitle ?? "").trim().slice(0, TITLE_MAX);
  if (!title) throw new UserError("Give it a title first. ‡");

  const text = String(rawText ?? "").trim().slice(0, BOOK_MAX);
  if (!text) throw new UserError("Write something first. ‡");

  const blank = character.tags.find((ct) => ct.tag.slug === PAPER_SLUG);
  if (!blank || (blank.quantity ?? 0) < BOOK_SHEETS) {
    throw new UserError(`You need ${BOOK_SHEETS} sheets of blank paper to bind a book. ‡`);
  }

  const hand = writerName(character);

  let book;
  await prisma.$transaction(async (tx) => {
    book = await bindBook(tx, { id: character.id, name: hand }, blank.tagId, title, text);
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: book.name, tagId: book.id };
}

// The other direction. Needs no literacy at all — tearing a book apart is not
// reading it, and an illiterate thief pulping the Library is a thing the game
// should let happen.
async function tearUpBookImpl({ tagId: rawTagId }) {
  const { character } = await requireWriter();

  const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  if (!held) throw new UserError("You aren't holding that. ‡");
  if (!isBook(held.tag)) throw new UserError("That isn't a book. ‡");

  // Looked up rather than read off the character: somebody tearing up their
  // only book may well be holding no blank paper at all.
  const blank = await prisma.tag.findUnique({ where: { slug: PAPER_SLUG }, select: { id: true } });
  if (!blank) throw new UserError("There's no paper in the catalog to tear it into. ‡");

  await prisma.$transaction(async (tx) => {
    await tearUpBook(tx, character.id, held.tag, blank.id);
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: held.tag.name, sheets: BOOK_SHEETS };
}

async function sealLetterImpl({ tagId: rawTagId, stampTagId: rawStampId }) {
  const { character } = await requireWriter();

  const paperRow = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  const stampRow = character.tags.find((ct) => ct.tagId === String(rawStampId ?? ""));

  if (!paperRow || !stampRow) throw new UserError("You aren't holding that. ‡");
  if (!isSeal(stampRow.tag)) throw new UserError("That isn't a wax stamp. ‡");
  if (!isPaper(paperRow.tag) || paperRow.tag.paperKind !== "PAPER") {
    throw new UserError("That isn't a letter you can seal. ‡");
  }
  // A blank sheet folded shut is a joke, not a letter, and it would put an
  // unreadable "Blank paper" behind a seal somebody has to break to find out.
  if (!(paperRow.tag.paperText ?? "").trim()) throw new UserError("There's nothing written on it. ‡");

  // Sealing does not need literacy — pressing wax into a fold is not reading —
  // but it does need the paper, and holding it is the check.
  let sealed;
  await prisma.$transaction(async (tx) => {
    sealed = await sealPaper(tx, paperRow.tag, stampRow.tag);
  });

  await afterInventoryChange([character.id]);
  revalidateAll();
  return { name: sealed.name };
}

// --- public surface ---------------------------------------------------

export async function writePaper(input) {
  return guarded(() => writePaperImpl(input));
}

export async function sealLetter(input) {
  return guarded(() => sealLetterImpl(input));
}

export async function bindABook(input) {
  return guarded(() => bindBookImpl(input));
}

export async function tearUpABook(input) {
  return guarded(() => tearUpBookImpl(input));
}

// What the Write dialog needs that the sheet does not already hold: the text
// of a paper the caller can read, so the box can show it above the cursor.
// Composed through paperDescription so a reader who has since gone blind, or
// left their spectacles somewhere, gets the same refusal here as everywhere.
export async function readMyPaper(rawTagId) {
  const { character, where } = await requireWriter();
  const held = character.tags.find((ct) => ct.tagId === String(rawTagId ?? ""));
  if (!held || !isPaper(held.tag)) return { ok: false, error: "You aren't holding that. ‡" };
  return {
    ok: true,
    text: paperDescription(held.tag, { tags: character.tags, ...where }),
    kind: held.tag.paperKind,
  };
}
