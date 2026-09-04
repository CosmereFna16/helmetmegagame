// Per-turn Hunger upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
// See TURN-ENGINE.md for the full ordering.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const {
  HUNGER_SLUG,
  HUNGERLESS_SLUG,
  FAST_METABOLISM_SLUG,
  ATE_MEAL_SLUG,
  DYING_SLUG,
  NOBILITY_SLUG,
  DISAPPOINTED_SLUG,
} = require("./constants");
const { expiryFrom } = require("./turnFormat");

const HUNGER_STREAK_CAP = 6;

// `notice.streak` is the count AFTER this turn's change, already clamped to
// HUNGER_STREAK_CAP, matching gambitModifier.js's penalty.
function hungerDm(notice) {
  if (notice.kind === "recovered") {
    return "You ate, and you're back to full strength.";
  }
  if (notice.kind === "recovering") {
    return `You ate, but you're still weak from hunger. −${notice.streak} to Gambits.`;
  }
  return `You went hungry this turn. −${notice.streak} to Gambits.`;
}

const DYING_DM =
  "You haven't eaten in six turns straight. Your body is giving out — you're **Dying**. A GM will decide what happens next.";

// Missed turn closes in a row before a noble wakes Disappointed. The web
// sheet's Dinner row (StatusPanel.js) counts against the same number.
const DISAPPOINTMENT_THRESHOLD = 3;

function disappointedDm(notice) {
  if (notice.kind === "warned") {
    return "Two days without a fine meal. One more and you'll wake **Disappointed**.";
  }
  return "Three days without a fine meal. You're **Disappointed** — −1 to Gambits until you eat one.";
}

async function runHungerPass(prisma, turn) {
  const tags = await prisma.tag.findMany({
    where: {
      slug: {
        in: [
          HUNGER_SLUG,
          HUNGERLESS_SLUG,
          FAST_METABOLISM_SLUG,
          ATE_MEAL_SLUG,
          DYING_SLUG,
          NOBILITY_SLUG,
          DISAPPOINTED_SLUG,
        ],
      },
    },
    select: { id: true, slug: true, defaultDurationTurns: true },
  });

  const hungerTag = tags.find((t) => t.slug === HUNGER_SLUG);
  if (!hungerTag) {
    console.error(`Hunger pass skipped: no "${HUNGER_SLUG}" tag — run npm run db:sync-tags.`);
    return null;
  }
  const hungerlessId = tags.find((t) => t.slug === HUNGERLESS_SLUG)?.id ?? null;
  // Missing is non-fatal, unlike Hunger itself: nobody holds it, so everyone
  // just pays the ordinary 1 ⬢.
  const fastMetabolismId = tags.find((t) => t.slug === FAST_METABOLISM_SLUG)?.id ?? null;
  if (!fastMetabolismId) {
    console.error(
      `Hunger pass: no "${FAST_METABOLISM_SLUG}" tag — run npm run db:sync-tags. Everyone pays the flat 1 ⬢.`,
    );
  }
  const ateMealId = tags.find((t) => t.slug === ATE_MEAL_SLUG)?.id ?? null;
  const dyingId = tags.find((t) => t.slug === DYING_SLUG)?.id ?? null;
  if (!dyingId) {
    console.error(`Hunger pass: no "${DYING_SLUG}" tag — run npm run db:sync-tags. Streak cap won't grant it.`);
  }
  const nobilityId = tags.find((t) => t.slug === NOBILITY_SLUG)?.id ?? null;
  const disappointedId = tags.find((t) => t.slug === DISAPPOINTED_SLUG)?.id ?? null;
  if (nobilityId && !disappointedId) {
    console.error(
      `Hunger pass: no "${DISAPPOINTED_SLUG}" tag — run npm run db:sync-tags. Nobility upkeep won't be tracked.`,
    );
  }
  const trackNobles = Boolean(nobilityId && disappointedId);

  const gateIds = [hungerlessId, fastMetabolismId, ateMealId].filter(Boolean);
  if (trackNobles) gateIds.push(nobilityId, disappointedId, ...(dyingId ? [dyingId] : []));
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      discordUserId: true,
      resources: true,
      hungerStreak: true,
      missedMealStreak: true,
      // Only the gating tags, not the whole tag set — keeps this cheap at
      // 100+ characters.
      tags: { where: { tagId: { in: gateIds } }, select: { tagId: true } },
    },
  });

  // Split by what they owe, because one updateMany carries one decrement.
  const toPay1 = [];
  const toPay2 = []; // Fast Metabolism
  const toStarve = [];
  const shieldedIds = [];
  const toZeroIds = []; // hungerless only: streak -> 0
  const fed = []; // ate-meal or paid: streak drops by ONE tick
  let skipped = 0;

  const nobleFedIds = [];
  const nobleMissedIds = [];
  const toDisappointIds = [];
  const disappointedNotices = [];

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tagId));
    const noble = trackNobles && held.has(nobilityId) && !(dyingId && held.has(dyingId));

    if (hungerlessId && held.has(hungerlessId)) {
      skipped += 1;
      toZeroIds.push(character.id);
      continue;
    }

    if (ateMealId && held.has(ateMealId)) {
      shieldedIds.push(character.id);
      fed.push(character);
      if (noble) nobleFedIds.push(character.id);
      continue;
    }

    if (noble) {
      const missed = character.missedMealStreak + 1;
      nobleMissedIds.push(character.id);
      if (missed >= DISAPPOINTMENT_THRESHOLD) {
        if (!held.has(disappointedId)) {
          toDisappointIds.push(character.id);
          disappointedNotices.push({ discordUserId: character.discordUserId, kind: "disappointed" });
        }
      } else if (missed === DISAPPOINTMENT_THRESHOLD - 1) {
        disappointedNotices.push({ discordUserId: character.discordUserId, kind: "warned" });
      }
    }

    // Under the full cost the character pays NOTHING and goes hungry, keeping
    // what they have — the same rule a 0 ⬢ character has always had, just with
    // a higher bar. A fast metabolism holding 1 ⬢ does not half-eat.
    const cost = fastMetabolismId && held.has(fastMetabolismId) ? 2 : 1;
    if (character.resources >= cost) {
      (cost === 2 ? toPay2 : toPay1).push(character.id);
      fed.push(character);
    } else {
      toStarve.push(character);
    }
  }

  const expiresTurn = expiryFrom(turn.number + 1, hungerTag.defaultDurationTurns ?? 1);

  // Computed in JS off the streak already loaded above, since an
  // increment/decrement in the same transaction wouldn't hand back the new
  // value, and this pass needs it now to decide the DMs.
  const fedWithNewStreak = fed.map((character) => ({
    character,
    newStreak: Math.max(character.hungerStreak - 1, 0),
  }));
  const stillHungryAfterEating = fedWithNewStreak.filter((f) => f.newStreak > 0);
  const toDecrementIds = fed.map((character) => character.id);

  const hungerNotices = [
    ...toStarve.map((character) => ({
      discordUserId: character.discordUserId,
      kind: "starved",
      streak: Math.min(character.hungerStreak + 1, HUNGER_STREAK_CAP),
      justDied: dyingId != null && character.hungerStreak + 1 >= HUNGER_STREAK_CAP,
    })),
    ...fedWithNewStreak
      .filter((f) => f.character.hungerStreak > 0)
      .map((f) => ({
        discordUserId: f.character.discordUserId,
        kind: f.newStreak > 0 ? "recovering" : "recovered",
        streak: f.newStreak,
        justDied: false,
      })),
  ];
  const newlyDyingIds = dyingId
    ? toStarve.filter((character) => character.hungerStreak + 1 >= HUNGER_STREAK_CAP).map((character) => character.id)
    : [];

  // One transaction so a character can't be charged without Ate Meal being
  // consumed, or land at the streak cap without Dying landing with it.
  const [charged1, charged2] = await prisma.$transaction([
    prisma.character.updateMany({
      where: { id: { in: toPay1 }, resources: { gte: 1 } },
      data: { resources: { decrement: 1 } },
    }),
    // Same structural clamp, one rung up: the where-guard matches its own
    // decrement, so resources can never go negative without a Math.max.
    prisma.character.updateMany({
      where: { id: { in: toPay2 }, resources: { gte: 2 } },
      data: { resources: { decrement: 2 } },
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: shieldedIds }, tagId: ateMealId ?? "" },
    }),
    prisma.characterTag.createMany({
      data: [...toStarve, ...stillHungryAfterEating.map((f) => f.character)].map((character) => ({
        characterId: character.id,
        tagId: hungerTag.id,
        source: "EVENT",
        expiresTurn,
      })),
      skipDuplicates: true,
    }),
    prisma.character.updateMany({
      where: { id: { in: toZeroIds } },
      data: { hungerStreak: 0 },
    }),
    // Floor is structural, not a Math.max on an earlier read: the `gt: 0`
    // where-guard matches the resources decrement's `gte: 1` above.
    prisma.character.updateMany({
      where: { id: { in: toDecrementIds }, hungerStreak: { gt: 0 } },
      data: { hungerStreak: { decrement: 1 } },
    }),
    prisma.character.updateMany({
      where: { id: { in: toStarve.map((character) => character.id) } },
      data: { hungerStreak: { increment: 1 } },
    }),
    prisma.character.updateMany({
      where: { id: { in: nobleFedIds } },
      data: { missedMealStreak: 0 },
    }),
    prisma.character.updateMany({
      where: { id: { in: nobleMissedIds } },
      data: { missedMealStreak: { increment: 1 } },
    }),
    prisma.characterTag.deleteMany({
      where: { characterId: { in: nobleFedIds }, tagId: disappointedId ?? "" },
    }),
    prisma.characterTag.createMany({
      data: toDisappointIds.map((characterId) => ({
        characterId,
        tagId: disappointedId ?? "",
        source: "EVENT",
        expiresTurn: null, // cleared by eating, not by time
      })),
      skipDuplicates: true,
    }),
    ...(newlyDyingIds.length && dyingId
      ? [
          prisma.characterTag.createMany({
            data: newlyDyingIds.map((characterId) => ({
              characterId,
              tagId: dyingId,
              source: "EVENT",
              // One-turn clock: granted at close N, expires N + 1, then
              // db/lib/dyingDeathPass.js takes over.
              expiresTurn: turn.number + 1,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  // DMs are deliberately NOT sent here — the list is handed back and sent
  // from advanceTurn()'s runSideEffects() instead, after the response
  // already flushed.
  return {
    turnNumber: turn.number,
    paid: charged1.count + charged2.count,
    intendedToPay: toPay1.length + toPay2.length,
    starved: toStarve.length,
    shielded: shieldedIds.length,
    skipped,
    recovering: stillHungryAfterEating.length,
    disappointed: toDisappointIds.length,
    starvedCharacterIds: toStarve.map((character) => character.id),
    hungerNotices,
    disappointedNotices,
    newlyDyingCharacterIds: newlyDyingIds,
  };
}

module.exports = {
  runHungerPass,
  hungerDm,
  disappointedDm,
  DYING_DM,
  HUNGER_STREAK_CAP,
  DISAPPOINTMENT_THRESHOLD,
};
