// Which title a character has earned the right to wear, and which form of it
// they wear. Every word is granted by a tag the character holds or the role
// they took, and `Character.gender` picks the form of a gendered title
// (Lord/Lady/Noble for Nobility). An entry is one TITLE, not one word —
// `words` is a plain string or a map keyed by gender. Hardcoded rather than a
// YAML master, for the same reason as db/lib/roleIds.js: single guild, one
// correct value. Pure — no prisma, no I/O — so a client component can import
// it through web/lib/characterName.js without dragging PrismaClient in.

// Matches the Gender enum in db/prisma/schema.prisma exactly. One vocabulary
// across the schema, the server actions and the pickers, so nothing has to map
// between casings.
const GENDERS = Object.freeze(["MAN", "WOMAN", "NEUTRAL"]);

const TITLES = Object.freeze([
  // Martial
  { words: "Sergeant", tags: ["sergeant"] },
  { words: "Constable", tags: ["watchman"] },
  { words: "Captain", roles: ["captain"] },

  // Noble. The baron/baroness roles also grant the `nobility` tag, so whoever
  // holds one of those seats is offered Lord/Lady/Noble as well — deliberate,
  // a Baron may prefer to be styled Lord.
  //
  // Both seats share one entry: those roles lock their holder's gender
  // (Role.lockedGender), so the word is settled either way, and going through
  // gender means someone seated as `baron` who is a woman is styled Baroness
  // rather than Baron.
  { words: { MAN: "Sir", WOMAN: "Dame", NEUTRAL: "Ser" }, tags: ["knighted"] },
  { words: { MAN: "Lord", WOMAN: "Lady", NEUTRAL: "Noble" }, tags: ["nobility"] },
  { words: { MAN: "Baron", WOMAN: "Baroness", NEUTRAL: "Baron" }, roles: ["baron", "baroness"] },

  // Clerical. The `bishop` role grants the `chaplain` tag, so a Bishop is
  // offered Father/Mother/Reverend too.
  { words: { MAN: "Father", WOMAN: "Mother", NEUTRAL: "Reverend" }, tags: ["chaplain"] },
  { words: { MAN: "Brother", WOMAN: "Sister", NEUTRAL: "Sibling" }, tags: ["mortus"] },
  { words: "Bishop", roles: ["bishop"] },

  // Learned. Doctor comes from the middle rung of the medical chain rather
  // than the top, so it is a practising physician's title and not a mastery
  // award — and the Serpent carries it by role regardless of what they buy.
  { words: "Doctor", tags: ["medical-skilled"], roles: ["esculap", "serpent"] },
  { words: "Professor", roles: ["scholastic"] },

  // Trade. Master is the craft-master's word, ungendered — mastery of a
  // trade says nothing about who holds it.
  { words: "Master", roles: ["metalsmith", "innkeeper", "headman"] },
]);

// The word this entry gives a character of this gender. A flat `words` reads
// the same for everyone; an unknown gender falls back to the neutral form
// rather than throwing, so a bad value degrades to the word that claims least.
function wordFor(entry, gender) {
  if (typeof entry.words === "string") return entry.words;
  return entry.words[gender] ?? entry.words.NEUTRAL;
}

// Every word any character could wear, in table order. The GM dev panel offers
// this whole list ungated: a GM putting a title on someone is the one path
// that should never be second-guessed, and it is the only way to clear a title
// the player can no longer re-select.
const TITLE_WORDS = Object.freeze(
  TITLES.flatMap((t) => (typeof t.words === "string" ? [t.words] : GENDERS.map((g) => t.words[g]))).filter(
    (word, i, all) => all.indexOf(word) === i,
  ),
);

// The words this character may wear. `tagSlugs` is everything they hold —
// bought, granted by their role, or handed over by a GM — `roleSlug` is their
// role, and `gender` picks the form. A character with neither tag nor role
// match earns nothing, which is the common case: most of Ravenheart is
// untitled.
//
// One word per earned title, never three: the gendered variants are not a
// choice the player makes.
//
// Order follows the table, so a picker rendering this gets the registers in
// ladder order rather than alphabetically.
function earnedTitles({ tagSlugs = [], roleSlug = null, gender = "NEUTRAL" } = {}) {
  const held = new Set(tagSlugs);
  return TITLES.filter(
    (t) =>
      (t.tags ?? []).some((slug) => held.has(slug)) ||
      (roleSlug != null && (t.roles ?? []).includes(roleSlug)),
  ).map((t) => wordFor(t, gender));
}

// Fails the sync if a title references a tag or role that isn't in the
// catalog, or if a gendered entry is missing a form.
//
// Called from syncRoles, which runs after syncTags (SYNC.md), so both catalogs
// exist by then. A bad slug here is silent otherwise: the title simply becomes
// unearnable, and nobody finds out until a player asks why they can't be
// styled Doctor.
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
    const label = typeof entry.words === "string" ? entry.words : (entry.words.MAN ?? "?");

    if (typeof entry.words === "string") {
      if (seen.has(entry.words)) problems.push(`"${entry.words}" is listed twice`);
      seen.add(entry.words);
    } else {
      for (const gender of GENDERS) {
        const word = entry.words[gender];
        if (!word) {
          problems.push(`"${label}" has no ${gender} form`);
          continue;
        }
        // A shared word across two forms is fine and deliberate (Baron covers
        // MAN and NEUTRAL), so only flag a repeat across DIFFERENT entries.
        if (seen.has(word) && !GENDERS.some((g) => g !== gender && entry.words[g] === word)) {
          problems.push(`"${word}" is listed twice`);
        }
        seen.add(word);
      }
    }

    if (!(entry.tags ?? []).length && !(entry.roles ?? []).length) {
      problems.push(`"${label}" is earned from nothing — give it a tag or a role`);
    }
    for (const slug of entry.tags ?? []) {
      if (!tagSlugs.has(slug)) problems.push(`"${label}" references unknown tag "${slug}"`);
    }
    for (const slug of entry.roles ?? []) {
      if (!roleSlugs.has(slug)) problems.push(`"${label}" references unknown role "${slug}"`);
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
  assertTitlesResolve,
};
