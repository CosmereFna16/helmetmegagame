// Which equipped things cannot be worn together.
//
// GameConfig.equipSlots is a flat COUNT — six things, whatever they are — and
// it was the only limit for a long time, which meant a character could equip
// three helmets and two shields as long as they had the slots free. This adds
// the other half: Tag.equipSlot says where a thing sits, and Tag.equipLayer 1-4
// says how deep, so a mail coif (1) goes under a knight's helm (3) and two
// helms do not go together at all.
//
// SHIELD carries no layer, because there is only ever one shield.
//
// Two independent code paths flip CharacterTag.equipped — the player's own
// toggle (web/app/(app)/character/equipActions.js) and the GM/staged batch
// (db/lib/tagOps.js) — so the rule lives here rather than in either of them. It
// is written as "look at the whole equipped set and find a clash" rather than
// "may I add this one?", because the batch path applies its writes first and
// then checks, and a two-argument form could not express "unequip A, equip B"
// without rejecting B for a conflict with an A that is already gone.
//
// See docs/systemdocs/TAGS.md.

const SLOT_LABELS = { HEAD: "on your head", BODY: "on your body", SHIELD: "in your off hand" };

// Accepts CharacterTag[] (with .tag) or bare Tag[], like forcedNameFrom.
function tagOf(entry) {
  return entry?.tag ?? entry;
}

/**
 * The first pair of equipped tags that cannot be worn together.
 * @param {Array} tags equipped rows — CharacterTag[] (with .tag) or Tag[]
 * @returns {{a: object, b: object}|null} the clashing pair, outermost first
 */
function findSlotClash(tags) {
  if (!Array.isArray(tags)) return null;
  const seen = new Map();
  for (const entry of tags) {
    const tag = tagOf(entry);
    if (!tag?.equipSlot) continue;
    // A layered slot keys on slot+layer; SHIELD keys on the slot alone, which
    // is what makes it hold exactly one.
    const key = tag.equipLayer == null ? tag.equipSlot : `${tag.equipSlot}:${tag.equipLayer}`;
    const other = seen.get(key);
    if (other) return { a: tag, b: other };
    seen.set(key, tag);
  }
  return null;
}

/**
 * Why that pair cannot be worn together, as a sentence for a player.
 * Ends in ‡ — it is drafted copy like everything else here.
 */
function describeSlotClash({ a, b }) {
  const where = SLOT_LABELS[a.equipSlot] ?? "there";
  return `${a.name} and ${b.name} can't both go ${where}. ‡`;
}

module.exports = { findSlotClash, describeSlotClash };
