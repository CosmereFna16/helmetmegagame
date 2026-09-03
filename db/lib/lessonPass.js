// The per-turn lesson pass, run from db/index.js#resolveNeeds() between
// "defaultMoves" and "stagedPush" (docs/systemdocs/LESSONS.md).
//
// Every ACCEPTED lesson on the closing turn is rolled here: the learner's
// stored Gambit die plus its modifier against the offer's threshold. A pass
// grants the skill (TagSource LESSON) and drops the tiers below it; either
// way the learner's Action is SOLVED with a result line, so the staged push
// closes it as adjudicated rather than silently. Every PENDING offer on the
// turn — lesson or bind — expires.
//
// Returns Discord work as data for advanceTurn()'s runSideEffects(), never
// sends it. Returns an object even when idle: db/index.js treats null as a
// failed pass to retry.
const { addToStack, replaceLowerTiers } = require("./tagWrites");
const { LESSON_THRESHOLD } = require("./constants");

function rollLine(turn, action) {
  const mod = action.diceModifier ?? 0;
  const total = (action.diceRoll ?? 0) + mod;
  const die = mod ? `**${action.diceRoll}** (${mod > 0 ? `+${mod}` : mod}) → **${total}**` : `**${action.diceRoll}**`;
  return { text: `🎲 Your Gambit for turn ${turn.number}: ${die}`, total };
}

async function runLessonPass(prisma, turn) {
  const idle = { turnNumber: turn.number, resolved: 0, learned: 0, expired: 0, failed: 0, dms: [] };
  const [accepted, pending] = await Promise.all([
    prisma.offer.findMany({ where: { kind: "LESSON", status: "ACCEPTED", turnId: turn.id }, include: { tag: true } }),
    prisma.offer.findMany({ where: { status: "PENDING", turnId: turn.id }, include: { tag: true } }),
  ]);
  if (accepted.length === 0 && pending.length === 0) return idle;

  const ids = new Set();
  for (const o of [...accepted, ...pending]) {
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
    return c?.discordUserId ? { discordUserId: c.discordUserId, content } : null;
  };

  const dms = [];
  let resolved = 0;
  let learned = 0;
  let failed = 0;

  for (const offer of accepted) {
    try {
      const outcome = await prisma.$transaction(async (tx) => {
        const action = offer.learnerActionId
          ? await tx.action.findUnique({ where: { id: offer.learnerActionId } })
          : null;
        // A GM rejected the learner's Move; the lesson went with it.
        if (!action) {
          await tx.offer.update({
            where: { id: offer.id },
            data: { status: "CANCELLED", resolvedAt: new Date(), outcome: { cancelledBy: "missing_action" } },
          });
          return null;
        }
        // A GM already wrote a result. Theirs stands; the die does not grant.
        if (action.moveReviewStatus === "SOLVED") {
          await tx.offer.update({
            where: { id: offer.id },
            data: { status: "RESOLVED", resolvedAt: new Date(), outcome: { gmDecided: true } },
          });
          return null;
        }
        const learner = people.get(offer.learnerId);
        const { text, total } = rollLine(turn, action);
        const threshold = offer.threshold ?? LESSON_THRESHOLD;
        const succeeded = learner?.status === "ALIVE" && total >= threshold;
        const skill = offer.tag?.name ?? "the skill";
        let replaced = [];
        if (succeeded && offer.tag) {
          const already = await tx.characterTag.findUnique({
            where: { characterId_tagId: { characterId: offer.learnerId, tagId: offer.tagId } },
          });
          if (!already) {
            replaced = await replaceLowerTiers(tx, offer.learnerId, offer.tagId);
            await addToStack(tx, offer.learnerId, offer.tagId, 1, { source: "LESSON" });
          }
        }
        const resultMessage = succeeded
          ? `Learned ${skill} from ${nameOf(offer.teacherId)} (${total} vs ${threshold}). ‡`
          : `Failed to learn ${skill} from ${nameOf(offer.teacherId)} (${total} vs ${threshold}). ‡`;
        await tx.action.update({
          where: { id: action.id },
          data: { moveReviewStatus: "SOLVED", reviewedAt: new Date(), resultMessage },
        });
        await tx.offer.update({
          where: { id: offer.id },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            outcome: { diceRoll: action.diceRoll, diceModifier: action.diceModifier ?? 0, total, threshold, succeeded, replaced },
          },
        });
        return { text, succeeded, skill, replaced };
      });
      if (!outcome) continue;
      resolved += 1;
      if (outcome.succeeded) learned += 1;
      const teacherName = nameOf(offer.teacherId);
      const learnerName = nameOf(offer.learnerId);
      const learnerDm = dmTo(
        offer.learnerId,
        outcome.succeeded
          ? `${outcome.text} → you picked up **${outcome.skill}** from ${teacherName}. ‡`
          : `${outcome.text} → you didn't get the hang of **${outcome.skill}** this time. ‡`,
      );
      const teacherDm = dmTo(
        offer.teacherId,
        outcome.succeeded
          ? `${learnerName} picked up **${outcome.skill}**. ‡`
          : `${learnerName} didn't get the hang of **${outcome.skill}**. ‡`,
      );
      for (const dm of [learnerDm, teacherDm]) if (dm) dms.push(dm);
    } catch (err) {
      failed += 1;
      console.error(`Lesson ${offer.id} failed to resolve:`, err);
    }
  }

  let expired = 0;
  for (const offer of pending) {
    try {
      const claim = await prisma.offer.updateMany({
        where: { id: offer.id, status: "PENDING" },
        data: { status: "EXPIRED", resolvedAt: new Date() },
      });
      if (claim.count === 0) continue;
      expired += 1;
      const other = nameOf(offer.responderId);
      const content =
        offer.kind === "BIND"
          ? `${other} never answered, and the turn is over. ‡`
          : offer.initiatorId === offer.learnerId
            ? `${other} never answered your offer to learn ${offer.tag?.name ?? "a skill"}. Your Move went unspent. ‡`
            : `${other} never answered your offer to teach ${offer.tag?.name ?? "a skill"}. Your Move went unspent. ‡`;
      const dm = dmTo(offer.initiatorId, content);
      if (dm) dms.push(dm);
    } catch (err) {
      failed += 1;
      console.error(`Offer ${offer.id} failed to expire:`, err);
    }
  }

  return { turnNumber: turn.number, resolved, learned, expired, failed, dms };
}

module.exports = { runLessonPass };
