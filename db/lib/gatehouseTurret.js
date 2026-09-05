// The Gatehouse turret: the triple-barrelled machinegun on the rotor in the
// fortress yard, which the Baron's own charter has described as "off" since
// before it could actually be switched on.
//
// It is the Depot turret's opposite in the one way that matters. The Merchant's
// gun reads faces and spares exactly one; this one spares nobody. There is no
// list, no keycard, no rank — arm it and it fires on whoever is standing in the
// yard, the Censor included. That is why the switch is a physical button on a
// wall in the Censor's Office rather than a page anyone can reach: the only
// safeguard is that somebody has to walk up to it.
//
// It carries no tunable table of its own, so it rolls on the shipped one
// (db/lib/depotTurret.js#DEFAULT_TURRET_TABLE) — see turretPass.js's header for
// why that needs no code. Armour still bends the curve, which is the point of
// the Cerberon's mail: the gun is survivable if you are dressed for it, and
// very much not if you are not.
//
// Takes `prisma` as a parameter; see db/lib/dm.js for why.
const { sweepTurretAt, applyTurretShot, rollTurretOnArrivalAt, turretDmFor } = require("./turretPass");

const GATEHOUSE_LOCATION_SLUG = "gatehouse";

const DEATH_CONTENT = "Cut down by the turret in the fortress yard. ‡";

// Deliberately not the Depot's wording. That gun identifies you and decides it
// does not like your face; this one never looks up at all, and the lines say so.
const GATEHOUSE_TURRET_DM = {
  graze:
    "The gun on the rotor swings, finds you, and fires. The burst goes wide and takes a bite out of the wall. ‡",
  hit: "The gun on the rotor swings, finds you, and fires. It does not check who you are first. ‡",
  dead: "The gun on the rotor swings, finds you, and fires. It does not check who you are first, and it does not stop. ‡",
};

// What the world says when somebody flips the switch. Scenery, not an
// announcement — it goes into the Gatehouse as `-#` subtext through
// db/lib/ambientLine.js, because a machine spinning up is the only warning
// anyone in the yard is going to get.
const TURRET_ARMED_LINE = {
  text: "Something in the yard whirs, and the barrels on the rotor come around to level. ‡",
  signed: false,
};

const TURRET_DISARMED_LINE = {
  text: "The rotor in the yard settles, and the barrels drop. ‡",
  signed: false,
};

async function gatehouseTurretArmed(prisma) {
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { gatehouseTurretArmed: true },
  });
  return config?.gatehouseTurretArmed === true;
}

// The turn-end sweep. Returns DMs for the caller to send, the way every other
// pass does — see TURN-ENGINE.md §3.
async function runGatehouseTurretPass(prisma, turn) {
  if (!(await gatehouseTurretArmed(prisma))) {
    return { turretShots: 0, turretOutcomes: [], dms: [], burstLocationId: null };
  }

  const { shots, locationId } = await sweepTurretAt(prisma, { locationSlug: GATEHOUSE_LOCATION_SLUG });

  const dms = [];
  const outcomes = [];
  for (const shot of shots) {
    const outcome = await applyTurretShot(prisma, shot, turn, { deathContent: DEATH_CONTENT });
    outcomes.push({ ...outcome, severity: shot.severity, protection: shot.protection });
    if (outcome.discordUserId) {
      dms.push({ discordUserId: outcome.discordUserId, content: turretDmFor(GATEHOUSE_TURRET_DM, outcome) });
    }
  }

  // One burst for the whole sweep, not one per victim — see
  // db/lib/turretBurst.js. Null when it rolled at nobody: an empty yard makes
  // no noise, and a gun that announced itself every turn to an empty room
  // would be wallpaper by day three.
  return {
    turretShots: outcomes.length,
    turretOutcomes: outcomes,
    dms,
    burstLocationId: outcomes.length ? locationId : null,
  };
}

// Walking into the yard while it is hot. `armed` is passed as a thunk so the
// GameConfig read never happens for the thousands of arrivals that are not the
// Gatehouse.
function rollGatehouseTurretOnArrival(prisma, { characterId, toLocationId, turn }) {
  return rollTurretOnArrivalAt(prisma, {
    characterId,
    toLocationId,
    turn,
    locationSlug: GATEHOUSE_LOCATION_SLUG,
    armed: async () => ({ armed: await gatehouseTurretArmed(prisma) }),
    deathContent: DEATH_CONTENT,
  });
}

module.exports = {
  GATEHOUSE_LOCATION_SLUG,
  GATEHOUSE_TURRET_DM,
  TURRET_ARMED_LINE,
  TURRET_DISARMED_LINE,
  gatehouseTurretArmed,
  runGatehouseTurretPass,
  rollGatehouseTurretOnArrival,
};
