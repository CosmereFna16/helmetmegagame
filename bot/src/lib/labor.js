const { prisma, FIELD_INFO, resolveLaborRate, rollRate } = require("@lifeweb/db");

// /hunt, /fish, /farm, /herd: auto-generates a Routine, non-Opposed Move for
// a player's own production, reading their tags to pick the right tier and
// their location to decide whether the activity is possible at all, instead
// of them having to look either up and type a flat number.
//
// Reuses the same turn-economy checks as the Move modal/location.js's
// performMove (one Action per character per open Turn), and the same
// auto-resolved-Action shape as performMove's zone-change Move — but leaves
// moveReviewStatus at its schema default (OPEN) rather than SOLVED, since
// this is a real Move a GM should still review, just without the tedious
// player-side DM dance for something this mechanical.
//
// Every failure path returns before action.create, so a refusal never costs
// the player their turn — the point of checking the location here rather
// than letting the Move land and pay out zero.
// Returns { ok: true, resourceDelta, tier, min, max } or { ok: false, reason }.
async function performLabor(character, field) {
  const info = FIELD_INFO[field];
  if (!info) return { ok: false, reason: "Unknown activity." };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return { ok: false, reason: "No turn is currently open." };

  const existing = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (existing) return { ok: false, reason: "You've already acted this turn." };

  const rate = await resolveLaborRate(prisma, character.id, field);
  if (!rate.ok) return rate;

  const resourceDelta = rollRate(rate);
  const resourceRollExpression = rate.expression;
  const description = `${character.name} ${info.verb} (Auto-generated).`;

  // Labor is a Routine, so it follows the Routine rule: the roll happens now,
  // the row enters the queue already PASSED, and the payout — like every Move
  // payout since the staged-arbitration rework — lands at the turn-end push
  // (db/lib/stagedPush.js). See bot/src/lib/moveConfirm.js.
  //
  // The findFirst above is the fast path and the friendly message; this is the
  // one that actually holds. @@unique([characterId, turnId]) rejects the second
  // write when two submissions race the gap between that check and this create
  // — a double-click, or Discord retrying the interaction at rollover — so the
  // player is told they already acted instead of being paid twice.
  try {
    await prisma.action.create({
      data: {
        characterId: character.id,
        turnId: openTurn.id,
        type: "MOVE",
        status: "CONFIRMED",
        moveKind: "ROUTINE",
        moveReviewStatus: "PASSED",
        opposed: false,
        confirmedAt: new Date(),
        description,
        resourceDelta,
        resourceRollExpression,
        resourceRollValue: resourceDelta,
        zoneId: character.zoneId ?? null,
        gmNotes: "auto:labor",
      },
    });
  } catch (err) {
    if (err.code === "P2002") return { ok: false, reason: "You've already acted this turn." };
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: character.discordUserId,
      actionType: "move_confirmed",
      targetCharacterId: character.id,
      details: { field, resourceDelta, resourceRollExpression, tier: rate.tier, source: "labor_command" },
    },
  });

  return { ok: true, resourceDelta, tier: rate.tier, min: rate.min, max: rate.max };
}

module.exports = { performLabor };
