// TEMPORARY read-only diagnostic. Run with:
//   node db/prisma/check-location-permissions.js
//
// Dumps the live Discord permission state for every Location so we can see
// what is actually set rather than what the spec intends. Writes nothing.
// Delete this file once the permission incident is closed.
require("dotenv").config();
const { prisma } = require("../index");
const { getChannel } = require("../lib/discordRest");
const { SPECTATOR_ROLE_ID } = require("../lib/roleIds");

const VIEW = 1024n;

function viewState(overwrite) {
  if (!overwrite) return "ABSENT (no entry)";
  const allow = BigInt(overwrite.allow ?? "0");
  const deny = BigInt(overwrite.deny ?? "0");
  if (deny & VIEW) return "DENY  ✅ hidden";
  if (allow & VIEW) return "ALLOW ❌ VISIBLE";
  return "NEUTRAL ❌ VISIBLE (no view bit either way)";
}

function label(id, guildId, gmRoleId, roleIdToName, userIdToName) {
  if (id === guildId) return "@everyone";
  if (id === gmRoleId) return "GM role";
  if (id === SPECTATOR_ROLE_ID) return "spectator";
  // The live model: access is a per-member overwrite keyed on discordUserId.
  if (userIdToName.has(id)) return `character (member): ${userIdToName.get(id)}`;
  // Legacy, pre-backfill-member-access. Seeing these means the migration
  // hasn't run yet (or didn't finish).
  if (roleIdToName.has(id)) return `character ROLE (stale): ${roleIdToName.get(id)}`;
  return `unknown ${id}`;
}

async function main() {
  const guildId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;
  if (!process.env.DISCORD_TOKEN || !guildId) {
    console.error("DISCORD_TOKEN and DISCORD_GUILD_ID must be set.");
    process.exit(1);
  }

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: { name: true, discordRoleId: true, discordUserId: true, locationId: true },
  });
  const roleIdToName = new Map(
    characters.filter((c) => c.discordRoleId).map((c) => [c.discordRoleId, c.name]),
  );
  const userIdToName = new Map(
    characters.filter((c) => c.discordUserId).map((c) => [c.discordUserId, c.name]),
  );

  const locations = await prisma.location.findMany({ include: { zone: true }, orderBy: { name: "asc" } });
  console.log(`${locations.length} locations, ${characters.length} alive characters\n`);

  let exposed = 0;
  for (const loc of locations) {
    console.log(`=== ${loc.zone.name} / ${loc.name}  (slug: ${loc.slug})`);
    const targets = [
      ["category", loc.discordCategoryId],
      ["summary ", loc.discordChannelId],
      ["public  ", loc.discordPublicChannelId],
      ["private ", loc.discordPrivateChannelId],
    ];

    for (const [kind, id] of targets) {
      if (!id) {
        console.log(`  ${kind}  ⚠️  NO ID RECORDED IN DB`);
        continue;
      }
      let ch;
      try {
        ch = await getChannel(id);
      } catch (err) {
        console.log(`  ${kind}  ⚠️  FETCH FAILED: ${err.message}`);
        continue;
      }
      const ows = ch?.permission_overwrites ?? [];
      const everyone = ows.find((o) => o.id === guildId);
      const state = viewState(everyone);
      if (state.includes("VISIBLE") && kind !== "category") exposed += 1;
      console.log(`  ${kind}  parent=${ch?.parent_id ?? "NONE"}  @everyone view: ${state}`);
      const others = ows.filter((o) => o.id !== guildId);
      for (const o of others) {
        console.log(
          `             · ${label(o.id, guildId, gmRoleId, roleIdToName, userIdToName)} type=${o.type} allow=${o.allow} deny=${o.deny}`,
        );
      }
      if (others.length === 0) console.log("             · (no other overwrites)");
    }
    const residents = characters.filter((c) => c.locationId === loc.id).map((c) => c.name);
    console.log(`  residents: ${residents.length ? residents.join(", ") : "(none)"}\n`);
  }

  console.log(`\nSUMMARY: ${exposed} non-category channels are currently VISIBLE to @everyone.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
