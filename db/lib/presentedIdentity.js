// Which name and face the room sees when a character speaks. Three cases, in
// order of precedence:
//
//   forced    — a held tag carries Tag.forcedName (Apex Form -> "Beast"). The
//               character posts under that name with the letter plaque for its
//               initial, never their own face, and cannot conceal.
//   concealed — Character.concealed is on: the vague alias from
//               concealedIdentity.js and the shared unknown silhouette.
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
// presentedIdentity / forcedNameFrom / letterPlaqueFile are pure; loadForcedName
// is the one query, for call sites that already hold a Character without its
// tags. Spread into the @lifeweb/db barrel beside concealedIdentity.js.
const { concealedAlias } = require("./concealedIdentity");

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
function presentedIdentity(character, { forcedName = null } = {}) {
  if (forcedName) {
    return {
      name: forcedName,
      avatarPath: `/assets/letters/${letterPlaqueFile(forcedName)}`,
      alias: forcedName,
      concealed: false,
      forced: true,
    };
  }
  if (character.concealed) {
    const alias = concealedAlias(character);
    return {
      name: alias,
      // Identical for everyone on purpose — a per-character concealed avatar
      // would be a fingerprint.
      avatarPath: "/assets/unknown.png",
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

module.exports = { forcedNameFrom, loadForcedName, letterPlaqueFile, presentedIdentity };
