// Which title a character has earned the right to wear, and what that word
// says about them.
//
// A title used to be a free pick from a flat list, so anyone could call
// themselves Baron. Now every word is granted by a tag the character holds or
// the role they took — nobody is a Bishop who was not made one.
//
// This table is the single source of truth for BOTH questions the codebase
// asks about a title:
//
//   who may wear it   -> earnedTitles(), gating the three pickers and the two
//                        player-facing server writers
//   what it reads as  -> genderOf(), which db/lib/concealedIdentity.js uses to
//                        describe a concealed character and which the wizard's
//                        Randomize button uses to pick a name pool
//
// Those two lived apart before — the word list here, the MAN/WOMAN arrays in
// concealedIdentity.js — and had to be edited in lockstep or a new title
// silently read as "Person". One table, one edit.
//
// Hardcoded rather than a YAML master, for the same reason as
// db/lib/roleIds.js: single guild, one correct value, and it can never differ
// per environment. The slugs are validated against the synced catalogs by
// assertTitlesResolve() below, so a typo fails the sync instead of quietly
// making a title unearnable.
//
// Pure — no prisma, no I/O — so a client component can import it through
// web/lib/characterName.js without dragging PrismaClient into the browser.

// `gender` is what the WORD says about its wearer, not a property of the
// character. Rank and profession say nothing, so they are "neutral" and a
// concealed Captain is "a person" — same as having no title at all. Every
// gendered set carries a neutral third so nobody is forced to pick a side to
// be styled at all.
const TITLES = Object.freeze([
  // Martial
  { word: "Sergeant", gender: "neutral", tags: ["sergeant"] },
  { word: "Constable", gender: "neutral", tags: ["watchman"] },
  { word: "Captain", gender: "neutral", roles: ["captain"] },

  // Noble. The `baron`/`baroness` roles also grant the `nobility` tag, so
  // those two are offered Lord/Lady/Noble as well — deliberate, a Baron may
  // prefer to be styled Lord.
  { word: "Sir", gender: "man", tags: ["knighted"] },
  { word: "Dame", gender: "woman", tags: ["knighted"] },
  { word: "Ser", gender: "neutral", tags: ["knighted"] },
  { word: "Lord", gender: "man", tags: ["nobility"] },
  { word: "Lady", gender: "woman", tags: ["nobility"] },
  { word: "Noble", gender: "neutral", tags: ["nobility"] },
  { word: "Baron", gender: "man", roles: ["baron"] },
  { word: "Baroness", gender: "woman", roles: ["baroness"] },

  // Clerical. The `bishop` role grants the `chaplain` tag, so a Bishop is
  // offered Father/Mother/Reverend too.
  { word: "Father", gender: "man", tags: ["chaplain"] },
  { word: "Mother", gender: "woman", tags: ["chaplain"] },
  { word: "Reverend", gender: "neutral", tags: ["chaplain"] },
  { word: "Brother", gender: "man", tags: ["mortus"] },
  { word: "Sister", gender: "woman", tags: ["mortus"] },
  { word: "Sibling", gender: "neutral", tags: ["mortus"] },
  { word: "Bishop", gender: "neutral", roles: ["bishop"] },

  // Learned. Doctor comes from the middle rung of the medical chain rather
  // than the top, so it is a practising physician's title and not a mastery
  // award — and the Serpent carries it by role regardless of what they buy.
  { word: "Doctor", gender: "neutral", tags: ["medical-skilled"], roles: ["esculap", "serpent"] },
  { word: "Professor", gender: "neutral", roles: ["scholastic"] },

  // Trade. Master is the craft-master's word — it was a courtesy title
  // (alongside the retired Mr./Mrs./Ms.) and reads neutral now, because
  // mastery of a trade says nothing about who holds it.
  { word: "Master", gender: "neutral", roles: ["metalsmith", "innkeeper", "headman"] },
]);

const GENDERS = Object.freeze(["man", "woman", "neutral"]);

// Every word, ungated. The GM dev panel offers this whole list: a GM putting a
// title on someone is the one path that should never be second-guessed, and it
// is the only way to clear a title the player can no longer re-select.
const TITLE_WORDS = Object.freeze(TITLES.map((t) => t.word));

const BY_WORD = new Map(TITLES.map((t) => [t.word, t]));

// The words this character may wear. `tagSlugs` is everything they hold —
// bought, granted by their role, or handed over by a GM — and `roleSlug` is
// their role. A character with neither earns nothing, which is the common
// case: most of Ravenheart is untitled.
//
// Order follows the table, so a picker rendering this gets the registers in
// ladder order rather than alphabetically.
function earnedTitles({ tagSlugs = [], roleSlug = null } = {}) {
  const held = new Set(tagSlugs);
  return TITLES.filter(
    (t) =>
      (t.tags ?? []).some((slug) => held.has(slug)) ||
      (roleSlug != null && (t.roles ?? []).includes(roleSlug)),
  ).map((t) => t.word);
}

// What the word says about its wearer. An unknown or absent title is
// "neutral" — the honest answer, and what keeps a character who was never
// styled from being described as a man.
function genderOf(word) {
  return BY_WORD.get((word ?? "").toString().trim())?.gender ?? "neutral";
}

// Fails the sync if a title references a tag or role that isn't in the
// catalog. This replaces assertHonorificsCovered(), whose condition was
// unsatisfiable — `!MAN.includes(h) && !WOMAN.includes(h) && genderWord(h) !==
// "Person"` can never be true, since genderWord returned "Person" exactly when
// the first two held, so the guard never fired once.
//
// Called from syncRoles, which runs after syncTags (SYNC.md), so both
// catalogs exist by then. A bad slug here is silent otherwise: the title
// simply becomes unearnable, and nobody notices until a player asks why they
// can't be styled Doctor.
async function assertTitlesResolve(prisma) {
  const [tags, roles] = await Promise.all([
    prisma.tag.findMany({ select: { slug: true } }),
    prisma.role.findMany({ select: { slug: true } }),
  ]);
  const tagSlugs = new Set(tags.map((t) => t.slug).filter(Boolean));
  const roleSlugs = new Set(roles.map((r) => r.slug).filter(Boolean));

  const problems = [];
  const seen = new Set();
  for (const entry of TITLES) {
    if (seen.has(entry.word)) problems.push(`"${entry.word}" is listed twice`);
    seen.add(entry.word);
    if (!GENDERS.includes(entry.gender)) {
      problems.push(`"${entry.word}" has gender "${entry.gender}" (expected ${GENDERS.join(" / ")})`);
    }
    if (!(entry.tags ?? []).length && !(entry.roles ?? []).length) {
      problems.push(`"${entry.word}" is earned from nothing — give it a tag or a role`);
    }
    for (const slug of entry.tags ?? []) {
      if (!tagSlugs.has(slug)) problems.push(`"${entry.word}" references unknown tag "${slug}"`);
    }
    for (const slug of entry.roles ?? []) {
      if (!roleSlugs.has(slug)) problems.push(`"${entry.word}" references unknown role "${slug}"`);
    }
  }

  if (problems.length) {
    throw new Error(`db/lib/titles.js: ${problems.join("; ")}`);
  }
}

module.exports = {
  TITLES,
  TITLE_WORDS,
  GENDERS,
  earnedTitles,
  genderOf,
  assertTitlesResolve,
};
