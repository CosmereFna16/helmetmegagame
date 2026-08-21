// One-off backfill: creates+assigns a personal Discord role for any ALIVE
// character that predates the roles/permissions rework (i.e. has no
// discordRoleId yet). Safe to re-run — skips characters that already have
// one. Standalone REST calls rather than importing
// web/lib/discordGuild.js#ensureCharacterRole, since that file relies on
// Next.js's "@/..." path aliases which don't resolve outside the web
// package.
require("dotenv").config();
const { prisma, hashNameToColor, formatBareName } = require("../index");

const DISCORD_API = "https://discord.com/api/v10";

async function main() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!guildId || !token) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", discordRoleId: null, firstName: { not: "" } },
  });

  for (const character of characters) {
    // Bare (first + last) for both the role name and the colour seed, matching
    // web/lib/discordGuild.js#ensureCharacterRole. Log lines still use the
    // displayed name, since that's what a GM would recognise.
    const bare = formatBareName(character);
    const color = hashNameToColor(bare);

    const roleRes = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: bare, color, hoist: false, mentionable: true }),
    });
    if (!roleRes.ok) {
      console.error(`  failed to create role for ${character.name}: ${roleRes.status} ${await roleRes.text()}`);
      continue;
    }
    const role = await roleRes.json();

    const assignRes = await fetch(
      `${DISCORD_API}/guilds/${guildId}/members/${character.discordUserId}/roles/${role.id}`,
      { method: "PUT", headers: { Authorization: `Bot ${token}` } },
    );
    if (!assignRes.ok && assignRes.status !== 204) {
      console.error(`  failed to assign role to ${character.discordUserId}: ${assignRes.status} ${await assignRes.text()}`);
    }

    await prisma.character.update({ where: { id: character.id }, data: { discordRoleId: role.id } });
    console.log(`created+assigned role for ${character.name}`);
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
