// What a Move pushes onto the world when it resolves, and how to take it back.
//
// The GM-facing half of adjudication needs to be able to say "this Move gave
// the player 5 ⬢" and later "actually, undo that" — without ever recomputing
// the number from live state, because the sheet moves on between the two.
// Every push is therefore snapshotted onto `Action.appliedEffects`, and revert
// reads ONLY that snapshot. Same rule as Request.payload vs Request.effect
// (docs/systemdocs/REQUESTS.md §2).
//
// `appliedEffects` is JSON rather than a column per pushable thing so this can
// grow — adding tags, moving a character, granting a Status — costs one entry
// in MOVE_EFFECTS below and nothing else. Old rows written before a new key
// existed still revert cleanly, because revert skips keys it doesn't know.

// A Move can't drive a character's balance negative; anything that would is
// clamped, matching db/lib/hungerPass.js.
//
// RETURNS THE ACTUAL MOVEMENT, which is the whole point. The clamp means the
// nominal delta and the applied delta are not the same number: a −5 against a
// character holding 2 ⬢ moves −2. Snapshotting the nominal −5 and then
// crediting it back on Unsolve minted 3 ⬢ out of nothing, every time. This is
// the same trap db/lib/lifeweb.js#bumpBlood documents and solves for the blood
// pool, in the same shape: clamp and report in one statement, and let the
// caller record what moved rather than what was asked for.
async function addResources(tx, characterId, amount) {
  if (!amount) return 0;
  // One atomic statement, not read-then-write. The old shape (findUnique, add
  // in JS, write the literal back) lost an update whenever anything else
  // touched the same character between the two — a Labor confirm racing a
  // transfer, or the auto-labor pass racing a player at rollover. GREATEST
  // keeps the clamp that db/lib/hungerPass.js also applies; Prisma's
  // `increment` can't express it, which is why this is raw.
  //
  // FOR UPDATE on the prior read so a concurrent write can't land between the
  // `before` this reports and the `after` it wrote.
  const rows = await tx.$queryRaw`
    WITH prev AS (
      SELECT "resources" AS before FROM "Character" WHERE "id" = ${characterId} FOR UPDATE
    )
    UPDATE "Character" c
    SET "resources" = GREATEST(0, prev.before + ${amount})
    FROM prev
    WHERE c."id" = ${characterId}
    RETURNING prev.before AS before, c."resources" AS after
  `;
  const before = rows[0]?.before ?? 0;
  const after = rows[0]?.after ?? before;
  return after - before;
}

const { EXHAUSTED_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");

// One entry per pushable thing. `read` decides what this Move would push right
// now; `apply` pushes it and returns WHAT ACTUALLY MOVED; `revert` takes back
// exactly what was snapshotted.
const MOVE_EFFECTS = {
  resources: {
    read: (action) => action.resourceDelta ?? 0,
    apply: (tx, action, value) => addResources(tx, action.characterId, value),
    revert: (tx, action, value) => addResources(tx, action.characterId, -value),
  },

  // One Labor per day. A non-null resourceRollExpression means the Labor gate
  // passed and the character labored — even a roll of 0 ⬢ spent the day — so
  // the payout grants Exhausted, and db/lib/laborAccess.js#computeLaborAccess
  // refuses the next one until the expiry sweep clears it. Both payout paths
  // (db/lib/stagedPush.js §2, db/lib/autoLaborPass.js) run while the
  // action's own turn closes, so `turn.number + durationTurns` blocks exactly
  // the following turn — the same clock arithmetic as the Hunger grant in
  // db/lib/hungerPass.js. An Unsolve reverts the exhaustion along with the
  // payout; if the tag already expired by then, the delete is a no-op.
  exhausted: {
    read: (action) => (action.resourceRollExpression ? 1 : 0),
    apply: async (tx, action) => {
      const [tag, turn] = await Promise.all([
        tx.tag.findUnique({
          where: { slug: EXHAUSTED_SLUG },
          select: { id: true, defaultDurationTurns: true },
        }),
        tx.turn.findUnique({ where: { id: action.turnId }, select: { number: true } }),
      ]);
      if (!tag || !turn) {
        if (!tag) console.error(`Labor payout: no "${EXHAUSTED_SLUG}" tag — run npm run db:sync-tags. Labor won't be limited.`);
        return 0;
      }
      // skipDuplicates: an existing Exhausted keeps its own clock, the same
      // "already holds it" rule as db/lib/tagExpiryPass.js.
      await tx.characterTag.createMany({
        data: [{
          characterId: action.characterId,
          tagId: tag.id,
          source: "EVENT",
          expiresTurn: expiryFrom(turn.number + 1, tag.defaultDurationTurns ?? 1),
        }],
        skipDuplicates: true,
      });
      return 1;
    },
    revert: async (tx, action) => {
      const tag = await tx.tag.findUnique({ where: { slug: EXHAUSTED_SLUG }, select: { id: true } });
      if (tag) {
        await tx.characterTag.deleteMany({ where: { characterId: action.characterId, tagId: tag.id } });
      }
    },
  },

  // A day spent on the Godard Factory floor: one Godflesh becomes eight
  // Squeeze (db/lib/refinery.js). `read` can only say "this was a Labor" —
  // whether it was a REFINING one depends on where the character was standing,
  // which is a database question, so applyRefinery decides and returns null at
  // every other Location. That is what lets this work from a bare Action row:
  // the hand-filed path (db/lib/stagedPush.js) applies at turn close with
  // nothing in memory but the row itself.
  //
  // Nothing is recorded for an ordinary Labor, so old rows and every other
  // location are untouched.
  refined: {
    read: (action) => (action.resourceRollExpression ? 1 : 0),
    apply: async (tx, action) => {
      // WHERE THE LABOR WAS FILED, not where they are standing now. A free
      // zone move costs no Action (CARRY.md §2a), so the two can differ by the
      // time this runs at turn close. Older rows carry no locationId and fall
      // back to the live one, which is what they always did.
      let locationId = action.locationId ?? null;
      if (!locationId) {
        const character = await tx.character.findUnique({
          where: { id: action.characterId },
          select: { locationId: true },
        });
        locationId = character?.locationId ?? null;
      }
      // 0, not null: applyMoveEffects falls back to the READ value when apply
      // reports nothing, so a null here would stamp `refined: 1` on every
      // ordinary Labor in the game.
      if (!locationId) return 0;
      const { applyRefinery } = require("./refinery");
      return (await applyRefinery(tx, action.characterId, locationId)) ?? 0;
    },
    revert: async (tx, action, snapshot) => {
      const { revertRefinery } = require("./refinery");
      await revertRefinery(tx, action.characterId, snapshot);
    },
  },
};

// Pushes everything this Move is worth and returns the blob to stamp on
// `Action.appliedEffects`. Callers run this inside their own transaction.
//
// The snapshot records what `apply` reports moving, not what `read` asked for.
// An effect whose apply returns nothing falls back to the asked-for value, so
// a future entry that can't clamp doesn't have to say so.
async function applyMoveEffects(tx, action) {
  const applied = {};
  for (const [key, effect] of Object.entries(MOVE_EFFECTS)) {
    const value = effect.read(action);
    if (!value) continue;
    const moved = await effect.apply(tx, action, value);
    const recorded = moved === undefined || moved === null ? value : moved;
    if (recorded) applied[key] = recorded;
  }
  return applied;
}

// Hands back exactly what `appliedEffects` says was pushed. An unknown key is
// skipped rather than thrown, so a row written before a newer effect existed
// still unsolves instead of wedging the panel.
async function revertMoveEffects(tx, action) {
  const applied = action.appliedEffects ?? {};
  for (const [key, value] of Object.entries(applied)) {
    const effect = MOVE_EFFECTS[key];
    if (!effect || !value) continue;
    await effect.revert(tx, action, value);
  }
  return applied;
}

// "+5 ⬢" — the one-line human form of a snapshot, for panels and audit rows.
function describeMoveEffects(applied) {
  const parts = [];
  for (const [key, value] of Object.entries(applied ?? {})) {
    if (!value) continue;
    if (key === "resources") parts.push(`${value > 0 ? "+" : ""}${value} ⬢`);
    else if (key === "exhausted") parts.push("Exhausted");
    else if (key === "refined") {
      parts.push(
        value.empty
          ? "nothing to refine — no Godflesh here"
          : `+${value.produced?.quantity ?? 0} Squeeze, −1 Godflesh`,
      );
    }
    else parts.push(`${key}: ${value}`);
  }
  return parts.join(", ");
}

// The Move d6. Lives here rather than as a private helper in the bot's
// interactionCreate.js because the adjudication panel rerolls it when a GM
// switches a Routine to a Gambit, and the two must be the same die.
function rollDie(sides = 6) {
  return 1 + Math.floor(Math.random() * sides);
}

// addResources is exported for db/lib/stagedPush.js, which pushes GM-staged
// resource adjustments through the same clamp-and-report statement.
module.exports = { addResources, applyMoveEffects, revertMoveEffects, describeMoveEffects, rollDie };
