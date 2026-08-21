// The "grants when expired" half of resolveNeeds()' sweep: a catalog tag can
// declare what it turns INTO when its timer runs out (Tag.grantsOnExpiry, a
// list of tag slugs), rather than expiry only ever taking something away.
// Starting Wares unpacking into a revolver and jewelry is the first use; the
// mechanism is general — a Wound leaving a Scar, a sickness resolving into a
// lasting condition, any timed state with an aftermath.
//
// Must run BEFORE the sweep's deletes in db/index.js, since it reads the very
// rows that are about to be removed.

// A granted tag with its own duration starts its clock now. Same absolute-turn
// expression as db/lib/hungerPass.js and sweepExpiredStacks(), so every writer
// of expiresTurn derives it identically — this is also what lets a chain work
// (Wound -> Scar that itself fades).
function expiryFor(tag, turn) {
  return tag.defaultDurationTurns != null ? turn.number + tag.defaultDurationTurns : null;
}

async function applyExpiryGrants(prisma, turn) {
  const expiring = await prisma.characterTag.findMany({
    where: {
      expiresTurn: { lte: turn.number },
      tag: { NOT: { grantsOnExpiry: { isEmpty: true } } },
    },
    select: { characterId: true, tag: { select: { grantsOnExpiry: true } } },
  });
  if (expiring.length === 0) return null;

  // characterId -> (slug -> how many of it this character is owed). A slug
  // repeated in grantsOnExpiry is the ONLY way to ask for more than one, so
  // the tally is the whole point rather than an optimisation — and a
  // character expiring two different bundles that both grant jewelry lands
  // here as one entry too.
  const owedByCharacter = new Map();
  for (const row of expiring) {
    let owed = owedByCharacter.get(row.characterId);
    if (!owed) {
      owed = new Map();
      owedByCharacter.set(row.characterId, owed);
    }
    for (const slug of row.tag.grantsOnExpiry) {
      owed.set(slug, (owed.get(slug) ?? 0) + 1);
    }
  }

  const slugs = [...new Set([...owedByCharacter.values()].flatMap((owed) => [...owed.keys()]))];
  const tags = await prisma.tag.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true, stackable: true, defaultDurationTurns: true },
  });
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]));

  // What each character already holds of the tags about to be granted —
  // @@unique([characterId, tagId]) means a blind createMany would throw, and
  // the collision rule differs by stackability (see below).
  const existing = await prisma.characterTag.findMany({
    where: { characterId: { in: [...owedByCharacter.keys()] }, tagId: { in: tags.map((t) => t.id) } },
    select: { id: true, characterId: true, tagId: true },
  });
  const existingKey = (characterId, tagId) => `${characterId}:${tagId}`;
  const existingByKey = new Map(existing.map((ct) => [existingKey(ct.characterId, ct.tagId), ct]));

  const creates = [];
  const increments = [];
  for (const [characterId, owed] of owedByCharacter) {
    for (const [slug, count] of owed) {
      // Unknown slugs are rejected at sync time (db/lib/syncTags.js), so this
      // can only be a row predating a catalog edit — skip rather than throw
      // and take a turn advance down with it.
      const tag = tagBySlug.get(slug);
      if (!tag) continue;

      const held = existingByKey.get(existingKey(characterId, tag.id));
      if (!held) {
        creates.push({
          characterId,
          tagId: tag.id,
          source: "EVENT",
          quantity: tag.stackable ? count : 1,
          expiresTurn: expiryFor(tag, turn),
        });
        continue;
      }
      // Already held: top up a stack, but leave a non-stackable row entirely
      // alone — deliberately NOT resetting its expiresTurn, since the
      // character's existing one is the live truth and clobbering it would
      // silently extend (or cut short) something they already had.
      if (tag.stackable) increments.push({ id: held.id, by: count });
    }
  }

  if (creates.length === 0 && increments.length === 0) return null;

  await prisma.$transaction([
    ...(creates.length ? [prisma.characterTag.createMany({ data: creates, skipDuplicates: true })] : []),
    ...increments.map((inc) =>
      prisma.characterTag.update({ where: { id: inc.id }, data: { quantity: { increment: inc.by } } }),
    ),
  ]);

  return {
    characters: owedByCharacter.size,
    granted: creates.length,
    toppedUp: increments.length,
  };
}

module.exports = { applyExpiryGrants };
