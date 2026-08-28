const { prisma } = require("@lifeweb/db");
const {
  gambitModifiers,
  gambitModifierTotal,
  formatGambitModifiers,
} = require("@lifeweb/db/lib/gambitModifier");
const { rollDie } = require("@lifeweb/db/lib/moveEffects");
const { rollResourceRange, formatRangeExpression } = require("./resourceDelta");

// Locking in a Move, lifted out of the old DM Confirm button so the modal
// submit path and anything later can share one implementation.
//
// Nothing pays here any more. A Routine still enters the queue PASSED —
// needing a GM only if one disagrees — but its resources, like everything
// else a Move is worth, land at the turn-end staged push
// (db/lib/stagedPush.js). The dice and the resource roll (the Labor
// checkbox's tag-scaled range, resolved at submit — see
// db/lib/laborAccess.js) still happen NOW, so the player sees their numbers
// the moment they lock in; only the payout defers.
//
// `action` must come in with its character, that character's tags, AND
// hungerStreak loaded: Hunger is an ordinary Status tag, but its penalty
// escalates with the streak (a Character column, not a tag), so the Gambit
// modifier needs both (db/lib/gambitModifier.js).
//
// Returns { updated, lines } — the resolved row, and the summary the player
// is shown. It writes its own AuditLog row but sends nothing.
async function confirmMove(action, actorDiscordUserId) {
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
    lines.push(
      // Keyed on modifiers.length, not diceModifier, so a contributor worth 0
      // would still show its work rather than pretend nothing applied.
      modifiers.length
        ? `🎲 **${diceRoll}** ${formatGambitModifiers(modifiers)} → **${diceRoll + diceModifier}**`
        : `🎲 **${diceRoll}**`,
    );
  }
  if (rollResult) {
    lines.push(
      `**Resource roll (${formatRangeExpression(action.resourceRollExpression)}):** ${rollResult.value > 0 ? "+" : ""}${rollResult.value} ⬢`,
    );
  }
  lines.push("» *Locked in. Results land when the turn ends.*");

  return { updated, lines };
}

module.exports = { confirmMove };
