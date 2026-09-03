// The travel graph — the ONE place that reads LocationLink, so no caller has
// to remember that an edge is stored as a single undirected row and could
// have this location on either side.
//
// Every surface that offers a destination and every check that authorises a
// crossing comes through here: db/lib/locationTravel.js#performLocationMove,
// the bot's Travel picker, the web's MOVE_CHARACTER re-validation, and the
// modular gate button. That matters because the gating rules are not
// cosmetic — a hidden edge must be genuinely absent from a list, and a
// locked one must refuse server-side even when a client sends its id
// directly.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { heldTagSlugs } = require("./roomAccess");
const { isMounted, equippedSlugs } = require("./mounts");

// The two endpoints of a link, oriented so `near` is the side you are
// standing on. Callers only ever want `far`.
function endpoints(link, locationId) {
  const nearIsA = link.aId === locationId;
  return {
    near: nearIsA ? link.a : link.b,
    far: nearIsA ? link.b : link.a,
  };
}

// Canonical endpoint order for a NEW row: ascending slug, so an attribute
// can never disagree between the two directions and a modular gate cannot
// end up open one way and shut the other. The sync is the only writer.
function orderEndpoints(slugA, idA, slugB, idB) {
  return slugA <= slugB ? { aId: idA, bId: idB } : { aId: idB, bId: idA };
}

const LINK_INCLUDE = {
  a: { include: { zone: true } },
  b: { include: { zone: true } },
};

// Every link touching one location, either side.
async function linksFor(prisma, locationId) {
  if (!locationId) return [];
  return prisma.locationLink.findMany({
    where: { OR: [{ aId: locationId }, { bId: locationId }] },
    include: LINK_INCLUDE,
  });
}

// One link between two specific locations, whichever way round it is stored.
async function linkBetween(prisma, locationId, otherLocationId) {
  if (!locationId || !otherLocationId) return null;
  return prisma.locationLink.findFirst({
    where: {
      OR: [
        { aId: locationId, bId: otherLocationId },
        { aId: otherLocationId, bId: locationId },
      ],
    },
    include: LINK_INCLUDE,
  });
}

// Is a keyed edge currently propped open? Nothing closes one — the window
// simply lapses, which is why this is a comparison and not a stored flag.
function isHeldOpen(link, now = new Date()) {
  return Boolean(link?.openUntil && link.openUntil.getTime() > now.getTime());
}

// Should this crossing raise the "Leave open for the next 24 hours?" prompt?
// Only for somebody who actually holds the key — propping a door is the
// key-holder's decision, not a courtesy anyone walking through inherits — and
// only while it is shut, so a stream of traffic through an open way does not
// re-ask every one of them.
function shouldPromptKeyed(link, { tagSlugs, now = new Date() } = {}) {
  if (!link?.keyed || !link.requiredTagSlug) return false;
  if (isHeldOpen(link, now)) return false;
  const held = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs ?? []);
  return held.has(link.requiredTagSlug);
}

// The pure predicate: may a character holding `tagSlugs` cross this edge
// right now? Separated from the queries so the picker, the mover and the
// re-validation all reach the identical verdict from already-loaded data.
//
// `listed` is a weaker thing than `passable`: a LOCKED edge is listed and
// refuses, so a player can see the door and learn they need the key, while a
// HIDDEN edge is not listed at all, so they never learn it exists.
//
// A propped-open keyed edge satisfies its own tag requirement, which also
// makes a hidden one listed. That is deliberate and is the entire feature: a
// door somebody held open has to be visible to the people meant to follow
// them through it.
//
// `mounted` is the ONE input here that is not about tags-you-hold but about
// tags-you-have-out. Pass it from isMounted(equippedSlugs(tags)); a horse in
// your pocket is not a horse you are riding.
function crossingCheck(link, { tagSlugs, mounted = false, now = new Date() } = {}) {
  if (!link) {
    return { listed: false, passable: false, refusal: "You can't get there directly from here." };
  }

  const held = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs ?? []);
  const hasTag = !link.requiredTagSlug || held.has(link.requiredTagSlug) || isHeldOpen(link, now);

  if (link.hidden && !hasTag) {
    // Same wording a nonexistent edge gets, deliberately: a refusal that
    // read differently would tell a player the hidden way is there.
    return { listed: false, passable: false, refusal: "You can't get there directly from here." };
  }
  if (!hasTag) {
    return { listed: true, passable: false, refusal: "The way is locked. You don't have what opens it. ‡" };
  }
  if (link.modular && !link.isOpen) {
    return { listed: true, passable: false, refusal: "The way is shut. ‡" };
  }
  // Last, because it is the one refusal the traveller can fix on the spot: a
  // way too tight for a horse is listed, and unequipping the horse is the way
  // through. Location.indoors would only have parked the mount on arrival,
  // which is after the free crossing was already spent.
  if (link.onFoot && mounted) {
    return {
      listed: true,
      passable: false,
      refusal: "No horse or cart fits through there. Unequip it and go on foot. ‡",
    };
  }
  return { listed: true, passable: true, refusal: null };
}

// Who may flip a modular gate: anyone holding one of its opener tags, or
// playing one of its opener Roles. Pure, and re-checked server-side in the
// button handler — a rendered button is a hint, not a lock.
function canToggleGate(link, { tagSlugs, roleSlug } = {}) {
  if (!link?.modular) return false;
  const held = tagSlugs instanceof Set ? tagSlugs : new Set(tagSlugs ?? []);
  if ((link.openerTagSlugs ?? []).some((slug) => held.has(slug))) return true;
  return Boolean(roleSlug && (link.openerRoleSlugs ?? []).includes(roleSlug));
}

// The destination list for one character standing in one location, already
// gated. Rows come back sorted the way every picker wants them: by zone,
// then by the location's authoring order.
//
// `character` needs id, and either a loaded `tags` (as CHARACTER_SELECT
// shapes it) or nothing, in which case the tags are queried. Returns
// [{ location, link, listed, passable, refusal, crossesZone }]; callers that
// render a list must filter on `listed` themselves, because the mover wants
// the unlisted rows too in order to refuse correctly.
async function resolveNeighbors(prisma, character, locationId, { fromZoneId = null } = {}) {
  const links = await linksFor(prisma, locationId);
  if (links.length === 0) return [];

  // The fallback used to call heldTagSlugs, which returns BARE slugs with no
  // equip state — and a stowed horse must not read as a mount. So when the
  // caller hands us no tags we load them in the shape equippedSlugs expects
  // rather than the cheaper flat set.
  const tags =
    character?.tags ??
    (character?.id
      ? await prisma.characterTag.findMany({
          where: { characterId: character.id },
          select: { equipped: true, tag: { select: { slug: true } } },
        })
      : []);
  const tagSlugs = new Set(tags.map((ct) => ct.tag?.slug).filter(Boolean));
  const mounted = isMounted(equippedSlugs(tags));

  const zoneId = fromZoneId ?? character?.zoneId ?? null;
  // One clock for the whole list, so a propped-open way cannot lapse halfway
  // down it and show as both open and shut in one render.
  const now = new Date();

  return links
    .map((link) => {
      const { far } = endpoints(link, locationId);
      return {
        location: far,
        link,
        crossesZone: Boolean(zoneId) && far.zoneId !== zoneId,
        ...crossingCheck(link, { tagSlugs, mounted, now }),
      };
    })
    .sort(
      (x, y) =>
        (x.location.zone?.sortOrder ?? 0) - (y.location.zone?.sortOrder ?? 0) ||
        (x.location.zone?.name ?? "").localeCompare(y.location.zone?.name ?? "") ||
        x.location.sortOrder - y.location.sortOrder ||
        x.location.name.localeCompare(y.location.name),
    );
}

// Just the rows a player may be shown. The common case for a picker.
async function travelOptions(prisma, character, locationId, opts) {
  return (await resolveNeighbors(prisma, character, locationId, opts)).filter((row) => row.listed);
}

// How long a propped door stays propped. Real hours, not turns: it is a
// physical door somebody wedged, and the point is that people can follow
// within the day.
const KEYED_OPEN_MS = 24 * 60 * 60 * 1000;

module.exports = {
  LINK_INCLUDE,
  KEYED_OPEN_MS,
  endpoints,
  orderEndpoints,
  linksFor,
  linkBetween,
  crossingCheck,
  canToggleGate,
  isHeldOpen,
  shouldPromptKeyed,
  resolveNeighbors,
  travelOptions,
};
