// The Merchant's wax stamp bears his own initials.
//
// Every other stamp in the game has its mark cut into it in docs/tags.yaml.
// His cannot: the initials are whoever took the seat this game, and the tag
// row exists before any Merchant does. So it is written once, at character
// creation, in the same breath as the line that teaches the Depot turret his
// face (web/app/(app)/character/createActions.js) — and db/lib/syncTags.js
// deliberately leaves both this field and the composed description alone for a
// stamp that names an office but carries no authored mark, so the next
// db:sync-tags cannot rub it back off.
//
// Set once and never re-synced, the same posture as the turret's face. A
// Merchant who dies and is replaced leaves his stamp behind with his initials
// still on it, which is correct: it is a physical object, and prying it off
// his body is exactly the kind of thing the game is for.
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays off the @lifeweb/db barrel.

const MERCHANT_STAMP_SLUG = "merchants-wax-stamp";

// "Aurel Vane" -> "A.V." · "Gribb" -> "G."
//
// Splits on whitespace rather than reading firstName/lastName, so a name with
// a particle or three parts still produces something rather than dropping the
// middle of it on the floor.
function initialsOf(name) {
  const parts = String(name ?? "")
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((part) => `${part[0].toUpperCase()}.`).join("");
}

// The line pressed into the wax, and the sentence it sits in. Single-name
// Merchants get "initial" rather than "initials" — a plural over one letter is
// the kind of small wrongness that makes a whole system read as unfinished.
function merchantSealMark(name) {
  const initials = initialsOf(name);
  if (!initials) return null;
  const word = initials.split(".").filter(Boolean).length > 1 ? "initials" : "initial";
  return `Bears his ${word}, ${initials} — oddly modern and minimalist.`;
}

// Write it onto the stamp. Best-effort by contract: the caller wraps this in a
// .catch(), because a missing stamp row must never cost somebody their
// character creation.
async function setMerchantSeal(tx, name) {
  const mark = merchantSealMark(name);
  if (!mark) return null;
  return tx.tag.update({
    where: { slug: MERCHANT_STAMP_SLUG },
    data: {
      sealMark: mark,
      description: `The Merchant's wax stamp. ${mark} ‡`,
    },
  });
}

module.exports = { MERCHANT_STAMP_SLUG, initialsOf, merchantSealMark, setMerchantSeal };
