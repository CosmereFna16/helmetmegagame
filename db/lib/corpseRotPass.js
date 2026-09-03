// A person's corpse goes off. docs/systemdocs/CORPSES.md.
//
// Three turns after they died, "Ada's Corpse" becomes "Ada's Rotten Corpse"
// and starts stinking (bot/src/lib/deathSmell.js). Monster corpses never rot:
// a Nekker left lying around stays butcherable, and only a person smells.
//
// THIS RENAMES THE TAG ROW IN PLACE rather than expiring into a second one,
// which is the whole trick and worth explaining, because Tag.expiresInto is
// right there and looks like the answer:
//
//   * expiresInto names catalog SLUGS, and "Ada's Rotten Corpse" is written
//     per-character and never appears in docs/tags.yaml. There is no slug for
//     it to name.
//   * tagExpiryPass.js only walks CharacterTag, and a corpse is almost always
//     a RoomTag lying on a floor.
//   * a chain would leave the holding pointing at the OLD row, so a corpse
//     someone was carrying would rot into a tag in a different place.
//
// Renaming sidesteps all three: one row, one identity, and a body in your bag
// rots in your bag.
//
// IT MUST RUN BEFORE THE "expirySweep" PASS. That sweep is a blind deleteMany
// over `expiresTurn <= turn.number`, so a corpse that reached its clock would
// simply be deleted. Nulling expiresTurn here is what takes it out of the
// sweep's reach — no exemption list, no special case in db/index.js.
//
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
function rottenName(name) {
  return `${name}'s Rotten Corpse`;
}

function rottenDescription(name) {
  return `The rotten body of ${name}. It makes you sick to be near it. ‡`;
}

// The rename, with the same collision dance minting does — and it needs it for
// the same reason and then some. Tag.name is @unique, two characters can share
// a name, and their corpses were already suffixed apart at death ("Ada's Corpse
// (2)"); rotting both would collapse them onto one rotten name. The suffix has
// to be re-derived here rather than parsed out of the old name, because the old
// name is about to stop existing.
async function rotAndName(prisma, tag, who) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const name = attempt ? `${rottenName(who)} (${attempt + 1})` : rottenName(who);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.tag.update({
          where: { id: tag.id },
          data: {
            name,
            description: rottenDescription(who),
            corpseKind: "ROTTEN",
            // Nothing left to count down to. Nulling the holdings' clocks
            // below is what actually takes this row out of the blind sweep's
            // reach — see the header.
            defaultDurationTurns: null,
          },
        });
        // Both holdings, because a corpse can be in a pocket or on a floor and
        // the sweep walks both tables.
        await tx.characterTag.updateMany({ where: { tagId: tag.id }, data: { expiresTurn: null } });
        await tx.roomTag.updateMany({ where: { tagId: tag.id }, data: { expiresTurn: null } });
      });
      return name;
    } catch (err) {
      if (err?.code !== "P2002") throw err;
    }
  }
  throw new Error(`could not find a free rotten name for "${who}"`);
}

async function runCorpseRotPass(prisma, turn) {
  // Only a person's corpse, only a fresh one, only one whose clock is up. A
  // monster corpse has no defaultDurationTurns and its holdings carry a null
  // expiresTurn, so it can never match either half of this.
  const due = await prisma.tag.findMany({
    where: {
      corpseKind: "FRESH",
      corpseOfCharacterId: { not: null },
      OR: [
        { characters: { some: { expiresTurn: { lte: turn.number } } } },
        { roomTags: { some: { expiresTurn: { lte: turn.number } } } },
      ],
    },
    select: { id: true, name: true, corpseOf: { select: { name: true } } },
  });

  // An object, not null: db/index.js reads null as "this pass failed, retry it
  // next advance" and gates markDone on truthiness.
  if (due.length === 0) return { turnNumber: turn.number, rotted: 0 };

  const rotted = [];
  for (const tag of due) {
    // The character's own name, not a substring of the tag's — the collision
    // suffix means "Ada's Corpse (2)" exists, and parsing it back would be
    // wrong. A hard-deleted character leaves corpseOf null; fall back to
    // rewriting whatever the tag already says so it still visibly rots.
    const who = tag.corpseOf?.name ?? tag.name.replace(/'s Corpse.*$/, "");
    try {
      const name = await rotAndName(prisma, tag, who);
      rotted.push(name);
    } catch (err) {
      // One bad row costs one body, not the pass.
      console.error(`corpseRot: failed to rot tag ${tag.id}:`, err);
    }
  }

  return { turnNumber: turn.number, rotted: rotted.length, names: rotted };
}

module.exports = { runCorpseRotPass, rottenName, rottenDescription };
