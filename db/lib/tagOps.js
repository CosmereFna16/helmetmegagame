// The tag-op engine: validate and apply the Dev Panel's staged tag-change
// ops. Shared with db/lib/stagedPush.js, which applies the same ops at turn
// end; db/ cannot import web/, so this lives here rather than in web/lib.
//
// An op is keyed by tagId, never characterTagId — a characterTagId can vanish
// between page load and Apply (the expiry sweep in resolveNeeds() deletes
// rows at every turn close), while @@unique([characterId, tagId]) makes tagId
// a stable address. Op shapes: DEV-PANEL.md §5. Every function takes a
// transaction client (`tx`), so a caller composes them into its own.

const { describeSlotClash, findSlotClash } = require("./equipSlots");
const { addToStack, dropCharacterTag, grantTagSlugs } = require("./tagWrites");
const { rollTagChain } = require("./tagShapes");
const { expiryForGrant } = require("./grantExpiry");

// A validation failure a human caused and a human can fix. Web callers map
// this onto their UserError (web/lib/characterWrite.js) so guarded() renders
// it; the push pass records it on the row instead of throwing at the turn.
class TagOpError extends Error {}

function validateTagOps(ops, tagsById, held) {
  for (const op of ops ?? []) {
    const tag = tagsById.get(op.tagId);
    if (!tag) throw new TagOpError("One of those tags no longer exists.");
    if (op.op === "add" || op.op === "patch") {
      const qty = op.quantity ?? 1;
      if (!Number.isInteger(qty) || qty < 1) {
        throw new TagOpError(`Quantity for ${tag.name} must be a whole number of at least 1.`);
      }
      // addToStack silently pins a non-stackable to 1; say so instead of
      // letting the GM think they granted three. There is no GM override
      // here: a GM surface ignores requiredTag, the group gate and the
      // budget, but `stackable` describes the shape of the row rather than
      // who may hold what, and both GM composers now hide the quantity box
      // on a tag that doesn't carry one (TAGS.md §5a).
      if (qty > 1 && !tag.stackable) {
        throw new TagOpError(`${tag.name} doesn't stack — grant it once.`);
      }
      if (op.equipped && !tag.equippable) {
        throw new TagOpError(`${tag.name} isn't something that can be equipped.`);
      }
    }
    if (op.op === "patch" && !held.has(op.tagId)) {
      throw new TagOpError(`${tag.name} isn't on this sheet to adjust.`);
    }
  }
}

async function expiresTurnFor(tx, op, tag, openTurn, characterId) {
  const mode = op.expiry?.mode ?? "default";
  if (mode === "never") return null;
  // The column is an absolute turn number, never a countdown.
  if (mode === "at") return op.expiry.turn ?? null;
  // "default": expiryForGrant returns null for an untimed tag and the correct
  // absolute turn for a timed one. Skipping it is how a GM-granted Paralyzed
  // becomes permanent — resolveNeeds()'s sweep matches on expiresTurn, so a
  // null there never expires at all. expiryForGrant, not plain expiryFor,
  // because openTurn is null for the whole of a turn advance (and for hours
  // after a wedged one); see db/lib/grantExpiry.js.
  return expiryForGrant(tx, tag, openTurn, { characterId, where: "tagOps" });
}

// Applies staged tag changes inside a transaction. Order is load-bearing:
// removes first, so swapping one tier of a chain for another can't trip the
// equip cap halfway through.
async function applyTagOpsInTx(tx, { characterId, ops, tagsById, openTurn, equipSlots }) {
  const applied = [];
  const removes = ops.filter((o) => o.op === "remove");
  const adds = ops.filter((o) => o.op === "add");
  const patches = ops.filter((o) => o.op === "patch");

  // The treated-wound aftermath (Tag.removesInto, TAGS.md §5c) applies to a
  // GM removal too: most GM removals ARE treatments — a staged effect
  // resolving a wound, a Dev Panel revoke after a scene — and a cure that
  // costs nothing makes medicine pointless.
  //
  // Rolled once per op, up front, so the `applied` snapshot records exactly
  // what happened rather than what a re-roll would say. Granted after the
  // adds below, not here: that way an explicit GM add of the same aftermath,
  // with its own source and expiry, wins.
  const aftermath = [];

  for (const op of removes) {
    const tag = tagsById.get(op.tagId);
    // dropCharacterTag is a quiet no-op on a tag the character doesn't hold,
    // and a removal that removed nothing must not mint an aftermath either.
    const held = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId: op.tagId } },
    });
    await dropCharacterTag(tx, characterId, op.tagId, op.quantity ?? null);
    const entry = { op: "remove", tagId: op.tagId, name: tag.name, quantity: op.quantity ?? null };
    // Fires once per op regardless of quantity, the same rule the player-side
    // REMOVE_TAG request uses. Nothing carrying removesInto stacks anyway.
    if (held) {
      const slugs = rollTagChain(tag.removesInto);
      if (slugs.length) aftermath.push({ entry, slugs });
    }
    applied.push(entry);
  }

  for (const op of adds) {
    const tag = tagsById.get(op.tagId);
    await addToStack(tx, characterId, op.tagId, op.quantity ?? 1, {
      source: op.source ?? "GM_GRANT",
      stackable: tag.stackable,
      expiresTurn: await expiresTurnFor(tx, op, tag, openTurn, characterId),
    });
    applied.push({ op: "add", tagId: op.tagId, name: tag.name, quantity: op.quantity ?? 1 });
  }

  for (const { entry, slugs } of aftermath) {
    entry.granted = await grantTagSlugs(tx, characterId, slugs, openTurn?.number ?? null);
  }

  for (const op of patches) {
    const tag = tagsById.get(op.tagId);
    const row = await tx.characterTag.findUnique({
      where: { characterId_tagId: { characterId, tagId: op.tagId } },
    });
    if (!row) continue;
    const data = {};
    if (op.quantity != null) data.quantity = tag.stackable ? op.quantity : 1;
    if (op.source) data.source = op.source;
    if (op.expiry) data.expiresTurn = await expiresTurnFor(tx, op, tag, openTurn, characterId);
    if (Object.keys(data).length) {
      await tx.characterTag.update({ where: { id: row.id }, data });
    }
    // equipped is written by the batch pass below, not here, but it still
    // belongs in the audit record of what this patch did.
    applied.push({
      op: "patch",
      tagId: op.tagId,
      name: tag.name,
      ...data,
      ...(op.equipped != null ? { equipped: Boolean(op.equipped) } : {}),
    });
  }

  // Equipped last, and counted ONCE for the whole batch rather than per op:
  // a GM staging "unequip A, equip B" must not be rejected on B just because
  // A hasn't been written yet.
  const equipOps = ops.filter((o) => o.equipped != null && o.op !== "remove");
  if (equipOps.length) {
    for (const op of equipOps) {
      await tx.characterTag.updateMany({
        where: { characterId, tagId: op.tagId },
        data: { equipped: Boolean(op.equipped) },
      });
    }
    const equipped = await tx.characterTag.count({ where: { characterId, equipped: true } });
    if (equipped > equipSlots) {
      throw new TagOpError(`That would fill ${equipped} of ${equipSlots} equipment slots.`);
    }
    // And the other half of the limit: a count of six says nothing about six
    // helmets. Same helper the player's own toggle uses, so a GM cannot stage
    // a set the sheet would refuse.
    const worn = await tx.characterTag.findMany({
      where: { characterId, equipped: true },
      select: { tag: { select: { name: true, equipSlot: true, equipLayer: true } } },
    });
    const clash = findSlotClash(worn);
    if (clash) throw new TagOpError(describeSlotClash(clash));
  }

  return applied;
}

module.exports = { TagOpError, validateTagOps, applyTagOpsInTx };
