// A character's displayed name is built from four parts rather than one
// string: an honorific the player picks freely, a required first name, a
// GM-granted title that renders in quotes, and an optional last name.
//
//   Sir Jorren "the Blind" Vask
//
// Pure — no prisma, no I/O — so both faces of the game can require it, and so
// a client component can import it through web/lib/characterName.js without
// dragging PrismaClient into the browser bundle. Same posture as
// db/lib/roleColor.js and db/lib/mood.js, and spread into the @lifeweb/db
// barrel alongside them.

// The dropdown, in ladder order within each register. Deliberately short:
// every entry has to read as something a Ravenheart character would actually
// be called. Ungated — anyone may pick any of them, and a GM corrects an
// abuse on the raw edit panel rather than the picker refusing it.
const HONORIFICS = Object.freeze([
  // Courtesy
  "Mr.",
  "Mrs.",
  "Ms.",
  "Master",
  // Noble
  "Sir",
  "Dame",
  "Lord",
  "Lady",
  "Baron",
  "Baroness",
  // Clerical
  "Father",
  "Mother",
  "Brother",
  "Sister",
  "Bishop",
  // Martial — Constable sits at the bottom of the ladder, which is where a
  // parish-level sworn officer belongs (Constable -> Sergeant -> Marshal).
  "Captain",
  "Sergeant",
  "Marshal",
  "Constable",
  // Scholarly
  "Doctor",
  "Professor",
]);

// Discord caps a webhook username at 80 characters, and bot/src/lib/proxy.js
// sends `Character.name` as-is. Slicing there would silently break
// db/lib/dawnWipe.js, which keys its charactersByName map on the same column
// and looks it up by the webhook username — so cap the *inputs* instead and
// let the composed name be short by construction:
//
//   10 + 1 + 24 + 1 + (20 + 2 quotes) + 1 + 20 = 79
//
// Enforced by all three writers of `name`. Nothing downstream ever slices.
const NAME_LIMITS = Object.freeze({
  honorific: 10,
  firstName: 24,
  title: 20,
  lastName: 20,
});

// The full display name. This is what gets mirrored onto Character.name, so
// it is what players, tables, webhook usernames and audit snapshots all see.
function formatCharacterName({ honorific, firstName, title, lastName } = {}) {
  const quoted = title && title.trim() ? `"${title.trim()}"` : null;
  return [honorific, firstName, quoted, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

// First + last only. This is the Discord-facing form: it seeds the personal
// role's colour and name, and it is the character half of a nickname. Keeping
// those bare means a title never recolours or renames a role, and never eats
// into the 32-char nickname budget.
function formatBareName({ firstName, lastName } = {}) {
  return [firstName, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

// Splits a legacy single-string name on the FIRST space, remainder to the
// last name: "Anna Maria de Vries" -> { Anna, Maria de Vries }. Mirrors the
// SQL in the character_name_parts migration; kept here so the backfill can
// repair a database restored from an older dump.
function splitLegacyName(name) {
  const trimmed = (name ?? "").trim();
  const at = trimmed.indexOf(" ");
  if (at === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, at),
    lastName: trimmed.slice(at + 1).trim() || null,
  };
}

// Server-side allowlist. Every form that sets an honorific is a public
// endpoint, so the picker is advisory and this is the actual gate.
function normalizeHonorific(value) {
  const v = (value ?? "").toString().trim();
  return HONORIFICS.includes(v) ? v : null;
}

// A character is an adult, and nobody in Ravenheart is spry at 91. Enforced
// server-side in both writers; the number is fixed once first saved.
const AGE_MIN = 18;
const AGE_MAX = 90;

module.exports = {
  HONORIFICS,
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  formatCharacterName,
  formatBareName,
  splitLegacyName,
  normalizeHonorific,
};
