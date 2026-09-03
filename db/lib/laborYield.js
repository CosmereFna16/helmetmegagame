// What a place is worth to labor in, and how that changes.
//
// Every Location carries at most three LocationYield rows, one per LaborKind.
// `base` is what docs/zones.yaml authored; `current` is where the world has
// drifted it to, and `current` is the only number a payout or the Labor?
// button ever reads. No row for a (location, kind) pair means that labor is
// impossible there — the button prints a bare × and the resolver skips it.
//
// The model is a mean-reverting random walk with occasional jump events, in
// the same spirit as db/weather.js's Markov table: most days nothing much
// happens, and rarely something does and then wears off. Per turn, per row:
//
//   target  = in an event ? eventTarget : base
//   current = clamp(current + reversion * (target - current) + noise, 0, CAP)
//
// An event does not move `current` itself — it moves what `current` is being
// pulled toward. That is what makes a swing arrive over a couple of turns
// rather than as a step change, and what makes it decay on its own once the
// window closes: clearing eventTarget puts `base` back in the target slot and
// the same reversion term walks it home. There is no separate recovery path.
//
// See docs/systemdocs/LABORING.md.

// Nothing is ever worth more than double an ordinary spot, or less than
// nothing. Both ends are reachable but rare — the walk has to be pushed there
// by an event and held, and the reversion is always pulling it back.
const YIELD_CAP = 2;
const YIELD_FLOOR = 0;

// Per-kind volatility. `reversion` is how hard a row is pulled toward its
// target each turn (higher = snaps back faster); `sigma` is the standard
// deviation of the daily wobble on top of that. The steady-state spread of the
// walk is roughly sigma / sqrt(2 * reversion), which is the number that
// actually shows up in play:
//
//   HUNTING  0.12 / sqrt(0.60) ~ +/-0.16   game is thick with it
//   FISHING  0.07 / sqrt(0.40) ~ +/-0.11   the river is the river, mostly
//   FARMING  0.025 / sqrt(0.24) ~ +/-0.05  a field is a field
//
// `eventChance` is per row per turn, except FARMING's, which is rolled ONCE
// for the whole world (see rollEvents) — a blight takes every field at once,
// and rolling it per-location would fire a dozen times in a month instead of
// about once.
const KIND_PARAMS = {
  HUNTING: {
    reversion: 0.3,
    sigma: 0.12,
    eventChance: 0.06,
    eventLength: [2, 8],
    magnitude: [0.25, 2],
    global: false,
  },
  FISHING: {
    reversion: 0.2,
    sigma: 0.07,
    eventChance: 0.025,
    eventLength: [3, 10],
    magnitude: [0.5, 1.6],
    global: false,
  },
  FARMING: {
    reversion: 0.12,
    sigma: 0.025,
    // ~1.8% a turn over a 60-turn (30-day) game is a shade over one event,
    // which is the "maybe once a 30 day game" this was asked for.
    eventChance: 0.018,
    eventLength: [8, 20],
    // Not a range: a farming event is one of two named things. A good harvest
    // is bigger than a bad one is bad, but a bad one is far likelier.
    outcomes: [
      { multiplier: 1.5, weight: 40 },
      { multiplier: 0.55, weight: 60 },
    ],
    global: true,
  },
};

const KINDS = Object.keys(KIND_PARAMS);

function clampYield(value) {
  return Math.max(YIELD_FLOOR, Math.min(YIELD_CAP, value));
}

// Box-Muller. Math.random() is uniform, and a uniform wobble makes every day
// equally likely to be a weird one — a normal one makes most days ordinary,
// which is the whole point of "most places will stay the same".
function gaussian(rng = Math.random) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

function randBetween(lo, hi, rng = Math.random) {
  return lo + rng() * (hi - lo);
}

function randIntBetween(lo, hi, rng = Math.random) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function pickOutcome(outcomes, rng = Math.random) {
  const total = outcomes.reduce((sum, o) => sum + o.weight, 0);
  let roll = rng() * total;
  for (const outcome of outcomes) {
    if (roll < outcome.weight) return outcome;
    roll -= outcome.weight;
  }
  return outcomes[outcomes.length - 1];
}

// Decides this turn's event for one kind. Returns { target, length } to start
// one, or null. `turn` is the number of the turn being opened.
function rollEvent(params, base, rng = Math.random) {
  if (rng() >= params.eventChance) return null;
  const multiplier = params.outcomes
    ? pickOutcome(params.outcomes, rng).multiplier
    : randBetween(params.magnitude[0], params.magnitude[1], rng);
  return {
    target: clampYield(base * multiplier),
    length: randIntBetween(params.eventLength[0], params.eventLength[1], rng),
  };
}

// The pure half: one row plus the turn it is drifting into, out comes what the
// row should look like afterwards. Split from the database the same way
// db/lib/laborAccess.js splits its rules, and for the same reason — this is the
// part worth simulating over sixty turns before trusting it in a live game.
//
// `globalEvent` is the world-wide farming event decided once per turn by
// driftAll, passed down so every farming row starts the same blight together.
function driftRow(row, turn, { rng = Math.random, globalEvent = null } = {}) {
  const params = KIND_PARAMS[row.kind];
  if (!params) return null;

  let eventTarget = row.eventTarget;
  let eventUntilTurn = row.eventUntilTurn;

  // An expired window is cleared before anything else, so the pull goes back
  // to `base` on the very turn the event ends rather than a turn later.
  if (eventUntilTurn != null && turn >= eventUntilTurn) {
    eventTarget = null;
    eventUntilTurn = null;
  }

  if (eventUntilTurn == null) {
    const started = params.global
      ? globalEvent && {
          target: clampYield(row.base * globalEvent.multiplier),
          length: globalEvent.length,
        }
      : rollEvent(params, row.base, rng);
    if (started) {
      eventTarget = started.target;
      eventUntilTurn = turn + started.length;
    }
  }

  const target = eventTarget ?? row.base;
  const current = clampYield(
    row.current + params.reversion * (target - row.current) + gaussian(rng) * params.sigma,
  );

  return { current, eventTarget, eventUntilTurn };
}

// Rolls the once-per-world farming event for a turn. Returns null on the
// overwhelming majority of turns.
function rollGlobalEvent(rng = Math.random) {
  const params = KIND_PARAMS.FARMING;
  if (rng() >= params.eventChance) return null;
  return {
    multiplier: pickOutcome(params.outcomes, rng).multiplier,
    length: randIntBetween(params.eventLength[0], params.eventLength[1], rng),
  };
}

// Walks every row one turn forward. Pure — takes rows, returns the writes to
// make — so the turn pass below is just the database half, and a simulation
// can call this directly.
function driftAll(rows, turn, { rng = Math.random } = {}) {
  const globalEvent = rollGlobalEvent(rng);
  const updates = [];
  for (const row of rows) {
    const next = driftRow(row, turn, { rng, globalEvent });
    if (!next) continue;
    // Skip a write that changes nothing meaningful. Float equality would never
    // hit, so this is a tolerance — it keeps a no-op turn from writing 168 rows.
    const unchanged =
      Math.abs(next.current - row.current) < 1e-9 &&
      next.eventTarget === row.eventTarget &&
      next.eventUntilTurn === row.eventUntilTurn;
    if (unchanged) continue;
    updates.push({ id: row.id, ...next });
  }
  return updates;
}

// The turn-engine pass. Runs at turn close, AFTER the auto-labor pass, so a
// turn's payouts used the coefficients that were live during it and what this
// writes is what the next turn sees.
//
// Registered in db/index.js's TURN_PASSES, which is what keeps a random,
// non-idempotent pass from drifting twice if a turn advance is resumed.
async function runLaborYieldPass(prisma, turn) {
  const rows = await prisma.locationYield.findMany({
    select: { id: true, kind: true, base: true, current: true, eventTarget: true, eventUntilTurn: true },
  });
  if (rows.length === 0) return { turnNumber: turn.number, drifted: 0, events: 0 };

  const updates = driftAll(rows, turn.number);
  // Sequential rather than one big transaction: 168 tiny updates on a table
  // nothing else writes during a turn close, and a partial application is
  // harmless here — a row that missed a turn's drift is a row that stood still.
  let events = 0;
  for (const update of updates) {
    const { id, ...data } = update;
    if (data.eventUntilTurn != null && data.eventUntilTurn > turn.number) events += 1;
    await prisma.locationYield.update({ where: { id }, data }).catch((err) => {
      console.error(`Labor yield drift failed for row ${id}:`, err);
    });
  }

  return { turnNumber: turn.number, drifted: updates.length, events };
}

// The player-facing scale. A coefficient is never shown as a number — a place
// is Barren or Bountiful, and working out that Bountiful means 1.6 is the
// player's job. Bountiful is deliberately hard to reach: at base, only
// depths-19 and depths-23 wear it.
const QUALITY_WORDS = [
  { below: 0.3, word: "Barren" },
  { below: 0.6, word: "Scarce" },
  { below: 0.9, word: "Modest" },
  { below: 1.2, word: "Sufficient" },
  { below: 1.55, word: "Ample" },
  { below: Infinity, word: "Bountiful" },
];

// The one place a coefficient becomes a word. `null`/absent (no row at all, or
// a row that has bottomed out) is the × — there is nothing to find here.
function qualityWord(current) {
  if (current == null || current <= 0) return "×";
  return QUALITY_WORDS.find((step) => current < step.below).word;
}

module.exports = {
  YIELD_CAP,
  YIELD_FLOOR,
  KIND_PARAMS,
  KINDS,
  clampYield,
  driftRow,
  driftAll,
  rollGlobalEvent,
  runLaborYieldPass,
  qualityWord,
};
