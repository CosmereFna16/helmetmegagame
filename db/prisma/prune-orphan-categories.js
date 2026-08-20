// One-off cleanup: delete Discord Location categories (and their channels)
// that no Location row points at anymore.
//
// This exists for the case where the DB lost its Location rows while the
// Discord side survived — the categories are then unreachable by
// syncLocationsFromYaml's normal prune (which works off DB rows), so a
// re-sync would provision a second set alongside them.
//
// DESTRUCTIVE and irreversible: deleted channels take their message history
// with them. Runs a dry run by default; pass --apply to actually delete.
//
//   node db/prisma/prune-orphan-categories.js            # list what would go
//   node db/prisma/prune-orphan-categories.js --apply    # do it
//
// Categories are identified as Location categories by the "{Zone} / {Location}"
// naming convention provisionLocationChannels uses (any separator, since a GM
// may have hand-renamed the divider). Anything whose name doesn't parse that
// way, or that a live Location row still claims, is left strictly alone.
require("dotenv").config();
const { prisma } = require("../index");

const API = "https://discord.com/api/v10";
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const TOKEN = process.env.DISCORD_TOKEN;
const APPLY = process.argv.includes("--apply");

// "Fortress / Keep", "Fortress » Keep", "Fortress - Keep" all parse; a bare
// "Gameplay" or "Text Channels" does not, and is therefore never touched.
const CATEGORY_NAME = /^\s*[^/»|-]+\s*[/»|-]\s*.+$/;
const CHANNEL_TYPE_CATEGORY = 4;

async function api(path, init) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${TOKEN}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok && res.status !== 404) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

async function main() {
  if (!GUILD_ID || !TOKEN) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const channels = await api(`/guilds/${GUILD_ID}/channels`);
  const claimed = new Set(
    (await prisma.location.findMany({ select: { discordCategoryId: true } }))
      .map((l) => l.discordCategoryId)
      .filter(Boolean),
  );

  const orphans = channels.filter(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && CATEGORY_NAME.test(c.name) && !claimed.has(c.id),
  );

  if (orphans.length === 0) {
    console.log("No orphaned Location categories found.");
    return;
  }

  console.log(`${orphans.length} orphaned categor${orphans.length === 1 ? "y" : "ies"}:`);
  for (const cat of orphans) {
    const kids = channels.filter((c) => c.parent_id === cat.id);
    console.log(`  [${cat.name}] + ${kids.length} channel(s): ${kids.map((k) => `#${k.name}`).join(", ")}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to delete these.");
    return;
  }

  console.log("\nDeleting...");
  for (const cat of orphans) {
    // Children first — Discord orphans them to the guild root otherwise.
    for (const kid of channels.filter((c) => c.parent_id === cat.id)) {
      await api(`/channels/${kid.id}`, { method: "DELETE" });
      console.log(`  deleted #${kid.name}`);
      await new Promise((r) => setTimeout(r, 350)); // stay under the rate limit
    }
    await api(`/channels/${cat.id}`, { method: "DELETE" });
    console.log(`deleted [${cat.name}]`);
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log("\nDone. Now run `npm run db:sync-locations` to provision the current set.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
