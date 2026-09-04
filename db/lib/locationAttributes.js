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

// key -> { describe(value, ctx) -> string|null }
//
// `describe` returning null means "true, but nothing worth saying here" —
// used by an attribute that only exists to be matched on.
const ATTRIBUTES = {
  // The Merchant's berth. Marks the one Location the Depot console, the
  // generator, the turret and the shuttle all belong to, so none of them has
  // to hardcode a slug. The interesting lines about it are derived and
  // arrive through ctx.depot; this one just names the place.
  depot: {
    describe: () => "A shuttle berth, and the only door Ravenheart has to anywhere else. ‡",
  },

  // Marsh open enough that the Godflesh is in reach of a blade. What the
  // Extract button matches on, so no marsh tile has to be named by slug.
  // See docs/systemdocs/FACTORY.md.
  godflesh: {
    describe: () => "Something under the water moves when you step, and keeps moving after you stop. ‡",
  },

  // The Godard Factory floor. Laboring here refines Godflesh into Squeeze
  // instead of paying ⬢, and it is the one place in the game where labor is
  // legal with no LocationYield row at all.
  refinery: {
    describe: () => "Vats, hooks and a press. Work a day here and whatever you brought comes out in cubes. ‡",
  },

  // A public board somebody can pin a paper to. What the Noticeboard button on
  // this Location's anchor matches on, so no board has to be named by slug.
  // See docs/systemdocs/PAPERWORK.md.
  noticeboard: {
    describe: () => "A board of weathered planks, thick with old nail holes. People pin things here. ‡",
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
function indoorsLine(location) {
  if (!location?.indoors) return null;
  return "A place you walk into — a cart or a mount waits at the door. ‡";
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
    .map((gate) =>
      gate.isOpen
        ? `The way to ${gate.farName} stands open. ‡`
        : `The way to ${gate.farName} is closed. ‡`,
    );
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
  lines.push(
    depot.powered
      ? `The generator is running${depot.fuelTurnsLeft != null ? `, and sounds like it has about ${depot.fuelTurnsLeft} day${depot.fuelTurnsLeft === 1 ? "" : "s"} of coal in it` : ""}. ‡`
      : "The generator is dead. Everything in here is dark and nothing works. ‡",
  );
  lines.push(
    depot.shuttleDocked
      ? "A shuttle sits on the landing pad, hold open. ‡"
      : "The landing pad is empty. ‡",
  );
  // Only worth a line when it is a danger. A disarmed turret is a fixture, and
  // saying so every time would train people to stop reading the line that
  // matters.
  if (depot.turretArmed && depot.powered) {
    lines.push("Something in the ceiling tracks you across the room. ‡");
  }
  return lines;
}

// Everything true about where you stand, as prose lines. The labor readout is
// NOT here: it is a fixed-order table of its own that predates this module
// (db/lib/laborYield.js#qualityWord), and the caller prints it first.
function describeLocation(location, ctx = {}) {
  return [
    indoorsLine(location),
    ...authoredLines(location, ctx),
    ...depotLines(ctx),
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
  depotLines,
  ATTRIBUTES,
  authoredLines,
  indoorsLine,
  gateLines,
  describeLocation,
  collectAttributes,
  hasAttribute,
};
