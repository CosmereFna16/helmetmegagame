// One-off catch-up for SpecialChannel gate roles (#radio, #intercom, ...),
// the sibling of backfill-location-access.js. Run with
// `npm run db:backfill-special-access`.
//
// Normally gate-role membership is maintained live: character creation and
// the GM's grantTag/revokeTag both call
// web/lib/discordGuild.js#syncCharacterSpecialAccess. This script exists for
// the cases that bypass those paths — characters that predate the special
// channel system, tags granted directly in the DB, or a channel newly added
// to docs/channels.yaml whose gate nobody has been reconciled against yet.
//
// Reconciles in both directions for every ALIVE character: adds the gate role
// to holders, removes it from non-holders. Safe to re-run.
require("dotenv").config();
const { prisma } = require("../index");
const { addRoleToMember, removeRoleFromMember } = require("../lib/discordRest");

async function main() {
  if (!process.env.DISCORD_GUILD_ID || !process.env.DISCORD_TOKEN) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const channels = await prisma.specialChannel.findMany({
    where: { OR: [{ viewTagId: { not: null } }, { sendTagId: { not: null } }] },
  });
  const gates = channels
    .flatMap((c) => [
      { name: `${c.name}-view`, roleId: c.discordViewRoleId, tagId: c.viewTagId },
      { name: `${c.name}-send`, roleId: c.discordSendRoleId, tagId: c.sendTagId },
    ])
    .filter((g) => g.roleId && g.tagId);

  if (gates.length === 0) {
    console.log("No gated special channels — nothing to do.");
    return;
  }
  console.log(`${gates.length} gate(s): ${gates.map((g) => g.name).join(", ")}`);

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true, tags: { select: { tagId: true } } },
  });

  let added = 0;
  let removed = 0;
  for (const character of characters) {
    const held = new Set(character.tags.map((t) => t.tagId));
    for (const gate of gates) {
      const shouldHave = held.has(gate.tagId);
      try {
        if (shouldHave) {
          await addRoleToMember(character.discordUserId, gate.roleId);
          added++;
          console.log(`  + ${character.name} -> ${gate.name}`);
        } else {
          await removeRoleFromMember(character.discordUserId, gate.roleId);
          removed++;
        }
      } catch (err) {
        console.error(`  ! ${character.name} / ${gate.name}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 250)); // stay under the rate limit
    }
  }

  console.log(`\n${characters.length} character(s): ${added} grant(s), ${removed} revoke(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
