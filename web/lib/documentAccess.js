// Who may read which document, in one place.
//
// This used to live inside web/app/(app)/documents/page.js, which was fine
// while the page was the only thing that needed it. getDocumentIndex (lib/referenceData.js) needs the
// identical answer — it decides whether a {document:key} chip renders as a
// working link or an inert one — and two copies of a visibility rule that
// drift means telling a player they can open a Gamemaster brief. So the rule
// moved here and the page imports it.
//
// No Prisma import on purpose: these take rows and return strings, so the
// route handler and the server component can both use them.

// Turns the Prisma character row into the shape the rules below expect.
// Both callers must build it the same way or the tag checks silently miss.
export function readerFromCharacter(characterRow) {
  if (!characterRow) return null;
  return {
    ...characterRow,
    tagSlugs: new Set(characterRow.tags.map((ct) => ct.tag.slug)),
    tagNameBySlug: new Map(characterRow.tags.map((ct) => [ct.tag.slug, ct.tag.name])),
  };
}

// Which of a character's traits a document can key off. Returns the human
// label for WHY it applies — the string the card's source line shows — or
// null. First hit wins, so the order here is the precedence a player sees.
export function assignedTo(document, character) {
  if (!character) return null;
  if (character.role?.docElements?.includes(document.key)) return character.role.name;
  const tagHit = document.tagSlugs.find((slug) => character.tagSlugs.has(slug));
  if (tagHit) return character.tagNameBySlug.get(tagHit) ?? tagHit;
  if (document.roleSlugs.includes(character.role?.slug)) return character.role.name;
  if (document.factionSlugs.includes(character.faction?.slug)) return character.faction.name;
  if (document.flags.includes("leader") && character.isLeader) return "Leader";
  if (document.flags.includes("treasurer") && character.isTreasurer) return "Treasurer";
  return null;
}

// The whole question — every route into a document, not just assignment.
// Public first, because a public document is public to a GM and to a
// character alike and there is no point asking anything else.
//
// The gamemaster flag is the odd one: unlike every other rule it keys off a
// Discord role rather than anything on a Character, since a GM usually has no
// character at all.
export function documentSource(document, { character, isGm, isMasterGm }) {
  if (document.isPublic) return "Public";
  const assigned = assignedTo(document, character);
  if (assigned) return assigned;
  if (isGm && document.flags.includes("gamemaster")) return "Gamemaster";
  if (isMasterGm && document.isSecret) return "Secret";
  return null;
}

// A document with no prose yet is a slot waiting to be written (see the stubs
// in docs/documents.yaml) — never show a player an empty page.
export function isWritten(document) {
  return document.description.trim().length > 0;
}
