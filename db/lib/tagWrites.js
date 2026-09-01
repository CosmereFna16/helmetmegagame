// Tag writes shared by both faces of the game.
//
// `dropCharacterTag` used to live in web/lib/requestEffects.js, which is ESM
// and therefore unreachable from the CommonJS bot. The GM `/heal` command
// needs it, so it moved here and requestEffects.js re-exports it — the same
// treatment web/lib/healRequests.js already gives
// @lifeweb/db/lib/medicalVision, and for the same reason: two
// implementations of a tag write would eventually disagree.
//
// Every function here takes a transaction client (`tx`) as its first
// parameter rather than reaching for the singleton, so a caller can compose
// it into a larger transaction. That is the db/lib/dm.js convention.

// Adds `quantity` of a tag, creating the row or incrementing an existing
// one. Non-stackable tags are pinned at 1 no matter what is asked for, so a
// caller that forgot to check `tag.stackable` can't mint a phantom stack.
//
// Moved down from web/lib/requestEffects.js (which re-exports it) for the
// same reason dropCharacterTag was: the staged-push pass in
// db/lib/stagedPush.js grants tags at turn end, and two implementations of a
// tag write would eventually disagree.
async function addToStack(tx, characterId, tagId, quantity, options = {}) {
  const { source = "GM_GRANT", expiresTurn = null, stackable = false } = options;
  const n = stackable ? Math.max(1, Math.trunc(quantity ?? 1)) : 1;
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId } },
  });
  if (!existing) {
    return tx.characterTag.create({
      data: { characterId, tagId, source, expiresTurn, quantity: n },
    });
  }
  if (!stackable) return existing;
  return tx.characterTag.update({
    where: { id: existing.id },
    data: { quantity: existing.quantity + n },
  });
}

// Removes `quantity` of a tag, deleting the row once nothing is left. Pass
// null (the default) to drop the whole holding however large the stack —
// that is what an ordinary, non-stackable tag always wants.
async function dropCharacterTag(tx, characterId, tagId, quantity = null) {
  const existing = await tx.characterTag.findUnique({
    where: { characterId_tagId: { characterId, tagId } },
  });
  if (!existing) return;
  const take = quantity == null ? existing.quantity : Math.max(1, Math.trunc(quantity));
  if (take >= existing.quantity) {
    await tx.characterTag.delete({ where: { id: existing.id } });
    return;
  }
  await tx.characterTag.update({
    where: { id: existing.id },
    data: { quantity: existing.quantity - take },
  });
}

// Grants a list of tag SLUGS to one character — what a consumed tag turns
// into (Tag.consumesInto: a meal becoming Ate Meal, a crate unpacking into
// its contents), and what a removed one leaves behind (Tag.removesInto: the
// treated-wound aftermath). Slugs rather than ids because that is what the
// catalog carries, specifically so a slug may REPEAT: listing one twice is
// the only way to ask for two of something.
//
// Moved down from web/lib/requestEffects.js (which re-exports it) for the
// same reason addToStack and dropCharacterTag were: db/lib/tagOps.js fires
// the treated-wound aftermath on a GM removal, and db/ cannot import web/.
//
// Returns the snapshot Undo needs — one entry per distinct slug, with
// `added` being what was ACTUALLY put on the sheet. That is 0 for a
// non-stackable tag the character already held, which is left entirely alone
// (expiry included: their existing one is the live truth, and clobbering it
// would silently extend or cut short something they already had). Undo may
// only take back what this request really added.
async function grantTagSlugs(tx, characterId, slugs, turnNumber, durations = null) {
  if (!slugs?.length) return [];

  const owed = new Map();
  for (const slug of slugs) owed.set(slug, (owed.get(slug) ?? 0) + 1);

  const tags = await tx.tag.findMany({
    where: { slug: { in: [...owed.keys()] } },
    select: { id: true, slug: true, name: true, stackable: true, defaultDurationTurns: true },
  });
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]));

  const granted = [];
  for (const [slug, count] of owed) {
    // Unknown slugs are rejected at sync time (db/lib/syncTags.js), so this
    // can only be a row predating a catalog edit — skip it rather than fail
    // the whole request.
    const tag = tagBySlug.get(slug);
    if (!tag) continue;

    const existing = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId: tag.id } },
    });

    if (!existing) {
      // A granted tag with its own duration starts its clock now, which is
      // what makes a chain work (meal -> Ate Meal that the sweep clears).
      // Same absolute-turn expression as db/lib/hungerPass.js.
      //
      // A per-grant override (Tag.consumesIntoDurations, resolved by
      // web/lib/consumeGrants.js) wins over the tag's own duration, so one
      // status can outlast itself depending on what produced it — Bliss
      // leaves you High a turn longer than the raw fungus does.
      const durationTurns = durations?.[slug] ?? tag.defaultDurationTurns;
      const expiresTurn =
        turnNumber != null && durationTurns != null ? turnNumber + durationTurns : null;
      await tx.characterTag.create({
        data: {
          characterId,
          tagId: tag.id,
          source: "EVENT",
          quantity: tag.stackable ? count : 1,
          expiresTurn,
        },
      });
      granted.push({ tagId: tag.id, tagName: tag.name, added: tag.stackable ? count : 1 });
      continue;
    }

    if (tag.stackable) {
      await tx.characterTag.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + count },
      });
      granted.push({ tagId: tag.id, tagName: tag.name, added: count });
      continue;
    }

    granted.push({ tagId: tag.id, tagName: tag.name, added: 0 });
  }

  return granted;
}

module.exports = { addToStack, dropCharacterTag, grantTagSlugs };
