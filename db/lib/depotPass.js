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
const { rollTurret, turretSpares } = require("./depotTurret");
const { presentedIdentity, forcedNameFrom } = require("./presentedIdentity");
const { DEPOT_LOCATION_SLUG } = require("./depot");
const { expiryFrom } = require("./turnFormat");
// Death is decided in one place so the two existing death paths and this one
// cannot drift on what it means — the corpse, the archive row, the unequip,
// the voided offers. Required by path: it is deliberately off the barrel.
const { applyDeathToRow } = require("./characterDeath");

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
async function sweepTurret(prisma, depot, turn) {
  if (!depotPowered(depot) || !depot.turretArmed) return { shots: [] };

  const location = await prisma.location.findUnique({
    where: { slug: DEPOT_LOCATION_SLUG },
    select: { id: true },
  });
  if (!location) return { shots: [] };

  const present = await prisma.character.findMany({
    where: { status: "ALIVE", locationId: location.id },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      concealed: true,
      tags: { select: { equipped: true, tag: { select: { slug: true, forcedName: true } } } },
    },
  });

  const shots = [];
  for (const character of present) {
    const forcedName = forcedNameFrom(character.tags);
    const { name } = presentedIdentity(character, { forcedName });
    if (turretSpares(name, depot)) continue;

    shots.push({ character, ...rollTurret(character.tags, depot) });
  }

  return { shots, locationId: location.id };
}

// Turn a roll into an actual wound. Split out because the on-arrival trigger
// (db/lib/locationMove.js) applies exactly the same consequence, and two
// copies of "what a bullet does" would drift.
async function applyTurretShot(prisma, shot, turn) {
  const { character, severity, tagSlug } = shot;

  if (severity === "dead") {
    // The full death, not a status flip: a corpse on the depot floor, the
    // archive line, the Discord role owed back. `claimed` is false if
    // something else already killed them this turn, which a resumed pass can
    // legitimately hit.
    const { claimed } = await applyDeathToRow(prisma, character, {
      turn,
      content: "Shot dead by the turret in the depot ceiling. \u2021",
    });
    return { kind: claimed ? "dead" : "graze", discordUserId: character.discordUserId };
  }

  if (!tagSlug) return { kind: "graze", discordUserId: character.discordUserId };

  const tag = await prisma.tag.findUnique({
    where: { slug: tagSlug },
    select: { id: true, defaultDurationTurns: true, stackable: true },
  });
  if (!tag) return { kind: "graze", discordUserId: character.discordUserId };

  const expiresTurn = tag.defaultDurationTurns
    ? expiryFrom(turn.number, tag.defaultDurationTurns)
    : null;

  // The wound ladder is non-stackable, so a second bullet on the same turn
  // does not become "Deep Wound x2" — the existing row stands.
  await prisma.characterTag.upsert({
    where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
    update: {},
    create: { characterId: character.id, tagId: tag.id, source: "EVENT", expiresTurn },
  });

  return { kind: "hit", severity, discordUserId: character.discordUserId };
}

// The turret's OTHER trigger: walking in while it is hot.
//
// Called from db/lib/locationMove.js on every arrival, the way
// rollCavingOnArrival is, and deliberately BEFORE that function's
// DISCORD_TOKEN guard — being shot is a database fact and must not depend on
// there being a token to announce it with.
//
// Loads the character itself rather than taking the one the caller already
// has, because the turret needs `equipped` and `forcedName` off the tags and
// the mover's select carries neither.
async function rollTurretOnArrival(prisma, { characterId, toLocationId, turn }) {
  // The location check comes FIRST and is deliberately the cheapest thing
  // here. loadDepot is an upsert — a write — and this runs on every arrival
  // anywhere in the game; at 100+ players that had every move in Ravenheart
  // contending on the one row bumpColumn takes a FOR UPDATE lock on.
  const location = await prisma.location.findUnique({
    where: { id: toLocationId },
    select: { slug: true },
  });
  if (location?.slug !== DEPOT_LOCATION_SLUG) return null;

  const depot = await loadDepot(prisma);
  if (!depotPowered(depot) || !depot.turretArmed) return null;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      status: true,
      concealed: true,
      tags: { select: { equipped: true, tag: { select: { slug: true, forcedName: true } } } },
    },
  });
  if (!character || character.status !== "ALIVE") return null;

  const { name } = presentedIdentity(character, { forcedName: forcedNameFrom(character.tags) });
  if (turretSpares(name, depot)) return null;

  const shot = { character, ...rollTurret(character.tags, depot) };
  // null, not a { number: null } stand-in: that object is truthy, so
  // corpseMint's `turn ? expiryFrom(turn.number + 1, …)` would take it and
  // rot the body off turn 1.
  const outcome = await applyTurretShot(prisma, shot, turn ?? null);
  return { ...outcome, severity: shot.severity, tier: shot.tier };
}

async function runDepotPass(prisma, turn) {
  const depot = await loadDepot(prisma);

  const generator = await burnGenerator(prisma, depot);
  // Re-read: the burn may have switched the generator off, and the turret
  // must not fire on power the generator no longer has.
  const afterBurn = await loadDepot(prisma);

  const shuttle = await runShuttleClock(prisma, afterBurn, turn);
  const { shots } = await sweepTurret(prisma, afterBurn, turn);

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
    const outcome = await applyTurretShot(prisma, shot, turn);
    outcomes.push({ ...outcome, severity: shot.severity, tier: shot.tier });
    if (outcome.discordUserId) {
      dms.push({
        discordUserId: outcome.discordUserId,
        content: TURRET_DM[outcome.kind === "hit" ? "hit" : outcome.kind] ?? TURRET_DM.hit,
      });
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
