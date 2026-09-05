// The Depot's per-turn upkeep: the generator burns, the shuttle's clock runs
// out, and the turret sweeps the room.
//
// Run from db/index.js#resolveNeeds() so the bot's cron advance and the Dev
// Panel's "End turn" behave identically. Like every other pass it mutates the
// database and RETURNS its side effects — the ambient lines to speak, the DMs
// to send — rather than making a network call itself. See TURN-ENGINE.md §3.
//
// Takes `prisma` as a parameter; see db/lib/dm.js for why.
const { loadDepot, bumpFuel, depotPowered, LANDING_PAD_SLUG } = require("./depotState");
const { turretSpares } = require("./depotTurret");
const { DEPOT_LOCATION_SLUG } = require("./depot");
// The sweep, the arrival roll and what a bullet does are shared with the
// Gatehouse turret (db/lib/gatehouseTurret.js). Everything left in this file is
// what makes THIS gun the Merchant's: it needs the generator running, and it
// reads faces against Depot.merchantFace.
const { sweepTurretAt, applyTurretShot, rollTurretOnArrivalAt, turretDmFor } = require("./turretPass");

// What the world says when the generator finally coughs out. Bascinet's
// register: a thing that happens TO the room, not an announcement about it.
// `signed` rides with each line because the two shuttle lines are Bascinet's
// own words and must not be marked with a ‡ — see db/lib/ambientLine.js.
const GENERATOR_DIED_LINE = {
  text: "The generator coughs twice and stops. Every light in the depot goes out at once.",
  signed: true,
};

const SHUTTLE_LANDED_LINE = {
  text: "A shuttle has landed, hissing steam on the landing pad.",
  signed: false,
};

const SHUTTLE_DEPARTED_LINE = {
  text: "The shuttle departs in a burst of fire.",
  signed: false,
};

const TURRET_DM = {
  graze:
    "The turret tracked you across the depot floor and fired. It missed by an inch and put a hole in the wall behind you. ‡",
  hit: "The turret in the depot ceiling identified your face, decided it did not like it, and fired. ‡",
  dead: "The turret in the depot ceiling identified your face, decided it did not like it, and did not miss. ‡",
};

// One turn of the generator. Returns the line to speak if it died this turn.
async function burnGenerator(prisma, depot) {
  if (!depotPowered(depot)) return { burned: 0, died: false };

  const moved = await bumpFuel(prisma, -(depot.fuelBurnPerTurn ?? 0));
  const died = moved.after <= 0;
  if (died) {
    // Fuel at zero is already "off" as far as depotPowered is concerned, but
    // flipping the switch too means the Merchant has to deliberately restart
    // it after refuelling rather than having it silently come back.
    await prisma.depot.update({ where: { id: 1 }, data: { generatorOn: false } });
  }
  return { burned: -moved.delta, died };
}

// The shuttle's clock. It leaves on its own after shuttleMaxTurns whether or
// not anyone loaded it, which is what stops a Merchant parking it forever and
// using the landing pad as a second stash.
//
// Departing does NOT sweep the hold here. Selling is a deliberate act with a
// price attached, and a shuttle that left on a timer took nothing with it —
// the crates stay on the pad. Whoever wanted them sold should have been
// awake. Returns the line to speak.
async function runShuttleClock(prisma, depot, turn) {
  if (depot.shuttleState !== "DOCKED") return { departed: false };
  const landed = depot.shuttleTurn ?? 0;
  if (turn.number - landed < (depot.shuttleMaxTurns ?? 6)) return { departed: false };

  await prisma.depot.update({
    where: { id: 1 },
    data: { shuttleState: "AWAY", shuttleTurn: turn.number },
  });
  return { departed: true };
}

// The turret's turn-end sweep over everyone standing in the Depot.
//
// Powered and armed, or it does nothing — an unpowered turret is a lump of
// metal in the ceiling, which is the whole reason the generator matters.
async function sweepTurret(prisma, depot) {
  if (!depotPowered(depot) || !depot.turretArmed) return { shots: [] };

  return sweepTurretAt(prisma, {
    locationSlug: DEPOT_LOCATION_SLUG,
    tableSource: depot,
    spares: (name) => turretSpares(name, depot),
  });
}

const DEATH_CONTENT = "Shot dead by the turret in the depot ceiling. \u2021";

// Walking in while it is hot. `armed` is a thunk so loadDepot — an upsert, and
// therefore a write on one contended row — never runs for the thousands of
// arrivals that are not the Depot.
function rollTurretOnArrival(prisma, { characterId, toLocationId, turn }) {
  return rollTurretOnArrivalAt(prisma, {
    characterId,
    toLocationId,
    turn,
    locationSlug: DEPOT_LOCATION_SLUG,
    armed: async () => {
      const depot = await loadDepot(prisma);
      return {
        armed: depotPowered(depot) && Boolean(depot.turretArmed),
        tableSource: depot,
        depot,
      };
    },
    spares: (name, state) => turretSpares(name, state.depot),
    deathContent: DEATH_CONTENT,
  });
}

async function runDepotPass(prisma, turn) {
  const depot = await loadDepot(prisma);

  const generator = await burnGenerator(prisma, depot);
  // Re-read: the burn may have switched the generator off, and the turret
  // must not fire on power the generator no longer has.
  const afterBurn = await loadDepot(prisma);

  const shuttle = await runShuttleClock(prisma, afterBurn, turn);
  const { shots } = await sweepTurret(prisma, afterBurn);

  // Loaded here rather than taken from sweepTurret's return. It used to come
  // from there, which meant an unpowered Depot produced no locationId — and a
  // generator that has just died IS unpowered, so the one line most worth
  // hearing could never be spoken.
  const location = await prisma.location
    .findUnique({ where: { slug: DEPOT_LOCATION_SLUG }, select: { id: true } })
    .catch(() => null);
  const locationId = location?.id ?? null;

  const dms = [];
  const outcomes = [];
  for (const shot of shots) {
    const outcome = await applyTurretShot(prisma, shot, turn, { deathContent: DEATH_CONTENT });
    outcomes.push({ ...outcome, severity: shot.severity, protection: shot.protection });
    if (outcome.discordUserId) {
      dms.push({ discordUserId: outcome.discordUserId, content: turretDmFor(TURRET_DM, outcome) });
    }
  }

  // Ambient lines the caller speaks into the Depot's channel.
  const lines = [];
  if (generator.died) lines.push(GENERATOR_DIED_LINE);
  if (shuttle.departed) lines.push(SHUTTLE_DEPARTED_LINE);

  return {
    fuelBurned: generator.burned,
    generatorDied: generator.died,
    shuttleDeparted: shuttle.departed,
    turretShots: outcomes.length,
    turretOutcomes: outcomes,
    locationId,
    // One burst for the whole sweep, and only when it actually rolled at
    // somebody — see db/lib/turretBurst.js. Distinct from `locationId` above,
    // which is set whenever the Depot exists, because the generator and the
    // shuttle have lines to speak in an empty room and a gun does not.
    burstLocationId: outcomes.length ? locationId : null,
    lines,
    dms,
  };
}

module.exports = {
  runDepotPass,
  rollTurretOnArrival,
  TURRET_DM,
  // The two shuttle lines are spoken from the web actions as well as from the
  // pass, so they do cross a boundary; the generator line does not.
  SHUTTLE_LANDED_LINE,
  SHUTTLE_DEPARTED_LINE,
};
