// Writing a corpse. One Tag row per death, dropped on the floor where they
// fell. See docs/systemdocs/CORPSES.md.
//
// This is the THIRD authoring door onto the tag catalog, beside docs/tags.yaml
// and the GM form at /gm/dev/tags — and the only one no human touches. The row
// it writes carries `custom: true` so db:sync-tags (upsert-by-slug) never sees
// it and db:prune-tags skips it, exactly as a GM's homebrew is protected; what
// separates it from a GM's is Tag.corpseOfCharacterId, which is also what makes
// the Restart Game wipe able to delete precisely these and nothing else.
//
// Takes `prisma` (or a tx) as a parameter, the db/lib/dm.js convention, and
// stays off the @lifeweb/db barrel.
const { CORPSE_GROUP_SLUG, CORPSE_ROT_TURNS } = require("./constants");
const { pickRandomPublicRoom } = require("./roomStash");
const { addToRoomStack, addToStack } = require("./tagWrites");
const { expiryFrom } = require("./turnFormat");

function corpseName(name) {
  return `${name}'s Corpse`;
}

function corpseDescription(name) {
  return `The lifeless body of ${name}. ‡`;
}

// Slugified from the name like every other slug in the catalog, with the
// `custom-` prefix that keeps it out of the YAML's namespace forever. The
// `-corpse` suffix is inside the prefix rather than appended to a bare name so
// a character actually called "Corpse" still produces something readable.
function corpseSlug(name, suffix = 0) {
  const base = (name ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `custom-${base || "unnamed"}-corpse${suffix ? `-${suffix}` : ""}`;
}

// Two characters can share a name, and Tag.name and Tag.slug are both @unique.
// Retrying on the unique violation rather than checking first is deliberate:
// two deaths resolving in the same turn-close would both pass a pre-check and
// then one would throw. Six attempts is far past anything the game can produce.
async function createCorpseTag(tx, character, groupId, expiresTurn) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const suffixed = attempt ? `${corpseName(character.name)} (${attempt + 1})` : corpseName(character.name);
    try {
      return await tx.tag.create({
        data: {
          slug: corpseSlug(character.name, attempt),
          name: suffixed,
          description: corpseDescription(character.name),
          category: "items",
          groupId,
          pointCost: 0,
          custom: true,
          corpseKind: "FRESH",
          corpseOfCharacterId: character.id,
          // ALWAYS because you are visibly hauling a body — the exact case
          // docs/tags.yaml's `visible: true` rule names.
          inspectVisibility: "ALWAYS",
          tradeable: true,
          // One body is one body. The non-stackable pin in tagWrites.js is
          // also what stops two people each holding "the" corpse.
          stackable: false,
          // Not binnable from the Destroy menu: Butcher and Bury are the only
          // two ways a body leaves the world.
          removable: false,
          consumable: false,
          purchasable: false,
          purchasableAfterStart: false,
          defaultDurationTurns: CORPSE_ROT_TURNS,
        },
      });
    } catch (err) {
      // P2002 is the @unique on name or slug — someone shares this name.
      if (err?.code !== "P2002") throw err;
    }
  }
  return null;
}

// The whole death-side story: mint the corpse and put it somewhere.
//
// Returns { tag, room } — `room` null when it landed on the dead character's
// own sheet instead. That fallback is not an error case: a Location with no
// public room (or an unplaced character) still has to leave a body, and the
// sheet is a perfectly good place for it, because corpseFollow's reconcile
// then reads "the corpse is on the character it belongs to" and does nothing.
//
// Idempotent by Tag.corpseOfCharacterId being @unique: a resumed turn close
// re-running the death pass finds the row already there and returns it rather
// than writing a second body.
async function mintCorpse(tx, character, turn = null) {
  const existing = await tx.tag.findUnique({ where: { corpseOfCharacterId: character.id } });
  if (existing) return { tag: existing, room: null, alreadyExisted: true };

  const group = await tx.tagGroup.findUnique({ where: { slug: CORPSE_GROUP_SLUG }, select: { id: true } });
  // No group means db:sync-tags has not run since this feature shipped. A
  // missing corpse is bad; a death that throws is worse, so say so and let the
  // rest of the death proceed.
  if (!group) {
    console.error(`mintCorpse: no "${CORPSE_GROUP_SLUG}" tag group — run db:sync-tags.`);
    return { tag: null, room: null };
  }

  const expiresTurn = turn ? expiryFrom(turn.number + 1, CORPSE_ROT_TURNS) : null;
  const tag = await createCorpseTag(tx, character, group.id, expiresTurn);
  if (!tag) {
    console.error(`mintCorpse: could not find a free name for ${character.name}'s corpse.`);
    return { tag: null, room: null };
  }

  const room = await pickRandomPublicRoom(tx, character.locationId);
  if (room) {
    await addToRoomStack(tx, room.id, tag.id, 1, { expiresTurn });
  } else {
    await addToStack(tx, character.id, tag.id, 1, { source: "EVENT", expiresTurn, stackable: false });
  }
  return { tag, room };
}

// Taking a body out of the world completely — used by a GM Revive, where the
// person is walking around again and their corpse must not still be on a shelf.
//
// The holdings go FIRST, and that ordering is not optional: RoomTag.tagId
// cascades from Tag but CharacterTag.tagId is RESTRICT, so deleting a corpse
// somebody is carrying throws a foreign-key error rather than doing anything.
// (The Restart Game wipe gets this right for free, because it clears both
// holding tables before it deletes Characters.)
//
// NOT used by Butcher or Bury. Those consume the HOLDING and deliberately
// leave the Tag row behind, because a GM's Undo has to be able to put the body
// back — see web/lib/requestEffects.js.
async function deleteCorpseFor(db, characterId) {
  const tag = await db.tag.findUnique({ where: { corpseOfCharacterId: characterId }, select: { id: true } });
  if (!tag) return false;
  await db.characterTag.deleteMany({ where: { tagId: tag.id } });
  await db.roomTag.deleteMany({ where: { tagId: tag.id } });
  await db.tag.delete({ where: { id: tag.id } });
  return true;
}

module.exports = { mintCorpse, deleteCorpseFor, corpseName, corpseDescription, corpseSlug };
