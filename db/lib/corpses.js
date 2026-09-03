// Corpses: what one is, who it belongs to, and what comes out of it.
// docs/systemdocs/CORPSES.md owns the design; this is the shared vocabulary.
//
// The idea in one line: a corpse is a HANDLE to a dead character's sheet, not
// a container. The goods stay on the Character row and LOOT_CHARACTER is
// untouched — but db/lib/corpseFollow.js walks the dead sheet after its corpse,
// so carrying a body somewhere makes it lootable there.
//
// Lives in db/ because both faces read it: the web's Butcher/Bury actions, the
// turn passes, and the Storage button's readout. Takes `prisma` as a parameter
// (the db/lib/dm.js convention) and stays off the @lifeweb/db barrel; require
// it by path.
//
// The three pure exports at the top have no prisma in them ON PURPOSE — the
// Butcher dialog is a client component and needs MONSTER_YIELDS to preview a
// yield, and importing anything prisma-shaped there drags the barrel into the
// browser bundle and kills the route with a node:fs error.
const { CORPSE_GROUP_SLUG, HUMAN_FLESH_SLUG } = require("./constants");
const { accessibleRooms } = require("./roomAccess");

// What each monster corpse cuts into. A corpse that isn't one of these three
// is a person's, and yields Human Flesh — keyed on "not a listed monster"
// rather than on the character link, so a corpse whose Character row has gone
// still butchers into something instead of throwing.
const MONSTER_YIELDS = {
  "nekker-corpse": "nekker-pheromones",
  "graga-corpse": "graga-sac",
  "skinless-corpse": "skinless-brain",
};

// The group IS the discriminator on the catalog side, and it has to be:
// Tag.corpseKind is set by the sync for YAML corpses and by the death path for
// written ones, but a client component only ever sees the group.
function isCorpseTag(tag) {
  return tag?.group?.slug === CORPSE_GROUP_SLUG;
}

function yieldSlugFor(tag) {
  return MONSTER_YIELDS[tag?.slug] ?? HUMAN_FLESH_SLUG;
}

// A person's corpse, rather than a Nekker's. The FK is the truth here — the
// name is prose and the rot rename rewrites it.
function isHumanCorpse(tag) {
  return Boolean(tag?.corpseOfCharacterId);
}

// The Tag select every caller here needs. Exported so the page, the two server
// actions and the room readout can't drift into asking for different columns —
// a missing `group` silently makes isCorpseTag() false everywhere.
const CORPSE_TAG_FIELDS = {
  id: true,
  slug: true,
  name: true,
  description: true,
  corpseKind: true,
  corpseOfCharacterId: true,
  stackable: true,
  group: { select: { slug: true } },
  // The body's own row, for the name a GM reads on the desk and the DM the
  // dead player gets. Null on a monster corpse.
  corpseOf: { select: { id: true, name: true, discordUserId: true } },
};

// Every corpse this character could act on: the ones in their own hands, and
// the ones lying in a Room at their Location they can actually get into.
//
// One function, called by the page to build the menu AND by both server
// actions to re-check it, so the dialog and the gate can never disagree —
// the same posture transferRequest takes (CARRY.md §6). Location-grain,
// because that is what a room stash is.
async function corpsesInReach(prisma, character, { rooms = null } = {}) {
  if (!character?.locationId) return [];

  const held = await prisma.characterTag.findMany({
    where: { characterId: character.id, tag: { group: { slug: CORPSE_GROUP_SLUG } } },
    select: { quantity: true, tag: { select: CORPSE_TAG_FIELDS } },
  });

  // The caller usually already has the filtered room list; re-derive it only
  // when it doesn't, so /character doesn't pay for a second round-trip.
  let reachable = rooms;
  if (!reachable) {
    const all = await prisma.room.findMany({
      where: { locationId: character.locationId },
      select: { id: true, name: true, kind: true, accessTagSlugs: true, discordThreadId: true },
    });
    const slugs = new Set(
      (
        await prisma.characterTag.findMany({
          where: { characterId: character.id },
          select: { tag: { select: { slug: true } } },
        })
      ).map((ct) => ct.tag.slug),
    );
    reachable = accessibleRooms(all, slugs);
  }

  const roomIds = reachable.map((r) => r.id);
  const stashed = roomIds.length
    ? await prisma.roomTag.findMany({
        where: { roomId: { in: roomIds }, tag: { group: { slug: CORPSE_GROUP_SLUG } } },
        select: { roomId: true, quantity: true, tag: { select: CORPSE_TAG_FIELDS } },
      })
    : [];
  const roomById = new Map(reachable.map((r) => [r.id, r]));

  const row = (tag, source, quantity) => ({
    tagId: tag.id,
    tagSlug: tag.slug,
    tagName: tag.name,
    quantity: quantity ?? 1,
    rotten: tag.corpseKind === "ROTTEN",
    human: isHumanCorpse(tag),
    deadCharacterId: tag.corpseOfCharacterId ?? null,
    deadName: tag.corpseOf?.name ?? null,
    yieldSlug: yieldSlugFor(tag),
    source,
    sourceKey: `${source.kind}:${source.id}`,
  });

  return [
    ...held.map((ct) =>
      row(ct.tag, { kind: "character", id: character.id, name: "You ‡" }, ct.quantity),
    ),
    // discordThreadId rides along so a caller can hand the source straight to
    // roomAnnounce.js#announceInRoom, which wants the room row and not an id.
    ...stashed.map((rt) =>
      row(
        rt.tag,
        {
          kind: "room",
          id: rt.roomId,
          name: roomById.get(rt.roomId)?.name ?? "a room",
          discordThreadId: roomById.get(rt.roomId)?.discordThreadId ?? null,
        },
        rt.quantity,
      ),
    ),
  ];
}

module.exports = {
  MONSTER_YIELDS,
  CORPSE_TAG_FIELDS,
  isCorpseTag,
  isHumanCorpse,
  yieldSlugFor,
  corpsesInReach,
};
