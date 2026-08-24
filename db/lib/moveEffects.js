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
async function addResources(tx, characterId, amount) {
  if (!amount) return;
  // One atomic statement, not read-then-write. The old shape (findUnique, add
  // in JS, write the literal back) lost an update whenever anything else
  // touched the same character between the two — a /labor confirm racing a
  // transfer, or the Default Move pass racing a player at rollover. GREATEST
  // keeps the clamp that db/lib/hungerPass.js also applies; Prisma's
  // `increment` can't express it, which is why this is raw.
  await tx.$executeRaw`
    UPDATE "Character"
    SET "resources" = GREATEST(0, "resources" + ${amount})
    WHERE "id" = ${characterId}
  `;
}

// One entry per pushable thing. `read` decides what this Move would push right
// now; `apply` pushes it; `revert` takes back exactly what was snapshotted.
const MOVE_EFFECTS = {
  resources: {
    read: (action) => action.resourceDelta ?? 0,
    apply: (tx, action, value) => addResources(tx, action.characterId, value),
    revert: (tx, action, value) => addResources(tx, action.characterId, -value),
  },
};

// Pushes everything this Move is worth and returns the blob to stamp on
// `Action.appliedEffects`. Callers run this inside their own transaction.
async function applyMoveEffects(tx, action) {
  const applied = {};
  for (const [key, effect] of Object.entries(MOVE_EFFECTS)) {
    const value = effect.read(action);
    if (!value) continue;
    await effect.apply(tx, action, value);
    applied[key] = value;
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

module.exports = { MOVE_EFFECTS, applyMoveEffects, revertMoveEffects, describeMoveEffects, rollDie };
