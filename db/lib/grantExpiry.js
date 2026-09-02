// Expiry for a tag being GRANTED, as opposed to expiry being displayed.
//
// THE BUG THIS EXISTS FOR. `CharacterTag.expiresTurn` is an absolute turn
// number, and both resolveNeeds()'s sweep and tagExpiryPass match on
// `expiresTurn <= turn.number`. A NULL never matches either, so a timed tag
// granted with a null expiry is permanent — it never ticks down and never
// progresses down its expiresInto chain. Silently: nothing logs it, nothing
// shows it, and the tag looks ordinary on the sheet forever.
//
// That is not hypothetical. One live row reached production this way: a
// minor-wound (3 turns, chains to infected) granted at 2026-08-31T05:00:00.881Z
// — about a second BEFORE that turn's row existed.
//
// HOW THE WINDOW OPENS. advanceTurn() flips the open turn to RESOLVED before
// running resolveNeeds(), and only creates the next turn after every pass has
// finished. In between, nothing has `status: "OPEN"`, so every grant path's
// `findFirst({ where: { status: "OPEN" } })` returns null and turnFormat's
// expiryFor — correctly, for what it is — returns null with it. The same state
// also persists for HOURS after a wedged advance (a turn left RESOLVED with
// needsResolvedAt null), so this is not only a one-second race.
//
// WHAT THIS DOES INSTEAD. Falls back to the turn about to open, which is what a
// mid-advance grant actually means: the tag's first live turn is the next one,
// the same reasoning stagedPush.js uses when it hands down `turn.number + 1`.
// It never throws. A turn-engine pass cannot reach this function anyway (they
// all call expiryFrom directly, or hold an already-open turn), but a grant path
// that refuses mid-advance would just move the failure onto a player, and the
// original sin here was silence rather than strictness — so it logs instead.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not touch the untimed case, where
// null is simply correct, and it does not touch pre-launch, where there is
// genuinely no turn to count from. See the `latest` check below for why "no
// Turn rows at all" is a sound signal for the second one.
//
// Takes `db` as a parameter — a PrismaClient or a tx client — for the same
// reason db/lib/dm.js does, and it is NOT exported from the @lifeweb/db barrel.
// It could not live in db/lib/turnFormat.js: that module is re-exported by
// web/lib/turnFormat.js and is kept dependency-free precisely so client
// components can import it, and this needs a query.
const { expiryFrom } = require("./turnFormat");

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
  // expiry is right — this is the case turnFormat's "before the game opens
  // there is no turn to count from" describes, and character creation grants
  // starting tags here. It is a sound test because there is no launch flag to
  // read (GameConfig has no startedAt; openToPlayers is a joining switch) and
  // because a Restart Game wipe deletes every turn AND opens a fresh Turn 1 in
  // the same flow — so "zero turns" only ever means a fresh database.
  if (!latest) return null;

  const expiresTurn = expiryFrom(latest.number + 1, duration);

  // The whole point. A deferred stamp is a correct-enough clock, but a silent
  // one would repeat the original mistake in a quieter key: repeated rows here
  // mean an advance is wedged, not that one player got unlucky with timing.
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
