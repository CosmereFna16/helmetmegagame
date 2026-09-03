// The turn-close carry sweep (docs/systemdocs/CARRY.md), run from
// db/index.js#resolveNeeds() after the hunger pass so it sees the final
// sheet: Labor payouts, staged pushes, the expiry sweep and the ⬢ upkeep
// charge all happen earlier in the close and none of them may settle in
// place (they run inside transactions, and a drop needs Discord).
//
// One settle per character, each its own transaction — a bad row must not
// roll back a hundred good ones. Returns the drops for runSideEffects rather
// than sending them. Takes `prisma` as a parameter — see db/lib/dm.js.
const { OVERBURDENED_SLUG } = require("./constants");
const { settleCarry } = require("./carry");

async function runCarryPass(prisma, turn) {
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { carryResourceCap: true },
  });
  const candidates = await prisma.character.findMany({
    where: {
      status: "ALIVE",
      OR: [
        { tags: { some: { tag: { tradeable: true } } } },
        { tags: { some: { tag: { slug: OVERBURDENED_SLUG } } } },
        { resources: { gt: config?.carryResourceCap ?? 25 } },
      ],
    },
    select: { id: true },
  });

  let granted = 0;
  let removed = 0;
  const drops = [];
  const failed = [];
  for (const { id } of candidates) {
    const result = await settleCarry(prisma, id).catch((err) => {
      console.error(`Carry settle failed for ${id}:`, err);
      failed.push(id);
      return null;
    });
    if (!result) continue;
    if (result.granted) granted += 1;
    if (result.removed) removed += 1;
    if (result.drop) drops.push(result);
  }

  return {
    turnNumber: turn.number,
    settled: candidates.length,
    granted,
    removed,
    dropped: drops.length,
    failed,
    drops,
  };
}

module.exports = { runCarryPass };
