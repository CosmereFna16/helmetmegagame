// Manual, terminal-invoked sync from docs/locations.yaml -> DB + Discord.
// Run with `npm run db:sync-locations`. Never runs automatically (no cron,
// no per-turn hook) — the user explicitly wants this pushed by hand.
//
// Two passes:
//   1. DB upsert: for each YAML entry, upsert its Zone (by name) and its
//      Location (matched by slug — falling back to a name+zone match for
//      legacy rows that predate `slug`, so this doesn't create duplicates
//      for locations that already exist). Only name/tags/zoneId are ever
//      written here — discord*Id fields are untouched.
//   2. Discord provisioning: any Location still missing discordCategoryId
//      gets its category + 3 channels created, exactly like the GM Panel's
//      "Provision Discord channels" button
//      (web/app/(app)/gm/dev/actions.js#provisionLocationChannels). Already-
//      provisioned locations are never touched — renaming `name` in the
//      YAML after provisioning does NOT rename the live Discord channels,
//      so this can't break channels or drop message history.
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { prisma } = require("../index");

const DISCORD_API = "https://discord.com/api/v10";
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const gmRoleId = process.env.DISCORD_GM_ROLE_ID;

const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;
const PERM_CREATE_PUBLIC_THREADS = 34359738368;
const PERM_CREATE_PRIVATE_THREADS = 68719476736;

async function createGuildChannel(payload) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to create channel "${payload.name}": ${res.status} ${await res.text()}`);
  return res.json();
}

async function provisionLocationChannels(location) {
  const category = await createGuildChannel({
    name: `${location.zone.name} » ${location.name}`,
    type: 4,
    permission_overwrites: [
      { id: guildId, type: 0, deny: String(PERM_VIEW_CHANNEL) },
      ...(gmRoleId ? [{ id: gmRoleId, type: 0, allow: String(PERM_VIEW_CHANNEL) }] : []),
    ],
  });
  const plainChannel = await createGuildChannel({
    name: location.name,
    type: 0,
    parent_id: category.id,
    rate_limit_per_user: 60,
  });
  const publicChannel = await createGuildChannel({ name: `${location.name}-public`, type: 15, parent_id: category.id });
  const privateChannel = await createGuildChannel({
    name: `${location.name}-private`,
    type: 0,
    parent_id: category.id,
    permission_overwrites: [
      {
        id: guildId,
        type: 0,
        deny: String(PERM_SEND_MESSAGES + PERM_CREATE_PUBLIC_THREADS),
        allow: String(PERM_CREATE_PRIVATE_THREADS),
      },
    ],
  });

  await prisma.location.update({
    where: { id: location.id },
    data: {
      discordCategoryId: category.id,
      discordChannelId: plainChannel.id,
      discordPublicChannelId: publicChannel.id,
      discordPrivateChannelId: privateChannel.id,
    },
  });
}

async function main() {
  if (!token || !guildId) {
    console.error("DISCORD_GUILD_ID and DISCORD_TOKEN must be set.");
    process.exit(1);
  }

  const yamlPath = path.join(__dirname, "..", "..", "docs", "locations.yaml");
  const doc = yaml.load(fs.readFileSync(yamlPath, "utf8"));
  const entries = doc?.locations ?? [];

  const zoneCache = new Map();
  async function resolveZone(name) {
    if (zoneCache.has(name)) return zoneCache.get(name);
    let zone = await prisma.zone.findFirst({ where: { name } });
    if (!zone) {
      zone = await prisma.zone.create({ data: { name } });
      console.log(`created zone: ${name}`);
    }
    zoneCache.set(name, zone);
    return zone;
  }

  const upserted = [];
  for (const entry of entries) {
    const zone = await resolveZone(entry.zone);
    const tags = entry.tags ?? [];

    let location = await prisma.location.findUnique({ where: { slug: entry.id } });
    if (!location) {
      // Fall back to matching a pre-existing, pre-slug row by name+zone so
      // this doesn't create a duplicate for locations seeded before slug
      // existed — it just claims the slug onto that row instead.
      location = await prisma.location.findFirst({ where: { name: entry.name, zoneId: zone.id } });
    }

    if (!location) {
      location = await prisma.location.create({
        data: { slug: entry.id, name: entry.name, zoneId: zone.id, tags },
      });
      console.log(`created location: ${entry.name} (${entry.id})`);
    } else {
      const needsUpdate =
        location.slug !== entry.id ||
        location.name !== entry.name ||
        location.zoneId !== zone.id ||
        JSON.stringify(location.tags) !== JSON.stringify(tags);
      if (needsUpdate) {
        location = await prisma.location.update({
          where: { id: location.id },
          data: { slug: entry.id, name: entry.name, zoneId: zone.id, tags },
        });
        console.log(`updated location: ${entry.name} (${entry.id})`);
      } else {
        console.log(`unchanged: ${entry.name} (${entry.id})`);
      }
    }
    location.zone = zone;
    upserted.push(location);
  }

  const unprovisioned = upserted.filter((l) => !l.discordCategoryId);
  console.log(`${unprovisioned.length} location(s) need Discord provisioning`);
  for (const location of unprovisioned) {
    await provisionLocationChannels(location);
    console.log(`provisioned: ${location.name}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
