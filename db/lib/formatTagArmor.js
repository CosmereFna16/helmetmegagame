// "Melee: Good | Ballistic: Meager" — the armour line that rides under a tag's
// description wherever formatTagRequirement's line already does (web tooltip,
// chip, Discord inspect embed, Examine). Lives here rather than in web/ or bot/
// for the same reason that one does: both packages depend on @lifeweb/db and
// would otherwise keep two copies.
//
// Returns null for a tag with no armour value at all, which is most of the
// catalog, so callers can skip rendering entirely.
//
// Callers must select meleeArmor and ballisticArmor (ARMOR_TAG_FIELDS in
// db/lib/armorValue.js). A caller that forgets renders nothing rather than
// throwing — the same quiet failure formatTagRequirement warns about, and the
// one to check first when a new surface shows no armour.
//
// Both halves are always printed once either exists, "None" included. A
// breastplate reading `Melee: Strong | Ballistic: Meager` is the whole point of
// there being two numbers, and dropping the weak half would hide exactly the
// fact a player needs before walking into a turret.
const { armorWord } = require("./armorValue");

function formatTagArmor(tag) {
  const melee = tag?.meleeArmor;
  const ballistic = tag?.ballisticArmor;
  const hasMelee = typeof melee === "number" && melee > 0;
  const hasBallistic = typeof ballistic === "number" && ballistic > 0;
  if (!hasMelee && !hasBallistic) return null;
  return `Melee: ${armorWord(melee)} | Ballistic: ${armorWord(ballistic)}`;
}

module.exports = { formatTagArmor };
