// One-off backfill: grants each ALIVE character's personal Discord role a
// ViewChannel overwrite on the category of their current Character.locationId
// (see bot/src/lib/location.js#swapLocationAccess and
// web/lib/discordGuild.js#syncCharacterLocationAccess, the two live call
// sites that keep this in sync going forward — this script exists only for
// characters whose location was set before those existed, e.g. by seed data
// or a raw DB write). Safe to re-run: PUT on an existing overwrite is a
// no-op. Does NOT remove stray overwrites on other categories, since the
// live call sites already guarantee at most one is ever set per character.
require("dotenv").config();
const { prisma } = require("../index");

const DISCORD_API = "https://discord.com/api/v10";
const PERM_VIEW_CHANNEL = 1024;

async function main() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error("DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", discordRoleId: { not: null }, locationId: { not: null } },
    include: { location: true },
  });

  for (const character of characters) {
    if (!character.location?.discordCategoryId) continue;

    const res = await fetch(
      `${DISCORD_API}/channels/${character.location.discordCategoryId}/permissions/${character.discordRoleId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: character.discordRoleId, type: 0, allow: String(PERM_VIEW_CHANNEL) }),
      },
    );
    if (!res.ok && res.status !== 204) {
      console.error(`  failed for ${character.name}: ${res.status} ${await res.text()}`);
      continue;
    }
    console.log(`granted ${character.name} -> ${character.location.name}`);
  }

  console.log(`done (${characters.length} character(s) processed)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
