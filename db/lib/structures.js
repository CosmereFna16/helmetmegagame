// Structures: the shared read half of the building system.
//
// A Structure row is a built thing standing at a Location — and, while
// UNDER_CONSTRUCTION, the build site itself (schema.prisma has the full
// model notes). This module owns the reads and the wording both faces
// share: the loader that joins a row to its catalog type, the derived
// can-you-build-here rule, and the ambient lines a site speaks into its
// Location channel. The WRITES live in the web server actions
// (web/app/(app)/character/requestActions.js) — the web face is the only
// builder, the same way it is the only crafter.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { ambientLine } = require("./ambientLine");
const { hasAttribute } = require("./locationAttributes");

// Structure types live in the assets-structures TagGroup
// (docs/taggroups.yaml) — display color and catalog organisation only.
// The runtime rules never key on the group: unique is per-type
// (placement.unique), and non-stacking is per labor kind
// (laborAccess.js#structureTools).

// placement with its defaults applied. Normalisation/validation happen at
// sync time (db/lib/tagShapes.js); this is the read-side accessor, and the
// defaults here must agree with the ones documented on Tag.placement in
// schema.prisma.
function placementOf(tag) {
  const p = tag?.placement;
  if (!p || typeof p !== "object") return null;
  return {
    unique: p.unique !== false,
    fieldwork: p.fieldwork === true,
    examine: typeof p.examine === "string" ? p.examine : null,
    defenseNote: typeof p.defenseNote === "string" ? p.defenseNote : null,
    laborBonus: p.laborBonus ?? null,
    provides: Array.isArray(p.provides) ? p.provides : [],
    link: p.link === "hold_open" || p.link === "hold_shut" ? p.link : null,
  };
}

// Every structure standing (or rising, or ruined) at a Location, each row
// carrying its catalog type as `.type` (or null after a catalog prune —
// callers render typeName and skip type-dependent behaviour). One query per
// table, joined in JS: typeSlug is a string on purpose (schema.prisma), so
// there is no relation to include.
async function structuresAt(prisma, locationId, { statuses = null } = {}) {
  if (!locationId) return [];
  const rows = await prisma.structure.findMany({
    where: { locationId, ...(statuses ? { status: { in: statuses } } : {}) },
    // The id tiebreaker keeps two same-instant rows in one stable order —
    // Examine and the desk must never disagree about which came first.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!rows.length) return [];
  const types = await prisma.tag.findMany({
    where: { slug: { in: [...new Set(rows.map((r) => r.typeSlug))] } },
    select: { id: true, slug: true, name: true, placement: true },
  });
  const bySlug = new Map(types.map((t) => [t.slug, t]));
  return rows.map((row) => {
    const type = bySlug.get(row.typeSlug) ?? null;
    return { ...row, type, placement: type ? placementOf(type) : null };
  });
}

// Where building is refused. DERIVED from columns the game already
// maintains, not a hand-authored denylist: indoors (you do not raise a
// palisade in the Cathedral's nave), a CAVE_LEVEL zone (no #summary
// underground, so nothing built there could ever announce — MAP.md §1),
// and the `noBuild` attribute for the genuine one-offs the registry names
// (the Depot, the Lifeweb's ground). `location` needs
// { indoors, attributes, zone: { kind } }.
function canBuildHere(location) {
  if (!location) return { ok: false, reason: "You are nowhere to build. ‡" };
  // Cave first: the cave levels are also authored `indoors: true`, and the
  // underground refusal is the truer sentence for them.
  if (location.zone?.kind === "CAVE_LEVEL") {
    return { ok: false, reason: "Nothing can be raised down here. ‡" };
  }
  if (location.indoors) {
    return { ok: false, reason: "There is no ground to build on indoors. ‡" };
  }
  if (hasAttribute(location, "noBuild")) {
    return { ok: false, reason: "This ground cannot be built on. ‡" };
  }
  return { ok: true, reason: null };
}

// One word per status, for surfaces that need the state as a chip or an
// aside. Prose sentences live in locationAttributes.js#structureLines.
function statusWord(status) {
  switch (status) {
    case "UNDER_CONSTRUCTION":
      return "half-built";
    case "COMPLETE":
      return "standing";
    case "DAMAGED":
      return "damaged";
    case "RUINED":
      return "a ruin";
    case "ABANDONED":
      return "abandoned groundwork";
    default:
      return String(status ?? "").toLowerCase();
  }
}

// The statuses that OCCUPY the ground for the one-per-place rule: a wreck —
// RUINED or ABANDONED — never blocks raising the same type again. Shared so
// the server's refusal (openBuildSiteImpl) and the Craft menu's filter
// (web/lib/tagRequests.js#placementOfferedHere) can never drift apart.
const PRESENT_STATUSES = ["UNDER_CONSTRUCTION", "COMPLETE", "DAMAGED"];

// --- The lines a site speaks -------------------------------------------
//
// All three are scenery and go through ambientLine (CLAUDE.md: a line the
// WORLD says into a channel is `-#` subtext). Callers post the result to
// the Location's own channel (Location.discordChannelId) AFTER their
// transaction commits — discordRest.js#postMessage from the web face —
// and every send is catch-logged, never awaited inside a transaction.
//
// The worker's name is deliberately absent from the advance line: who is
// swinging a hammer is visible to anyone standing there in the fiction,
// but a per-name feed would turn the channel into a work log. The count is
// the story.

function siteOpenedLine(structure) {
  return ambientLine(
    `Work begins on a ${structure.typeName} here (1/${structure.turnsNeeded}).`,
  );
}

function siteAdvancedLine(structure, turnsDone) {
  return ambientLine(
    `The ${structure.typeName} rises (${turnsDone}/${structure.turnsNeeded}).`,
  );
}

function siteCompletedLine(structure) {
  return ambientLine(`The ${structure.typeName} stands finished.`);
}

function siteCancelledLine(structure) {
  return ambientLine(`Work on the ${structure.typeName} is abandoned.`);
}

// The notification list: everyone with a StructureWork row, plus the payer
// when the payer is a character — a structure has no owner, but the people
// whose turns raised it hear when something happens to it. Returns
// characterIds, deduplicated, optionally without the actor themselves.
async function stakeholderCharacterIds(prisma, structureId, { except = null, payerKey = null } = {}) {
  const work = await prisma.structureWork.findMany({
    where: { structureId },
    select: { characterId: true },
  });
  const ids = new Set(work.map((w) => w.characterId));
  const payerParts = String(payerKey ?? "").split(":");
  if (payerParts[0] === "character" && payerParts[1]) ids.add(payerParts[1]);
  if (except) ids.delete(except);
  return [...ids];
}

module.exports = {
  PRESENT_STATUSES,
  placementOf,
  structuresAt,
  canBuildHere,
  statusWord,
  siteOpenedLine,
  siteAdvancedLine,
  siteCompletedLine,
  siteCancelledLine,
  stakeholderCharacterIds,
};
