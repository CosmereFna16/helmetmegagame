// The per-turn confession pass, run from db/index.js between "lessons" and
// "stagedPush" (docs/systemdocs/CONFESSION.md).
//
// Every ACCEPTED confession on the closing turn is rolled here: the
// penitent's stored Gambit die plus its modifier against the offer's
// threshold. A pass drops the tag; either way the penitent's Action is SOLVED
// with a result line, so the staged push closes it as adjudicated rather than
// silently.
//
// PENDING confessions are NOT expired here — db/lib/lessonPass.js already
// expires every PENDING offer on the turn regardless of kind, and running two
// passes at the same rows would be a race for no gain. Its expiry DM has a
// CONFESSION branch.
//
// Returns Discord work as data for advanceTurn()'s runSideEffects(), never
// sends it. Returns an object even when idle: db/index.js treats null as a
// failed pass to retry.
const { dropCharacterTag } = require("./tagWrites");
const { CONFESSION_THRESHOLD } = require("./constants");

function rollLine(turn, action) {
  const mod = action.diceModifier ?? 0;
  const total = (action.diceRoll ?? 0) + mod;
  const die = mod
    ? `**${action.diceRoll}** (${mod > 0 ? `+${mod}` : mod}) → **${total}**`
    : `**${action.diceRoll}**`;
  return { text: `🎲 Your Gambit for turn ${turn.number}: ${die}`, total };
}

async function runConfessionPass(prisma, turn) {
  const idle = {
    turnNumber: turn.number,
    resolved: 0,
    absolved: 0,
    failed: 0,
    dms: [],
  };
  const accepted = await prisma.offer.findMany({
    where: { kind: "CONFESSION", status: "ACCEPTED", turnId: turn.id },
    include: { tag: true },
  });
  if (accepted.length === 0) return idle;

  const ids = new Set();
  for (const o of accepted) {
    ids.add(o.initiatorId);
    ids.add(o.responderId);
    if (o.teacherId) ids.add(o.teacherId);
    if (o.learnerId) ids.add(o.learnerId);
  }
  const people = new Map(
    (
      await prisma.character.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, name: true, discordUserId: true, status: true },
      })
    ).map((c) => [c.id, c]),
  );
  const nameOf = (id) => people.get(id)?.name ?? "someone";
  const dmTo = (id, content) => {
    const c = people.get(id);
    return c?.discordUserId
      ? { discordUserId: c.discordUserId, content }
      : null;
  };

  const dms = [];
  let resolved = 0;
  let absolved = 0;
  let failed = 0;

  for (const offer of accepted) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const action = offer.learnerActionId
          ? await tx.action.findUnique({ where: { id: offer.learnerActionId } })
          : null;
        // A GM rejected the penitent's Move; the confession went with it.
        if (!action) {
          await tx.offer.update({
            where: { id: offer.id },
            data: {
              status: "CANCELLED",
              resolvedAt: new Date(),
              outcome: { cancelledBy: "missing_action" },
            },
          });
          return null;
        }
        // A GM already wrote a result. Theirs stands; the die does not lift.
        if (action.moveReviewStatus === "SOLVED") {
          await tx.offer.update({
            where: { id: offer.id },
            data: {
              status: "RESOLVED",
              resolvedAt: new Date(),
              outcome: { gmDecided: true },
            },
          });
          return null;
        }
        const penitent = people.get(offer.learnerId);
        const { text, total } = rollLine(turn, action);
        const threshold = offer.threshold ?? CONFESSION_THRESHOLD;
        const succeeded = penitent?.status === "ALIVE" && total >= threshold;
        const burden = offer.tag?.name ?? "the burden";
        // A stack of one is the only shape a psychological tag comes in, but
        // dropCharacterTag with no quantity clears the row either way, and it
        // is a no-op if they already shed it some other way this turn.
        if (succeeded && offer.tagId) {
          await dropCharacterTag(tx, offer.learnerId, offer.tagId);
        }
        const resultMessage = succeeded
          ? `Confessed to ${nameOf(offer.teacherId)}; ${burden} lifted (${total} vs ${threshold}). ‡`
          : `Confessed to ${nameOf(offer.teacherId)}; ${burden} stayed (${total} vs ${threshold}). ‡`;
        await tx.action.update({
          where: { id: action.id },
          data: {
            moveReviewStatus: "SOLVED",
            reviewedAt: new Date(),
            resultMessage,
          },
        });
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            outcome: {
              diceRoll: action.diceRoll,
              diceModifier: action.diceModifier ?? 0,
              total,
              threshold,
              succeeded,
            },
          },
        });
        return { text, succeeded, burden };
      });
      if (!outcome) continue;
      resolved += 1;
      if (outcome.succeeded) absolved += 1;

      const penitentDm = dmTo(
        offer.learnerId,
        outcome.succeeded
          ? `${outcome.text} → **${outcome.burden}** is off you. ‡`
          : `${outcome.text} → **${outcome.burden}** has not let go of you. ‡`,
      );
      // The chaplain is told whether it took, and still never told what it
      // was. They heard it in the fiction; the sheet does not repeat it.
      const chaplainDm = dmTo(
        offer.teacherId,
        outcome.succeeded
          ? `${nameOf(offer.learnerId)} left lighter than they came. ‡`
          : `${nameOf(offer.learnerId)} confessed, but it did not take. ‡`,
      );
      for (const dm of [penitentDm, chaplainDm]) if (dm) dms.push(dm);
    } catch (err) {
      failed += 1;
      console.error(`Confession ${offer.id} failed to resolve:`, err);
    }
  }

  return { turnNumber: turn.number, resolved, absolved, failed, dms };
}

module.exports = { runConfessionPass };
