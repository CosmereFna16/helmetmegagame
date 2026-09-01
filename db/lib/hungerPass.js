// Per-turn Hunger upkeep, run from db/index.js#resolveNeeds() so the bot's
// cron advance and the Dev Panel's "End turn" button behave identically.
//
// At the close of every turn each ALIVE character is checked, in this order:
//   1. Holds Hungerless -> skipped entirely. No resource taken, no Hunger,
//                          streak reset to 0 (can't go hungry, so a lingering
//                          streak from before they had this tag is stale —
//                          this is immunity, not eating, so it's still a full
//                          reset rather than the one-tick-per-turn rule below).
//   2. Holds Ate Meal   -> shielded from Hunger, the tag is consumed
//                          (whether or not they were broke), NO ⬢ is
//                          taken, and the streak drops by ONE tick. The meal
//                          was already paid for when it was cooked — 2 ⬢ for
//                          a Fine, 3 ⬢ for a Lavish — so billing the upkeep on
//                          top made eating strictly worse than the 1 ⬢ it
//                          saves. Eating settles the turn's upkeep; the streak
//                          it climbed over several starved turns takes that
//                          many fed turns to climb back down.
//   3. Check FIRST, then pay: at 0 ⬢ you go Hungry, owe nothing, and the
//      streak increments; at 1+ ⬢ you pay 1, stay fed, and the streak drops
//      by ONE tick. So 1 ⬢ always buys a fed turn, and resources can never go
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
// at HUNGER_STREAK_CAP. Since one meal only sheds one tick, the `hunger` tag
// itself now means "carrying hunger damage" rather than "starved this turn" —
// it's re-granted to anyone whose streak is still above 0 after eating, not
// just to those who starved outright. Reaching the cap also grants `dying`,
// the same terminal tag every untreated-wound chain lands on. This pass still
// kills nobody itself — it only ever grants the tag — but `dying` is a
// one-turn countdown now rather than a permanent flag waiting on a GM, so
// db/lib/dyingDeathPass.js finishes at the NEXT close what starving started
// here. skipDuplicates means re-granting it on a later starved turn is a
// harmless no-op, and leaves the original clock alone. Only starving (never
// eating) can push a character over the cap — a fed character's streak only
// ever goes down.
//
// Shaped for 100+ players: two reads and bulk writes regardless of headcount,
// and no network call at all — the per-player Hunger DMs are returned as a
// list for advanceTurn() to send later.
//
// Nobility rides the same pass: each turn close without the Ate Meal shield
// ticks Character.missedMealStreak up for a noble (paying the 1 ⬢ upkeep is
// commoner food and doesn't count), and at DISAPPOINTMENT_THRESHOLD the pass
// grants `disappointed`, with a warning DM the day before. Unlike the hunger
// streak there is no slow climb back down: one proper meal resets the count
// to 0 outright. The tag is granted with no expiry, like `catatonic`, because
// the cure is an act rather than time: consuming anything that becomes Ate
// Meal removes it on the spot (web/app/(app)/character/requestActions.js).
// The shielded-branch delete below is only the backstop for meals a GM
// granted directly. Hungerless and Dying nobles are exempt from gaining it —
// no appetite and no appetite for life, respectively.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const {
  HUNGER_SLUG,
  HUNGERLESS_SLUG,
  ATE_MEAL_SLUG,
  DYING_SLUG,
  NOBILITY_SLUG,
  DISAPPOINTED_SLUG,
} = require("./constants");
const { expiryFrom } = require("./turnFormat");

const HUNGER_STREAK_CAP = 6;

// `notice.streak` is the count AFTER this turn's change, already clamped to
// HUNGER_STREAK_CAP — the same number gambitModifier.js applies, so the DM
// never names a bigger penalty than the one actually in effect.
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
// sheet's Dinner row (web/app/components/StatusPanel.js) counts against the
// same number, so a change here moves both.
const DISAPPOINTMENT_THRESHOLD = 3;

// `kind` is "warned" (one missed day from the threshold) or "disappointed"
// (the tag just landed). Wording is hardcoded to the threshold of 3 — if the
// constant moves, move these sentences with it.
function disappointedDm(notice) {
  if (notice.kind === "warned") {
    return "Two days without a fine meal. One more and you'll wake **Disappointed**.";
  }
  return "Three days without a fine meal. You're **Disappointed** — −1 to Gambits until you eat one.";
}

async function runHungerPass(prisma, turn) {
  const tags = await prisma.tag.findMany({
    where: {
      slug: { in: [HUNGER_SLUG, HUNGERLESS_SLUG, ATE_MEAL_SLUG, DYING_SLUG, NOBILITY_SLUG, DISAPPOINTED_SLUG] },
    },
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
  const nobilityId = tags.find((t) => t.slug === NOBILITY_SLUG)?.id ?? null;
  const disappointedId = tags.find((t) => t.slug === DISAPPOINTED_SLUG)?.id ?? null;
  if (nobilityId && !disappointedId) {
    console.error(
      `Hunger pass: no "${DISAPPOINTED_SLUG}" tag — run npm run db:sync-tags. Nobility upkeep won't be tracked.`,
    );
  }
  // The Nobility track only runs with both ends of it in the catalog.
  const trackNobles = Boolean(nobilityId && disappointedId);

  // dying and disappointed ride along so `held` can answer the noble
  // exemption and the "newly landed?" check without a second query.
  const gateIds = [hungerlessId, ateMealId].filter(Boolean);
  if (trackNobles) gateIds.push(nobilityId, disappointedId, ...(dyingId ? [dyingId] : []));
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      discordUserId: true,
      resources: true,
      hungerStreak: true,
      missedMealStreak: true,
      // Only the handful of gating tags come back, not the whole tag set —
      // this is the query that would otherwise scale badly at 100+ characters.
      tags: { where: { tagId: { in: gateIds } }, select: { tagId: true } },
    },
  });

  const toPay = [];
  const toStarve = [];
  const shieldedIds = [];
  const toZeroIds = []; // hungerless only: streak -> 0, a full reset (it's immunity, not eating)
  const fed = []; // ate-meal or paid: streak drops by ONE tick, not to 0
  let skipped = 0;

  // The Nobility track. `nobleFedIds` resets missedMealStreak to 0 and doubles
  // as the backstop clear of `disappointed` for anyone shielded by a meal a GM
  // granted directly (the normal clear already happened at consume time).
  const nobleFedIds = [];
  const nobleMissedIds = [];
  const toDisappointIds = []; // crossed the threshold and don't hold the tag yet
  const disappointedNotices = [];

  for (const character of characters) {
    const held = new Set(character.tags.map((ct) => ct.tagId));

    // Hungerless is checked before this is read, so a hungerless noble's
    // count freezes rather than climbing — immunity covers dinner too.
    // Dying nobles are left alone the same way.
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
      // No proper meal today, whether or not the 1 ⬢ upkeep was paid.
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

    if (character.resources >= 1) {
      toPay.push(character.id);
      fed.push(character);
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
  // turn.number + 1: this closes turn N, and the Hunger's first live turn
  // is N+1, the one about to open.
  const expiresTurn = expiryFrom(turn.number + 1, hungerTag.defaultDurationTurns ?? 1);

  // Computed in JS off the streak already loaded above, not off a DB return
  // value — an `increment`/`decrement` in the same transaction wouldn't hand
  // back the new value, and this pass needs it now to decide who crosses the
  // cap, who still carries Hunger after eating, and what to put in each DM.
  const fedWithNewStreak = fed.map((character) => ({
    character,
    newStreak: Math.max(character.hungerStreak - 1, 0),
  }));
  // A meal only sheds one tick, so anyone who was several turns deep is still
  // hungry afterward — the tag now means "carrying hunger damage", not
  // "starved this turn", so it's re-granted here too.
  const stillHungryAfterEating = fedWithNewStreak.filter((f) => f.newStreak > 0);
  const toDecrementIds = fed.map((character) => character.id);

  const hungerNotices = [
    ...toStarve.map((character) => ({
      discordUserId: character.discordUserId,
      kind: "starved",
      streak: Math.min(character.hungerStreak + 1, HUNGER_STREAK_CAP),
      // `>=`, matching newlyDyingIds below — the flag that sends DYING_DM and
      // the grant that lands the tag must never disagree. With `===`, a GM who
      // pulled Dying off by hand without also dropping the streak below the cap
      // got the tag re-granted on the next starved turn (skipDuplicates no
      // longer suppresses it, since it is no longer held) and the player was
      // never told.
      justDied: dyingId != null && character.hungerStreak + 1 >= HUNGER_STREAK_CAP,
    })),
    // Only characters who were actually carrying a streak get a DM — someone
    // already at 0 who just pays their upkeep hears nothing, same as before.
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
      data: [...toStarve, ...stillHungryAfterEating.map((f) => f.character)].map((character) => ({
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
      where: { id: { in: toZeroIds } },
      data: { hungerStreak: 0 },
    }),
    // The floor is structural, not a Math.max on a value read moments
    // earlier — the `gt: 0` where-guard is the same posture as the `gte: 1`
    // on the resources decrement above: a streak that hit 0 by some other
    // path in between simply isn't matched, rather than going negative.
    prisma.character.updateMany({
      where: { id: { in: toDecrementIds }, hungerStreak: { gt: 0 } },
      data: { hungerStreak: { decrement: 1 } },
    }),
    prisma.character.updateMany({
      where: { id: { in: toStarve.map((character) => character.id) } },
      data: { hungerStreak: { increment: 1 } },
    }),
    // The Nobility track: one proper meal settles the whole count (unlike
    // hungerStreak's one-tick shed), a missed day ticks it up, the threshold
    // lands the tag. The delete is the backstop for GM-granted meals — the
    // player-facing clear already happened at consume time.
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
      // toDisappointIds already excludes holders, but a GM granting the tag
      // mid-pass shouldn't turn into a unique-constraint crash.
      skipDuplicates: true,
    }),
    ...(newlyDyingIds.length && dyingId
      ? [
          prisma.characterTag.createMany({
            data: newlyDyingIds.map((characterId) => ({
              characterId,
              tagId: dyingId,
              source: "EVENT",
              // Was `null` — permanent, like every other terminal chain — back
              // when a GM decided how Dying ended. It carries a clock now:
              // one turn, then db/lib/dyingDeathPass.js. Granted while closing
              // turn N, so N + 1 is the close it runs out on, the same
              // "+ 1 is the first live turn" expression tagExpiryPass uses.
              expiresTurn: turn.number + 1,
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
    // Fed this turn but still carrying a streak afterward — a meal only sheds
    // one tick, so a deeply hungry character can eat every turn and still
    // show this count until they've climbed all the way back down.
    recovering: stillHungryAfterEating.length,
    // Nobles whose missed-meal count crossed the threshold this close.
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
