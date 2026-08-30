"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { UserError, guarded } from "@/lib/actionResult";
import {
  JOURNAL_TITLE_MAX_LENGTH,
  JOURNAL_BODY_MAX_LENGTH,
  JOURNAL_LABEL_MAX_LENGTH,
  JOURNAL_MAX_LABELS,
} from "@/lib/constants";

// CRUD for a player's private Journal (/notes' Journal tab). Every verb below
// re-resolves discordUserId from the session and scopes its write by it —
// never trusts an id posted from the client — because a server action is a
// public endpoint (the same discipline notes/actions.js#unstarNote already
// documents for Note).

async function requireSession() {
  const session = await auth();
  if (!session?.discordUserId) throw new UserError("You need to be signed in.");
  return session;
}

// Trims, drops blanks, de-dupes case-insensitively (keeping the first
// casing seen), and caps both the count and each label's length — a server
// action re-validates everything the client sent, never trusts a length
// already enforced by an input's maxLength.
function cleanLabels(labels) {
  if (!Array.isArray(labels)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of labels) {
    const label = String(raw ?? "").trim().slice(0, JOURNAL_LABEL_MAX_LENGTH);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= JOURNAL_MAX_LABELS) break;
  }
  return out;
}

function cleanFields({ title, body, labels, pinned, turnNumber }) {
  const cleanTitle = String(title ?? "").trim().slice(0, JOURNAL_TITLE_MAX_LENGTH);
  const cleanBody = String(body ?? "").trim().slice(0, JOURNAL_BODY_MAX_LENGTH);
  if (!cleanTitle) throw new UserError("Give the entry a title.");
  if (!cleanBody) throw new UserError("An entry needs some text.");
  return {
    title: cleanTitle,
    body: cleanBody,
    labels: cleanLabels(labels),
    pinned: Boolean(pinned),
    turnNumber: Number.isInteger(turnNumber) ? turnNumber : null,
  };
}

async function createEntryImpl(input) {
  const session = await requireSession();
  const fields = cleanFields(input);
  await prisma.journalEntry.create({ data: { discordUserId: session.discordUserId, ...fields } });
  revalidatePath("/notes");
}
export async function createEntry(input) {
  return guarded(() => createEntryImpl(input));
}

async function updateEntryImpl(id, input) {
  const session = await requireSession();
  const fields = cleanFields(input);
  // `?? ""` is not cosmetic: Prisma strips an `undefined` field from a where
  // clause entirely, so an omitted id would turn this into "update every
  // entry this user has" — same trap notes/actions.js#unstarNote guards
  // against for Note.
  const { count } = await prisma.journalEntry.updateMany({
    where: { id: id ?? "", discordUserId: session.discordUserId },
    data: fields,
  });
  if (count === 0) throw new UserError("That entry is gone.");
  revalidatePath("/notes");
}
export async function updateEntry(id, input) {
  return guarded(() => updateEntryImpl(id, input));
}

async function deleteEntryImpl(id) {
  const session = await requireSession();
  await prisma.journalEntry.deleteMany({ where: { id: id ?? "", discordUserId: session.discordUserId } });
  revalidatePath("/notes");
}
export async function deleteEntry(id) {
  return guarded(() => deleteEntryImpl(id));
}

async function togglePinImpl(id, pinned) {
  const session = await requireSession();
  const { count } = await prisma.journalEntry.updateMany({
    where: { id: id ?? "", discordUserId: session.discordUserId },
    data: { pinned: Boolean(pinned) },
  });
  if (count === 0) throw new UserError("That entry is gone.");
  revalidatePath("/notes");
}
export async function togglePin(id, pinned) {
  return guarded(() => togglePinImpl(id, pinned));
}
