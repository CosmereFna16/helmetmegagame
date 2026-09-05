// A line in a room's starter message that is read off live state.
//
// A Room's starter is written once by the sync and then left alone — it is
// prose about a place, and prose about a place does not change. The Landing
// Pad is the exception: whether the shuttle is sitting on it is the single
// most useful thing the room could say, and saying it one channel up on the
// Location's Examine puts it in the wrong place. So a room may name a key
// from the registry below, and the sync appends whatever that key currently
// renders to the room's own description.
//
// Same shape as db/lib/locationAttributes.js on purpose: a registry of keys,
// a `describe`, and a sync-side check that rejects a key nobody wrote a
// renderer for. The difference is that this one has to LOAD, so each entry
// carries a `load(prisma)` too — which is why the module takes prisma as a
// parameter rather than requiring the barrel back (db/lib/dm.js gives the
// same reason).
//
// The line is BOLD rather than `-#` subtext: it is the one sentence in the
// starter that is worth re-reading, and the paragraph above it is already
// italic.

const { loadDepot } = require("./depotState");

// key -> { load(prisma) -> state, describe(state) -> string|null }
const LIVE = {
  // The Landing Pad. Whether the shuttle is docked, in the room the shuttle
  // docks in.
  shuttle: {
    load: async (prisma) => {
      const depot = await loadDepot(prisma);
      return { docked: depot?.shuttleState === "DOCKED" };
    },
    describe: (state) => (state?.docked ? "**The shuttle is here.**" : "**It's empty.**"),
  },
};

// Loads state for every key in `keys` at once, so a sync that touches many
// rooms hits the database once per KIND of live line rather than once per
// room. Returns a Map of key -> state; an unknown key is simply absent, since
// collectLive has already made that a sync problem.
async function loadLiveStates(prisma, keys) {
  const wanted = [...new Set([...keys].filter((key) => LIVE[key]))];
  const states = new Map();
  await Promise.all(
    wanted.map(async (key) => {
      states.set(key, await LIVE[key].load(prisma));
    }),
  );
  return states;
}

// The rendered line for one room, or null — for a room with no `live` key, an
// unknown key, or a renderer that decides there is nothing to say.
function liveLine(key, state) {
  if (!key) return null;
  const entry = LIVE[key];
  if (!entry) return null;
  return entry.describe(state) || null;
}

// Sync-side validation, the twin of locationAttributes.js#collectAttributes.
// An unrecognised key is almost always a typo, and a silently-dropped one is a
// room that never says the thing it exists to say.
function collectLive(raw, label, problems) {
  if (raw == null) return null;
  if (typeof raw !== "string" || !LIVE[raw]) {
    problems.push(`${label} has unknown live key "${raw}"`);
    return null;
  }
  return raw;
}

module.exports = {
  LIVE,
  loadLiveStates,
  liveLine,
  collectLive,
};
