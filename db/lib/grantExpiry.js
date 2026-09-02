// Expiry for a tag being GRANTED, as opposed to expiry being displayed.
//
// `CharacterTag.expiresTurn` is an absolute turn number; both resolveNeeds()'s
// sweep and tagExpiryPass match on `expiresTurn <= turn.number`, so a NULL
// never matches and a timed tag granted with a null expiry becomes permanent
// and silent. advanceTurn() leaves nothing with `status: "OPEN"` between
// flipping the old turn RESOLVED and creating the next (also true for hours
// after a wedged advance), so any grant path during that window must use
// expiryForGrant, not turnFormat's expiryFor, or it hits this bug.
const { expiryFrom } = require("./turnFormat");

// Falls back to the turn about to open when no turn is OPEN — the tag's first
// live turn is the next one — and logs a `grant_expiry_deferred` audit row so
// a wedged advance shows up as repeated rows rather than staying silent.
// Takes `db` (PrismaClient or tx client) and is NOT exported from the barrel,
// for the same reasons as db/lib/dm.js.
async function expiryForGrant(db, tag, openTurn, context = {}) {
  const duration = tag?.defaultDurationTurns ?? 0;

  // The overwhelmingly common path: a turn is open, so this is exactly
  // expiryFor and costs no extra query.
  if (openTurn) return expiryFrom(openTurn.number, duration);

  // An untimed tag has no clock to lose. Checked before the query so a grant
  // of an ordinary item mid-advance stays a single write.
  if (!duration) return null;

  const latest = await db.turn.findFirst({ orderBy: { number: "desc" }, select: { number: true } });

  // No Turn row has ever existed, so the game has not been opened and a null
  // expiry is right (character creation grants starting tags here). Sound
  // test because there's no launch flag to read, and a Restart Game wipe
  // deletes every turn and opens a fresh Turn 1 in the same flow — so "zero
  // turns" only ever means a fresh database.
  if (!latest) return null;

  const expiresTurn = expiryFrom(latest.number + 1, duration);

  // Repeated rows here mean an advance is wedged, not that one player got
  // unlucky with timing.
  await db.auditLog
    .create({
      data: {
        actorDiscordUserId: "system",
        actionType: "grant_expiry_deferred",
        targetCharacterId: context.characterId ?? null,
        details: {
          tag: tag?.slug ?? tag?.id ?? null,
          durationTurns: duration,
          latestTurnNumber: latest.number,
          expiresTurn,
          where: context.where ?? null,
        },
      },
    })
    .catch((err) => console.error("grant_expiry_deferred audit log failed:", err));

  return expiresTurn;
}

module.exports = { expiryForGrant };
