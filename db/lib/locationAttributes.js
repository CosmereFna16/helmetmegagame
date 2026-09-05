// What is true about a place, and how to say it.
//
// A Location carries two kinds of fact, and the Examine button shows both
// without having to know which is which.
//
// AUTHORED attributes are written into docs/zones.yaml's per-location
// `attributes:` map and stored as JSON on Location.attributes. They are
// properties of the place itself and change only on a sync — "this room is
// the Depot" is not something that happens, it is something that is.
//
// DERIVED lines are read off live state and never authored: whether the ways
// out stand open, whether the machinery in here is running. The caller loads
// that state and hands it over as `ctx`, which is why this module can stay
// Prisma-free and network-free — the same reason db/lib/depot.js gives for
// living here. These are game facts, and both faces read them.
//
// Adding an attribute means adding one entry to ATTRIBUTES. The sync rejects
// a key that is not in it, so a typo in the YAML is a loud problem at sync
// time rather than a line that silently never prints.

// The two keys code matches on rather than merely prints. Exported so the web
// layer stops writing them as bare literals — a typo in one of those is a
// button that silently never appears, which is exactly the failure the sync's
// unknown-key check exists to prevent on the YAML side.
const GODFLESH_ATTRIBUTE = "godflesh";
const REFINERY_ATTRIBUTE = "refinery";
const SAFE_ATTRIBUTE = "safe";

// key -> { describe(value, ctx) -> string|null }
//
// `describe` returning null means "true, but nothing worth saying here" —
// used by an attribute that only exists to be matched on.
const ATTRIBUTES = {
  // The Merchant's berth. Marks the one Location the Depot console, the
  // generator, the turret and the shuttle all belong to, so none of them has
  // to hardcode a slug. Exists to be matched on: every line worth printing
  // about the place is derived and arrives through ctx.depot.
  depot: {
    describe: () => null,
  },
  // Ground nothing may be built on, for the handful of one-off places the
  // DERIVED rules (indoors, a cave level — db/lib/structures.js#canBuildHere)
  // don't already cover: the Lifeweb's ground is the first. Exists to be
  // matched on; the place's own description carries whatever there is to say.
  noBuild: {
    describe: () => null,
  },

  // Marsh open enough that the Godflesh is in reach of a blade. What the
  // Extract button matches on, so no marsh tile has to be named by slug.
  // See docs/systemdocs/FACTORY.md.
  godflesh: {
    describe: () => "**Godflesh**: you can cut it out of the water here. ‡",
  },

  // The Godard Factory floor. Laboring here refines Godflesh into Squeeze
  // instead of paying ⬢, and it is the one place in the game where labor is
  // legal with no LocationYield row at all.
  refinery: {
    describe: () => "**Refinery**: laboring here turns Godflesh into Squeeze. ‡",
  },

  // Underground, and nothing in the dark wants you. The Caving Die skips a
  // Location wearing this (db/lib/cavingPass.js), which is what makes Customs
  // — a cave mouth with a sentry, a floodlight and a shop in it — the one
  // place down there you can stand without rolling. Says so out loud, because
  // a player choosing where to camp should be able to read the answer.
  safe: {
    describe: () => "**Safe**: nothing down here stalks this place. ‡",
  },

  // A public board somebody can pin a paper to. What the Noticeboard button on
  // this Location's anchor matches on, so no board has to be named by slug.
  // See docs/systemdocs/PAPERWORK.md.
  noticeboard: {
    describe: () => "**Noticeboard**: you can pin paper here. ‡",
  },
};

// The authored half: whatever is in Location.attributes, in registry order so
// the readout looks the same in every channel.
function authoredLines(location, ctx = {}) {
  const attrs = location?.attributes ?? {};
  const lines = [];
  for (const [key, entry] of Object.entries(ATTRIBUTES)) {
    const value = attrs[key];
    if (value == null || value === false) continue;
    const line = entry.describe(value, ctx);
    if (line) lines.push(line);
  }
  return lines;
}

// The one fact that is a real column rather than an attribute, because
// db/lib/indoors.js and db/lib/mounts.js both act on it. It reads as an
// attribute here even though it is not stored as one.
//
// Both halves print. Silence outdoors would have meant the rule was only ever
// stated in the place it bites, which is the worst moment to learn it.
function placementLine(location) {
  return location?.indoors
    ? "**Indoors**: your cart or horse has to stay at the door. ‡"
    : "**Outdoors**: you can use your horse or cart here. ‡";
}

// The modular gates touching this location. `gates` is [{ farName, isOpen }],
// the same shape db/lib/syncZones.js#gatesFor already builds for the anchor's
// button row, so the caller has usually loaded it already.
//
// The state, not the verb: the buttons say what a click DOES ("Close the way
// to Road"), and Examine says what is TRUE ("The way to Road stands open").
// Saying it the same way twice would make one of them wrong.
function gateLines(gates) {
  return (gates ?? [])
    .slice()
    .sort((x, y) => x.farName.localeCompare(y.farName))
    .map((gate) => {
      // A shut structural edge nothing holds is not a closed door — it is a
      // crossing nobody has built, and Examine is where that gets noticed.
      if (gate.unbuilt) {
        return `**${gate.farName}**: nothing spans the way — it would have to be built. ‡`;
      }
      return gate.isOpen
        ? `**${gate.farName}**: the way stands open. Worked from the watchtower. ‡`
        : `**${gate.farName}**: the way is closed. Worked from the watchtower. ‡`;
    });
}

// The Depot's machinery, read off live state and handed over as ctx.depot —
// { generatorOn, powered, fuelTurnsLeft, turretArmed, shuttleDocked }. The
// caller loads it; this module stays Prisma-free.
//
// Standing in the room has to tell you what the web console tells the
// Merchant. A turret you cannot see is a trap rather than a threat, and a
// threat is the more interesting thing to walk into.
function depotLines(ctx = {}) {
  const depot = ctx.depot;
  if (!depot) return [];

  const lines = [];
  if (!depot.powered) {
    lines.push("**Generator**: it's off, so nothing in here works. ‡");
  } else if (depot.fuelTurnsLeft == null) {
    lines.push("**Generator**: it's running. ‡");
  } else {
    const days = depot.fuelTurnsLeft;
    lines.push(`**Generator**: ${days} day${days === 1 ? "" : "s"} of coal left. ‡`);
  }
  lines.push(depot.shuttleDocked ? "**Shuttle**: it's here. ‡" : "**Shuttle**: it's not here. ‡");
  // Only worth a line when it is a danger. A disarmed turret is a fixture, and
  // saying so every time would train people to stop reading the line that
  // matters.
  if (depot.turretArmed && depot.powered) {
    lines.push("**Turret**: it's armed, and it's watching you. ‡");
  }
  return lines;
}

// The structures standing (or rising, or ruined) here, read off live state
// and handed over as ctx.structures — the db/lib/structures.js#structuresAt
// output. This module cannot import structures.js itself: that module
// already imports locationAttributes.js (for hasAttribute), and a back-import
// would make a cycle out of what is meant to be a one-way layering, caller
// loads, this module only says.
//
// One line per structure, oldest first (structuresAt's own order), and a
// ruin stays on the list rather than dropping off — a ruin is a standing
// accusation, not scenery that tidies itself away.
function structureLines(ctx = {}) {
  const structures = ctx.structures;
  if (!structures?.length) return [];
  return structures.flatMap((structure) => {
    const typeName = structure.type?.name ?? structure.typeName;
    // The defenseNote (a defensive clause, or the siege licence) prints
    // only while the structure WORKS — COMPLETE or DAMAGED — never off a
    // wreck or a rising site, or a ruined ram would still license a storm.
    // Both the note and the structure's own `examine:` are authored as
    // ‡-free fragments (tagShapes enforces that): the GM Move card splices
    // the note mid-line, and Examine puts each one after a **topic** of its
    // own. They pick the ‡ up on the way out.
    const note = structure.placement?.defenseNote;
    const noteLines = note ? [`**Defense**: ${note} ‡`] : [];
    switch (structure.status) {
      case "UNDER_CONSTRUCTION":
        return [`**${typeName}**: going up, ${structure.turnsDone} of ${structure.turnsNeeded} days done. ‡`];
      case "COMPLETE":
        return [`**${typeName}**: ${structure.placement?.examine ?? "it stands here."} ‡`, ...noteLines];
      case "DAMAGED":
        return [`**${typeName}**: it's damaged. ‡`, ...noteLines];
      case "RUINED":
        return [`**${typeName}**: a ruin. ‡`];
      case "ABANDONED":
        return [`**${typeName}**: abandoned groundwork, gone nowhere. ‡`];
      default:
        return [];
    }
  });
}

// Everything true about where you stand, as prose lines. The labor readout is
// NOT here: it is a fixed-order table of its own that predates this module
// (db/lib/laborYield.js#qualityWord), and the caller prints it first.
function describeLocation(location, ctx = {}) {
  return [
    placementLine(location),
    ...authoredLines(location, ctx),
    ...depotLines(ctx),
    ...structureLines(ctx),
    ...gateLines(ctx.gates),
  ].filter(Boolean);
}

// Sync-side validation. Returns the attributes to store, pushing a problem for
// anything the registry does not know — an unrecognised key is almost always
// a typo, and a silently-dropped one is a place that never says what it is.
function collectAttributes(raw, label, problems) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push(`${label} has a non-map attributes:`);
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ATTRIBUTES[key]) {
      problems.push(`${label} has unknown attribute "${key}"`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

// Does this location carry an attribute? The lookup every system that owns a
// place should use instead of comparing slugs.
function hasAttribute(location, key) {
  const value = location?.attributes?.[key];
  return value != null && value !== false;
}

module.exports = {
  GODFLESH_ATTRIBUTE,
  REFINERY_ATTRIBUTE,
  SAFE_ATTRIBUTE,
  depotLines,
  structureLines,
  ATTRIBUTES,
  authoredLines,
  placementLine,
  gateLines,
  describeLocation,
  collectAttributes,
  hasAttribute,
};
