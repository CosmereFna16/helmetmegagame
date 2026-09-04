// The turret ENGINE: everything about an automated gun that does not depend on
// which gun it is. Two of them exist now — the Merchant's, in the Depot ceiling
// (db/lib/depotPass.js), and the Baron's, on the rotor in the Gatehouse yard
// (db/lib/gatehouseTurret.js) — and they differ in only three ways:
//
//   * where they are (a Location slug),
//   * what turns them on (the Depot's needs its generator running too),
//   * and who they spare (the Depot reads the Merchant's face; the Gatehouse
//     spares nobody, which is the whole character of the thing).
//
// Everything else — the sweep at turn end, the roll on arrival, and what a
// bullet actually does to a sheet — is identical, so it lives here once. The
// severity ladder, the armour columns and the weighted draw stay in
// db/lib/depotTurret.js: that file is the ballistics, this one is the trigger.
//
// `rollTurret(tags, source)` reads only `source.turretTable`, so a turret with
// no tunable row of its own passes `null` and gets the shipped table. That is
// why the Gatehouse needs no table, no column validation and no Dev Panel
// section to be a working gun.
//
// Takes `prisma` as a parameter; see db/lib/dm.js for why.
const { rollTurret } = require("./depotTurret");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { expiryFrom } = require("./turnFormat");
// Death is decided in one place so the existing death paths and this one cannot
// drift on what it means — the corpse, the archive row, the unequip, the voided
// offers. Required by path: it is deliberately off the barrel.
const { applyDeathToRow } = require("./characterDeath");

// Everything a shot needs off a character. Shared because the sweep and the
// arrival roll must judge the same sheet — `equipped` decides the armour
// column, and the concealment fields decide the face.
const TURRET_CHARACTER_SELECT = {
  id: true,
  name: true,
  discordUserId: true,
  concealed: true,
  tags: {
    select: { equipped: true, tag: { select: { slug: true, forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// What the gun sees when it looks at somebody: their PRESENTED name, not their
// papers. Concealment is meant to work against a machine exactly as well as it
// works against a person, which for the Depot means badly — see depotTurret's
// header on why being shot by your own gun is the feature.
function presentedNameOf(character) {
  return presentedIdentity(character, {
    forcedName: forcedNameFrom(character.tags),
    concealment: concealmentFrom(character.tags),
  }).name;
}

// The turn-end sweep over everyone standing in one location.
//
// `spares` is a predicate over the presented name; omit it and the turret
// shoots everyone it can see, which is the honest default for a gun nobody
// taught to recognise anybody.
async function sweepTurretAt(prisma, { locationSlug, tableSource = null, spares = null }) {
  const location = await prisma.location.findUnique({
    where: { slug: locationSlug },
    select: { id: true },
  });
  if (!location) return { shots: [], locationId: null };

  const present = await prisma.character.findMany({
    where: { status: "ALIVE", locationId: location.id },
    select: TURRET_CHARACTER_SELECT,
  });

  const shots = [];
  for (const character of present) {
    if (spares && spares(presentedNameOf(character))) continue;
    shots.push({ character, ...rollTurret(character.tags, tableSource) });
  }

  return { shots, locationId: location.id };
}

// Turn a roll into an actual wound. Both triggers land here, so "what a bullet
// does" has one definition; `deathContent` is the only per-turret part, because
// the archive line has to say which gun it was.
async function applyTurretShot(prisma, shot, turn, { deathContent }) {
  const { character, severity, tagSlug } = shot;

  if (severity === "dead") {
    // The full death, not a status flip: a corpse on the floor, the archive
    // line, the Discord role owed back. `claimed` is false if something else
    // already killed them this turn, which a resumed pass can legitimately hit.
    const { claimed } = await applyDeathToRow(prisma, character, { turn, content: deathContent });
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

  // The wound ladder is non-stackable, so a second bullet on the same turn does
  // not become "Deep Wound x2" — the existing row stands.
  await prisma.characterTag.upsert({
    where: { characterId_tagId: { characterId: character.id, tagId: tag.id } },
    update: {},
    create: { characterId: character.id, tagId: tag.id, source: "EVENT", expiresTurn },
  });

  return { kind: "hit", severity, discordUserId: character.discordUserId };
}

// The OTHER trigger: walking in while it is hot.
//
// Called from db/lib/locationMove.js on every arrival, the way
// rollCavingOnArrival is, and deliberately BEFORE that function's
// DISCORD_TOKEN guard — being shot is a database fact and must not depend on
// there being a token to announce it with.
//
// The location check comes FIRST and is deliberately the cheapest thing here:
// this runs on every arrival anywhere in the game, and at 100+ players a turret
// that loaded its own config row first would have every move in Ravenheart
// contending on it. `armed` is a THUNK for the same reason — the Depot's answer
// is a database read, and it must not happen until we know we are at the Depot.
async function rollTurretOnArrivalAt(
  prisma,
  { characterId, toLocationId, turn, locationSlug, armed, tableSource = null, spares = null, deathContent },
) {
  const location = await prisma.location.findUnique({
    where: { id: toLocationId },
    select: { slug: true },
  });
  if (location?.slug !== locationSlug) return null;

  const state = typeof armed === "function" ? await armed() : armed;
  if (!state || state.armed === false) return null;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { ...TURRET_CHARACTER_SELECT, status: true },
  });
  if (!character || character.status !== "ALIVE") return null;

  if (spares && spares(presentedNameOf(character), state)) return null;

  const shot = { character, ...rollTurret(character.tags, state.tableSource ?? tableSource) };
  // null, not a { number: null } stand-in: that object is truthy, so
  // corpseMint's `turn ? expiryFrom(turn.number + 1, …)` would take it and rot
  // the body off turn 1.
  const outcome = await applyTurretShot(prisma, shot, turn ?? null, { deathContent });
  return { ...outcome, severity: shot.severity, tier: shot.tier };
}

module.exports = {
  TURRET_CHARACTER_SELECT,
  presentedNameOf,
  sweepTurretAt,
  applyTurretShot,
  rollTurretOnArrivalAt,
};
