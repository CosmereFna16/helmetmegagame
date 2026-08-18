const {
  prisma,
  computeRate,
  HUNTING_DICE,
  LABORER_SLUG,
  LABORER_FARMING_SLUG,
  LABORER_FISHING_SLUG,
  LABORER_HERDING_SLUG,
  HUNTER_SLUG,
} = require("@lifeweb/db");
const { rollResourceDice } = require("./resourceDelta");

// field -> { rateField (db/lib/production.js key), specialistSlug, verb }.
// Hunting isn't in this map — it's dice-based and handled separately below.
const FIELD_INFO = {
  farm: { rateField: "farming", specialistSlug: LABORER_FARMING_SLUG, verb: "farmed" },
  fish: { rateField: "fishing", specialistSlug: LABORER_FISHING_SLUG, verb: "fished" },
  herd: { rateField: "herding", specialistSlug: LABORER_HERDING_SLUG, verb: "herded" },
  hunt: { verb: "hunted" },
};

// /labor: auto-generates a Routine, non-Opposed Move for a player's own
// Farming/Fishing/Herding/Hunting production, reading their tags to pick the
// right tier instead of them having to look it up and type a flat number.
// Reuses the same turn-economy checks as actionSubmission.js/location.js's
// performMove (one Action per character per open Turn), and the same
// auto-resolved-Action shape as performMove's zone-change Move — but leaves
// moveReviewStatus at its schema default (OPEN) rather than SOLVED, since
// this is a real Move a GM should still review, just without the tedious
// player-side DM dance for something this mechanical.
// Returns { ok: true, resourceDelta, diceExpression } or { ok: false, reason }.
async function performLabor(character, field) {
  const info = FIELD_INFO[field];
  if (!info) return { ok: false, reason: "Unknown field." };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return { ok: false, reason: "No turn is currently open." };

  const existing = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (existing) return { ok: false, reason: "You've already acted this turn." };

  const characterTags = await prisma.characterTag.findMany({
    where: { characterId: character.id },
    include: { tag: true },
  });
  const ownedSlugs = new Set(characterTags.map((ct) => ct.tag.slug).filter(Boolean));

  let resourceDelta;
  let resourceDiceExpression = null;
  let resourceDiceRoll = null;
  let diceSum = null;

  if (field === "hunt") {
    const tier = ownedSlugs.has(HUNTER_SLUG) ? "specialist" : "base";
    resourceDiceExpression = HUNTING_DICE[tier];
    const diceResult = rollResourceDice(resourceDiceExpression);
    resourceDelta = diceResult.value;
    resourceDiceRoll = diceResult.value;
    diceSum = diceResult.sum;
  } else {
    const tier = ownedSlugs.has(info.specialistSlug) ? "specialist" : ownedSlugs.has(LABORER_SLUG) ? "laborer" : "base";
    const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
    resourceDelta = computeRate(info.rateField, tier, config?.productionCoefficient ?? 1);
  }

  const description = `${character.name} ${info.verb} (Auto-generated).`;

  await prisma.action.create({
    data: {
      characterId: character.id,
      turnId: openTurn.id,
      type: "MOVE",
      status: "CONFIRMED",
      moveKind: "ROUTINE",
      opposed: false,
      confirmedAt: new Date(),
      description,
      resourceDelta,
      resourceDiceExpression,
      resourceDiceRoll,
      zoneId: character.zoneId ?? null,
      gmNotes: "auto:labor",
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: character.discordUserId,
      actionType: "move_confirmed",
      targetCharacterId: character.id,
      details: { field, resourceDelta, resourceDiceExpression, source: "labor_command" },
    },
  });

  return { ok: true, resourceDelta, resourceDiceExpression, diceSum };
}

module.exports = { performLabor };
