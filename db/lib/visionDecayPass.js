// Five drinks of Moonshine and the lights go out.
//
// {tag:damaged-vision} is the only stackable tag in the catalog whose COUNT
// means something. Nothing else in the engine reads a quantity as a threshold:
// expiresInto (db/lib/tagExpiryPass.js) fires off a clock and knows nothing
// about stacks, and the stackable sweep in db/index.js sheds one unit at a
// time. So counting is a pass of its own, which is also the honest shape —
// this is a slow accumulation somebody chose five times, not something that
// happened to them on a timer.
//
// The whole stack comes off when it fires. Blind is terminal enough that
// leaving four notches behind would only ask "damaged toward what?"
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const DAMAGED_VISION_SLUG = "damaged-vision";
const BLIND_SLUG = "blind";
const BLIND_AT = 5;

const WENT_BLIND_DM =
  "The world has been going grey at the edges for a while now. This morning it does not come back. ‡";

async function runVisionDecayPass(prisma, turn) {
  const rows = await prisma.characterTag.findMany({
    where: {
      quantity: { gte: BLIND_AT },
      tag: { slug: DAMAGED_VISION_SLUG },
      character: { status: "ALIVE" },
    },
    select: {
      id: true,
      characterId: true,
      quantity: true,
      character: { select: { name: true, discordUserId: true } },
    },
  });
  // An object, not null: db/index.js reads null as "this pass failed, retry it
  // next advance" and gates markDone on truthiness.
  if (rows.length === 0) return { turnNumber: turn.number, blinded: 0, dms: [] };

  const blind = await prisma.tag.findUnique({ where: { slug: BLIND_SLUG }, select: { id: true } });
  if (!blind) {
    console.error(`Vision decay: no "${BLIND_SLUG}" tag — run npm run db:sync-tags. Nobody will go blind.`);
    return { turnNumber: turn.number, blinded: 0, dms: [] };
  }

  const blinded = [];
  for (const row of rows) {
    try {
      await prisma.$transaction(async (tx) => {
        // The delete is the claim: a concurrent write that already cleared the
        // stack means somebody else handled this character, and deleteMany
        // matching nothing is how we find that out without a second read.
        const { count } = await tx.characterTag.deleteMany({ where: { id: row.id } });
        if (count === 0) return;
        // skipDuplicates rather than an upsert: a character who is somehow
        // already Blind keeps the row they have, with its own source and
        // clock, the same rule db/lib/tagExpiryPass.js follows.
        await tx.characterTag.createMany({
          data: [{ characterId: row.characterId, tagId: blind.id, source: "EVENT", expiresTurn: null }],
          skipDuplicates: true,
        });
        blinded.push(row);
      });
    } catch (err) {
      console.error(`Vision decay for character ${row.characterId} failed:`, err);
    }
  }

  // Described here, sent by advanceTurn()'s runSideEffects() — a per-player
  // Discord round trip inside resolveNeeds() would hold "End turn" open.
  return {
    turnNumber: turn.number,
    blinded: blinded.length,
    characterIds: blinded.map((r) => r.characterId),
    dms: blinded
      .filter((r) => r.character?.discordUserId)
      .map((r) => ({ discordUserId: r.character.discordUserId, content: WENT_BLIND_DM })),
  };
}

module.exports = { runVisionDecayPass, DAMAGED_VISION_SLUG, BLIND_SLUG, BLIND_AT };
