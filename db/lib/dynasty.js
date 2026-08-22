// The four Court seats — Baron, Baroness, Heir, Successor — are one family,
// and docs/roles.yaml has always said so in prose ("Choose a last name—a
// Dynasty name") without anything enforcing it, so the noble house could end
// up with four different surnames.
//
// The rule: the Baron chooses the dynasty name, and the other three inherit
// it. Their last name is not theirs to type at all — it is copied from
// whoever holds the `baron` role, and updated the moment he is created or
// renames himself. Before a Baron exists they simply have no last name.
//
// Expressed by role slug rather than by a schema column, exactly like
// CURSED_ROLE_SLUGS in web/lib/characterCreation.js: it is a rule about three
// named seats in one faction, not a general kinship model, and a column would
// need a migration plus a writer for a relation that can never differ.
//
// Pure — no prisma, no I/O — so it can sit in the @lifeweb/db barrel beside
// characterName.js and roleColor.js. The prisma/Discord half lives in
// web/lib/dynasty.js, since the three writers of Character.name are all web
// server actions.

// All four seats are `multiple: false` in docs/roles.yaml, so "the Baron"
// really is one living character and a findFirst on this slug is exact.
const DYNASTY_HEAD_SLUG = "baron";

const DYNASTY_MEMBER_SLUGS = Object.freeze(["baroness", "heir", "successor"]);

// Whose last name propagates.
function isDynastyHead(slug) {
  return slug === DYNASTY_HEAD_SLUG;
}

// Whose last name is locked. A disabled input is only the hint; the lock is
// that none of the three writers of Character.name ever reads the posted
// lastName for one of these — same posture as the GM-granted `title`.
function isDynastyMember(slug) {
  return DYNASTY_MEMBER_SLUGS.includes(slug);
}

module.exports = {
  DYNASTY_HEAD_SLUG,
  DYNASTY_MEMBER_SLUGS,
  isDynastyHead,
  isDynastyMember,
};
