// Repair pass for the four-part character name (honorific / firstName /
// title / lastName). The 20260822000000_character_name_parts migration does
// the real split in SQL, so on a normally-migrated database this reports zero
// repairs — it exists for two jobs afterwards:
//
//   1. A database restored from a dump older than that migration, where
//      firstName came back blank. Re-split it from `name`.
//   2. Drift on `name`, which is a denormalized mirror of
//      formatCharacterName(...) (see the Character model in schema.prisma).
//      Three writers keep it in sync and all three go through the formatter;
//      this is what catches a fourth that doesn't.
//
// Deliberately makes no Discord calls at all — which is precisely why running
// it can never rename or recolour anyone's personal role.
require("dotenv").config();
const { prisma, formatCharacterName, splitLegacyName } = require("../index");

async function main() {
  const characters = await prisma.character.findMany();

  let resplit = 0;
  let renamed = 0;

  for (const character of characters) {
    const data = {};

    // 1. Blank firstName — recover the parts from the legacy single string.
    if (!character.firstName?.trim()) {
      const { firstName, lastName } = splitLegacyName(character.name);
      if (firstName) {
        Object.assign(data, { firstName, lastName });
        resplit += 1;
        console.log(`re-split ${character.id}: ${JSON.stringify(character.name)} -> ${firstName} / ${lastName ?? "-"}`);
      }
    }

    // 2. Drift check, against the parts as they will be after any re-split.
    const expected = formatCharacterName({ ...character, ...data });
    if (expected && expected !== character.name) {
      data.name = expected;
      renamed += 1;
      console.log(`name drift ${character.id}: ${JSON.stringify(character.name)} -> ${JSON.stringify(expected)}`);
    }

    if (Object.keys(data).length) {
      await prisma.character.update({ where: { id: character.id }, data });
    }
  }

  console.log(`done (${characters.length} processed, ${resplit} re-split, ${renamed} name(s) repaired)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
