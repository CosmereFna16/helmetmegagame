const { prisma } = require("@lifeweb/db");
const { gambitModifiers, gambitModifierTotal } = require("@lifeweb/db/lib/gambitModifier");
const { rollDie } = require("@lifeweb/db/lib/moveEffects");
const { formatLaborBonusNote } = require("@lifeweb/db/lib/laborAccess");
const { rollResourceRange, formatRangeExpression } = require("./resourceDelta");

// Locking in a Move, lifted out of the old DM Confirm button so the modal
// submit path and anything later can share one implementation.
//
// Nothing pays here any more. A Routine still enters the queue PASSED —
// needing a GM only if one disagrees — but its resources, like everything
// else a Move is worth, land at the turn-end staged push
// (db/lib/stagedPush.js). The dice and the resource roll (the Labor
// checkbox's tag-scaled range, resolved at submit — see
// db/lib/laborAccess.js) both still happen NOW, but only the resource roll
// is shown now. The Gambit die is rolled and stored here so the GM desk has
// it from the moment of submit, but it's withheld from the player until
// Moves lock (web/app/(app)/character/page.js, gated on moveWindow.locked) —
// finding out how the die fell shouldn't color how the rest of the turn gets
// played. The reveal itself is a DM sent from the turn-end staged push
// (db/lib/stagedPush.js's gambitRollNotices).
//
// `action` must come in with its character, that character's tags, AND
// hungerStreak loaded: Hunger is an ordinary Status tag, but its penalty
// escalates with the streak (a Character column, not a tag), so the Gambit
// modifier needs both (db/lib/gambitModifier.js).
//
// `laborBonus` is the Butcher +2 the submit path already resolved
// (db/lib/laborAccess.js). It has to be passed in rather than read off the
// row: the Action stores only the finished range, so nothing here could tell
// a bonused 9-11 from a plain one. Optional — a caller with no Labor in hand
// omits it and the line simply doesn't appear.
//
// Returns { updated, lines } — the resolved row, and the summary the player
// is shown. It writes its own AuditLog row but sends nothing.
async function confirmMove(action, actorDiscordUserId, { laborBonus = 0 } = {}) {
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
    // No number here on purpose — see the header comment. The DM at Moves-lock
    // is the reveal.
    lines.push("🎲 *The die is cast. You'll see how it fell once Moves lock.*");
  }
  if (rollResult) {
    lines.push(
      `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${rollResult.value > 0 ? "+" : ""}${rollResult.value} ⬢`,
    );
    // The range above already has the bonus baked in, so say so — otherwise a
    // Butcher sees 9-11 and has no way to know it isn't the plain 7-9.
    const bonusNote = formatLaborBonusNote(laborBonus);
    if (bonusNote) lines.push(bonusNote);
  }
  lines.push("» *Locked in. Results land when the turn ends.*");

  return { updated, lines };
}

module.exports = { confirmMove };
