// Which name and face the room sees when a character speaks. Three cases, in
// order of precedence:
//
//   forced    — a held tag carries Tag.forcedName (Apex Form -> "Beast"). The
//               character posts under that name with the letter plaque for its
//               initial, never their own face, and cannot conceal.
//   concealed — something concealing is EQUIPPED and either forces it or the
//               character chose it: the vague alias from concealedIdentity.js
//               and that item's own plated sprite.
//   own       — Character.name and /api/avatar/<id>.
//
// Resolved at READ time from the live row plus the held tags, the same posture
// as the letter plaque and the Catatonic role suffix: nothing on the Character
// row is rewritten when the tag lands, so two Beasts never collide on
// Character.name and a GM table still shows who it is.
//
// `alias` is "the name the room saw when it was not the real one" — set for
// both the concealed and the forced case, and what recordArchiveMessage
// freezes into ArchiveEntry.concealedAlias so /archive renders
// `Beast (Jorren Vask)` the way it renders a hood. `concealed` stays true only
// for a real hood: the impoverished 🔍 embed and the no-relay rule in
// messageCreate.js are about hiding, and a Beast is not hiding.
//
// Concealment is DERIVED, not just stored. Character.concealed is only the
// player's wish; it takes effect solely while a Tag.concealsIdentity item is
// equipped, and a Tag.forcesConceal item overrides the column entirely. So a
// row left concealed after the mask came off resolves back to the real face on
// its own, and no backfill or catch-up pass is needed for either direction.
//
// presentedIdentity / forcedNameFrom / concealmentFrom / letterPlaqueFile are
// pure; loadForcedName and loadConcealment are the two queries, for call sites
// that already hold a Character without its tags. Spread into the @lifeweb/db
// barrel beside concealedIdentity.js.
const { concealedAlias } = require("./concealedIdentity");

// The shape concealmentFrom returns, for the legacy fallback above: concealed
// with no idea what by. web/public/assets/unknown.png survives for exactly
// this and for already-archived entries (ArchiveFeed.js).
const UNSLOTTED = { sprite: null, forced: false };

// The Tag columns concealmentFrom reads. Exported so the eight call sites that
// resolve an identity select the same set — miss one and concealment silently
// stops working at that surface only, which is the worst way for this to fail.
// Pair it with `equipped: true` on the CharacterTag itself.
const CONCEALMENT_TAG_FIELDS = {
  name: true,
  concealsIdentity: true,
  concealSprite: true,
  forcesConceal: true,
  equipLayer: true,
};

// The forced name off a character's tags — CharacterTag[] (with .tag) or bare
// Tag[]. First one wins; the catalog is not expected to stack two.
function forcedNameFrom(tags) {
  if (!Array.isArray(tags)) return null;
  for (const entry of tags) {
    const tag = entry?.tag ?? entry;
    const name = tag?.forcedName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return null;
}

async function loadForcedName(prisma, characterId) {
  const held = await prisma.characterTag.findFirst({
    where: { characterId, tag: { forcedName: { not: null } } },
    select: { tag: { select: { forcedName: true } } },
  });
  return forcedNameFrom(held ? [held] : []);
}

// What is over this character's face, from CharacterTag[] (with .tag). Returns
// the OUTERMOST equipped concealing piece — highest Tag.equipLayer — because
// that is the one an onlooker actually sees: a coif under a knight's helm is a
// coif nobody can see. `forced` is true when ANY equipped piece forces it, not
// just the outermost, so a sack over a helmet still cannot be talked off.
//
// `name` rides along for one reason: /conceal has to refuse a forced piece, and
// "not while you are wearing that" is a much worse sentence than one that says
// which thing. It is the outermost piece's name, so it matches the sprite.
//
// Returns null when nothing conceals, which is what gates /conceal.
function concealmentFrom(tags) {
  if (!Array.isArray(tags)) return null;
  let best = null;
  let forced = false;
  for (const entry of tags) {
    // A bare Tag[] has no equipped flag; only a CharacterTag row can be worn,
    // and unworn gear conceals nobody.
    if (entry?.equipped !== true) continue;
    const tag = entry?.tag ?? entry;
    if (!tag?.concealsIdentity || !tag?.concealSprite) continue;
    if (tag.forcesConceal) forced = true;
    // A concealing tag with no slot sorts below every slotted one rather than
    // being dropped — it still conceals, it just loses a tie.
    const layer = Number.isInteger(tag.equipLayer) ? tag.equipLayer : 0;
    if (!best || layer > best.layer) best = { sprite: tag.concealSprite, layer, name: tag.name ?? null };
  }
  return best ? { sprite: best.sprite, name: best.name ?? null, forced } : null;
}

// The query form, for a caller holding a bare Character. Selects only what
// concealmentFrom reads.
async function loadConcealment(prisma, characterId) {
  const held = await prisma.characterTag.findMany({
    where: { characterId, equipped: true, tag: { concealsIdentity: true } },
    select: {
      equipped: true,
      tag: { select: { ...CONCEALMENT_TAG_FIELDS } },
    },
  });
  return concealmentFrom(held);
}

// Which tile under web/public/assets/letters/ a name gets: its first letter,
// upper-cased. Accented, non-Latin, numeric and empty initials all land on the
// blank plaque rather than 404ing or falling back to a wrong letter. Shared by
// the avatar route (own plaque) and the forced case below (forced plaque).
function letterPlaqueFile(name) {
  const initial = (name?.trim()?.[0] ?? "").toUpperCase();
  return /^[A-Z]$/.test(initial) ? `${initial}.webp` : "_default.webp";
}

// avatarPath is site-relative; the bot prefixes WEB_BASE_URL, the web app
// uses it as-is.
function presentedIdentity(character, { forcedName = null, concealment = undefined } = {}) {
  if (forcedName) {
    return {
      name: forcedName,
      avatarPath: `/assets/letters/${letterPlaqueFile(forcedName)}`,
      alias: forcedName,
      concealed: false,
      forced: true,
    };
  }
  // `concealment` undefined means the caller did not load tags and cannot say.
  // Fall back to the column alone: that errs toward hiding somebody who should
  // be visible, never toward exposing somebody who should not be, which is the
  // only safe direction for this to fail in.
  const piece = concealment === undefined ? (character.concealed ? UNSLOTTED : null) : concealment;
  if (piece && (piece.forced || character.concealed)) {
    const alias = concealedAlias(character);
    return {
      name: alias,
      // Everyone in the same mask looks the same on purpose — the sprite says
      // WHAT is over the face, never who is behind it, so a concealed avatar
      // is never a fingerprint.
      avatarPath: piece.sprite ? `/assets/helms/${piece.sprite}.webp` : "/assets/unknown.png",
      alias,
      concealed: true,
      forced: false,
    };
  }
  const version = character.updatedAt?.getTime?.() ?? "";
  return {
    name: character.name,
    avatarPath: `/api/avatar/${character.id}?v=${version}`,
    alias: null,
    concealed: false,
    forced: false,
  };
}

module.exports = {
  CONCEALMENT_TAG_FIELDS,
  forcedNameFrom,
  loadForcedName,
  concealmentFrom,
  loadConcealment,
  letterPlaqueFile,
  presentedIdentity,
};
