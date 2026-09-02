// Client-safe on purpose: MoveDesk.js (a "use client" component) needs this
// one predicate, and the module it used to live in — web/lib/moveRows.js —
// imports the Prisma barrel through referenceData.js. Pulling that into a
// browser bundle drags every server-only module along, and the first
// Node-only module in the chain (fs) kills the whole desk at load. No imports
// here, ever.

// Does anything staged actually reach this character? Mirrors the test the
// push already uses to decide whether a Move was spoken for (the
// `message.recipients.some((r) => r.characterId === action.characterId)` in
// db/lib/stagedPush.js), so the desk's warning and the push's own fallback
// can never disagree about what counts as "the player heard something".
//
// The Result box does NOT count: it is GM-facing and is never sent. A Move
// whose whole outcome lives there and nowhere else reaches the player as
// silence — and for a Gambit that silence is total, since Gambits are
// excluded from the passed-Routine fallback DM and get only the die reveal.
export function stagingReaches(characterId, { messages = [], effects = [] } = {}) {
  if (!characterId) return false;
  return (
    messages.some(
      (m) => m.kind === "PRIVATE" && (m.recipients ?? []).some((r) => r.characterId === characterId),
    ) || effects.some((e) => e.targetCharacterId === characterId)
  );
}
