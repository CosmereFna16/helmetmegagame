const { prisma } = require("@lifeweb/db");
const { gambitModifiers, gambitModifierTotal } = require("@lifeweb/db/lib/gambitModifier");
const { rollDie } = require("@lifeweb/db/lib/moveEffects");
const { formatLaborBonusNote } = require("@lifeweb/db/lib/laborAccess");
const { rollResourceRange, formatRangeExpression } = require("./resourceDelta");

// Locks in a Move for the modal submit path (and anything later that needs
// the same flow). Resources land at the turn-end staged push
// (db/lib/stagedPush.js), not here. The Gambit die is rolled and stored now
// so the GM desk has it immediately, but withheld from the player until the
// turn-end reveal DM (stagedPush.js's gambitRollNotices) — seeing it early
// shouldn't color how the rest of the turn gets played.
//
// `action` must come in with its character, tags, AND hungerStreak loaded
// (db/lib/gambitModifier.js needs both). `laborRate` is the resolver's whole
// return value from the submit path (db/lib/laborAccess.js), carried because
// the Action stores only the finished range and not which tools made it that
// size. Returns { updated, lines }; writes its own AuditLog row but sends
// nothing.
async function confirmMove(action, actorDiscordUserId, { laborRate = null } = {}) {
  const diceRoll = action.moveKind === "GAMBIT" ? rollDie() : null;
  // Only a Gambit rolls, so only a Gambit can carry a modifier. diceRoll stays
  // the RAW roll and the SUM of every contributor (today just Hunger, scaled
  // to the streak) is stored beside it — see the Action.diceModifier comment in
  // schema.prisma. The per-contributor breakdown is display-only, below.
  const modifiers =
    diceRoll != null ? gambitModifiers(action.character.tags, { hungerStreak: action.character.hungerStreak }) : [];
  const diceModifier =
    diceRoll != null ? gambitModifierTotal(action.character.tags, { hungerStreak: action.character.hungerStreak }) : null;
  // Null for a row written before ranges existed (a leftover "1d4*3"), which
  // then confirms on its flat delta alone rather than throwing.
  const rollResult = action.resourceRollExpression ? rollResourceRange(action.resourceRollExpression) : null;

  const resourceDelta = rollResult
    ? (action.resourceDelta ?? 0) + rollResult.value
    : (action.resourceDelta ?? null);

  const isRoutine = action.moveKind === "ROUTINE";

  const updated = await prisma.action.update({
    where: { id: action.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
      ...(diceRoll != null ? { diceRoll, diceModifier } : {}),
      ...(rollResult ? { resourceRollValue: rollResult.value, resourceDelta } : {}),
      // PASSED means "no GM needs to touch this", not "paid" — appliedEffects
      // stays null until the staged push claims it at rollover.
      ...(isRoutine ? { moveReviewStatus: "PASSED" } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType: "move_confirmed",
      targetCharacterId: action.characterId,
      details: {
        actionId: action.id,
        diceRoll,
        diceModifier,
        // The only place the breakdown survives — the column stores the sum.
        diceModifiers: modifiers,
        resourceRollValue: rollResult?.value ?? null,
      },
    },
  });

  const lines = [
    `» ${action.description}`,
    `Kind: **${action.moveKind === "GAMBIT" ? "Gambit" : "Routine"}**`,
  ];
  if (diceRoll != null) {
    // No number here on purpose — see the header comment. The reveal is the DM
    // at the turn-end staged push (db/lib/stagedPush.js's gambitRollNotices),
    // which lands beside the adjudication DMs that say what the roll did.
    lines.push("🎲 *The die is cast. You'll see how it fell when the turn ends.*");
  }
  if (rollResult) {
    lines.push(
      `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${rollResult.value > 0 ? "+" : ""}${rollResult.value} ⬢`,
    );
    // The range above already has the tools baked in, so say so — otherwise a
    // hunter with a Longbow sees 3-12 and has no way to know it isn't the
    // plain 0-9.
    const bonusNote = laborRate ? formatLaborBonusNote(laborRate) : null;
    if (bonusNote) lines.push(bonusNote);
  }
  lines.push("» *Locked in. Results land when the turn ends.*");

  return { updated, lines };
}

module.exports = { confirmMove };
