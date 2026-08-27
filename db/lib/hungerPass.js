// Per-turn Hunger upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
//
// At the close of every turn each ALIVE character is checked, in this order:
//   1. Holds Hungerless -> skipped entirely. No resource taken, no Hunger,
//                          streak reset to 0 (can't go hungry, so a lingering
//                          streak from before they had this tag is stale).
//   2. Holds Ate Meal   -> shielded from Hunger, the tag is consumed
//                          (whether or not they were broke), NO ⬢ is
//                          taken, and the streak resets to 0. The meal was
//                          already paid for when it was cooked — 2 ⬢ for a
//                          Fine, 3 ⬢ for a Lavish — so billing the upkeep on
//                          top made eating strictly worse than the 1 ⬢ it
//                          saves. Eating settles the turn's upkeep AND the
//                          streak; neither comes on top of it.
//   3. Check FIRST, then pay: at 0 ⬢ you go Hungry, owe nothing, and the
//      streak increments; at 1+ ⬢ you pay 1, stay fed, and the streak resets
//      to 0. So 1 ⬢ always buys a fed turn, and resources can never go
//      negative — the clamp is structural, not a Math.max.
//
// "Structural" only holds if the check and the pay are the same statement,
// which they were not: the balance was read in the bulk query above and the
// decrement issued some milliseconds later, so anyone who spent their last ⬢
// in between went to −1. Turn rollover is exactly when players are most
// active. The `gte: 1` on the decrement's where clause is what makes the
// sentence above true; a racer who slipped to 0 simply isn't matched and eats
// free that turn, which is the safe direction to miss in.
//
// The streak (Character.hungerStreak) is what lets the penalty escalate
// instead of staying a flat -1: db/lib/gambitModifier.js reads it and clamps
// at HUNGER_STREAK_CAP. Reaching the cap also grants `dying`, permanently
// (same as every other terminal tag chain — see tagExpiryPass.js's "NOTHING
// HERE KILLS ANYONE"). A GM confirms the death by hand from there; this pass
// only ever grants the tag, and skipDuplicates means re-granting it on a
// later starved turn is a harmless no-op.
//
// Shaped for 100+ players: two reads and four bulk writes regardless of
// headcount, and no network call at all — the per-player "you went hungry"
// DMs are returned as a list for advanceTurn() to send later.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { HUNGER_SLUG, HUNGERLESS_SLUG, ATE_MEAL_SLUG, DYING_SLUG } = require("./constants");

const HUNGER_STREAK_CAP = 6;

// `streak` is the count AFTER this turn's increment, already clamped to
// HUNGER_STREAK_CAP — the same number gambitModifier.js applies, so the DM
// never names a bigger penalty than the one actually in effect.
function hungerDm(streak) {
  return `You went hungry this turn. −${streak} to Gambits.`;
}

const DYING_DM =
  "You haven't eaten in six turns straight. Your body is giving out — you're Dying. A GM will decide what happens next.";

async function runHungerPass(prisma, turn) {
  const tags = await prisma.tag.findMany({
    where: { slug: { in: [HUNGER_SLUG, HUNGERLESS_SLUG, ATE_MEAL_SLUG, DYING_SLUG] } },
    select: { id: true, slug: true, defaultDurationTurns: true },
  });

  const hungerTag = tags.find((t) => t.slug === HUNGER_SLUG);
  if (!hungerTag) {
    // Catalog not synced — refuse to half-run rather than silently charge
    // everyone with no Hunger to hand out.
    console.error(`Hunger pass skipped: no "${HUNGER_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }
  const hungerlessId = tags.find((t) => t.slug === HUNGERLESS_SLUG)?.id ?? null;
  const ateMealId = tags.find((t) => t.slug === ATE_MEAL_SLUG)?.id ?? null;
  const dyingId = tags.find((t) => t.slug === DYING_SLUG)?.id ?? null;
  if (!dyingId) {
    console.error(`Hunger pass: no "${DYING_SLUG}" tag — run npm run db:sync-tags. Streak cap won't grant it.`);
  }

  const gateIds = [hungerlessId, ateMealId].filter(Boolean);
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      discordUserId: true,
      resources: true,
      hungerStreak: true,
      // Only the two gating tags come back, not the whole tag set — this is
      // the query that would otherwise scale badly at 100+ characters.
      tags: { where: { tagId: { in: gateIds } }, select: { tagId: true } },
    },
  });

  const toPay = [];
  const toStarve = [];
  const shieldedIds = [];
  const toFeedIds = []; // streak -> 0: paid, shielded, or hungerless
  let skipped = 0;

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tagId));

    if (hungerlessId && held.has(hungerlessId)) {
      skipped += 1;
      toFeedIds.push(character.id);
      continue;
    }

    if (ateMealId && held.has(ateMealId)) {
      shieldedIds.push(character.id);
      toFeedIds.push(character.id);
      continue;
    }

    if (character.resources >= 1) {
      toPay.push(character.id);
      toFeedIds.push(character.id);
    } else {
      toStarve.push(character);
    }
  }

  // A Hunger granted while closing turn N gets expiresTurn N+1 — the usual
  // `turn.number + defaultDurationTurns` arithmetic. It's
  // live for the whole of turn N+1 and deleted by resolveNeeds()' sweep when
  // N+1 closes. That's also what makes Ate Meal's "won't go hungry next turn"
  // copy literally true: eaten during turn N, consumed at N's close, it
  // suppresses the tag that would have bitten during N+1.
  const expiresTurn = turn.number + (hungerTag.defaultDurationTurns ?? 1);

  // Computed in JS off the streak already loaded above, not off a DB return
  // value — an `increment` in the same transaction wouldn't hand back the
  // new value, and this pass needs it now to decide who crosses the cap and
  // what to put in each DM.
  const starvedNotices = toStarve.map((character) => ({
    discordUserId: character.discordUserId,
    streak: Math.min(character.hungerStreak + 1, HUNGER_STREAK_CAP),
    justDied: dyingId != null && character.hungerStreak + 1 === HUNGER_STREAK_CAP,
  }));
  const newlyDyingIds = dyingId
    ? toStarve.filter((character) => character.hungerStreak + 1 >= HUNGER_STREAK_CAP).map((character) => character.id)
    : [];

  // One transaction so a character can never be charged without their Ate
  // Meal being consumed, or land at the streak cap without Dying landing with
  // it. Empty `in: []` matches nothing and createMany with [] is a no-op, so
  // none of these need a guard.
  const [charged] = await prisma.$transaction([
    prisma.character.updateMany({
      where: { id: { in: toPay }, resources: { gte: 1 } },
      data: { resources: { decrement: 1 } },
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: shieldedIds }, tagId: ateMealId ?? "" },
    }),
    prisma.characterTag.createMany({
      data: toStarve.map((character) => ({
        characterId: character.id,
        tagId: hungerTag.id,
        source: "EVENT",
        expiresTurn,
      })),
      // Belt-and-braces against @@unique([characterId, tagId]) — the expiry
      // sweep in resolveNeeds() runs first and should already have cleared
      // last turn's Hunger.
      skipDuplicates: true,
    }),
    prisma.character.updateMany({
      where: { id: { in: toFeedIds } },
      data: { hungerStreak: 0 },
    }),
    prisma.character.updateMany({
      where: { id: { in: toStarve.map((character) => character.id) } },
      data: { hungerStreak: { increment: 1 } },
    }),
    ...(newlyDyingIds.length && dyingId
      ? [
          prisma.characterTag.createMany({
            data: newlyDyingIds.map((characterId) => ({
              characterId,
              tagId: dyingId,
              source: "EVENT",
              expiresTurn: null, // permanent, like every other terminal chain
            })),
            // A character can hit the cap more than one turn running, since
            // the streak keeps counting past it — this keeps that a no-op
            // instead of a unique-constraint error.
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  // The DMs are deliberately NOT sent here. They're the one per-player,
  // network-bound part of the pass, and awaiting them inside the turn advance
  // is what used to freeze the Dev Panel's "End turn" for minutes. The list is
  // handed back instead and sent from advanceTurn()'s runSideEffects(), which
  // the web action runs after the response is already flushed.
  return {
    turnNumber: turn.number,
    // What was actually charged, not what was intended. The two differ by
    // however many players spent their last ⬢ while the pass was running, and
    // the audit row should say the true number.
    paid: charged.count,
    intendedToPay: toPay.length,
    starved: toStarve.length,
    shielded: shieldedIds.length,
    skipped,
    starvedCharacterIds: toStarve.map((character) => character.id),
    starvedNotices,
    newlyDyingCharacterIds: newlyDyingIds,
  };
}

module.exports = { runHungerPass, hungerDm, DYING_DM, HUNGER_STREAK_CAP };
