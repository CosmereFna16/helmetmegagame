// docs/channels.yaml -> the SpecialChannel table + the live Discord channels.
// Run by db/prisma/sync-channels.js (`npm run db:sync-channels`) and by
// wipeGameData's "Restart Game" flow. Must run AFTER syncTagsFromYaml, since
// every gate references a Tag by slug.
//
// Special channels are the ones that sit OUTSIDE a Location's
// category/3-channel layout — #radio, #intercom — gated on holding a
// particular Tag rather than on standing in a particular place.
//
// The access mechanism is deliberately different from Locations. A Location
// grants view via one permission overwrite per resident character, which is
// fine because a character stands in exactly one place at a time. A tag,
// though, can be held by everyone at once, and Discord caps a channel at
// ~100 overwrites — so tag gating goes through a plain guild role instead:
// each gate gets its own role, the channel carries at most three overwrites
// total, and membership is what changes as characters gain and lose the tag
// (web/lib/discordGuild.js#syncCharacterSpecialAccess).
//
// Overwrite table, by which gates are set:
//   viewTag set   -> @everyone denied ViewChannel; view role allowed it.
//   sendTag set   -> @everyone denied SendMessages; send role allowed it.
//   neither       -> no overwrites; the channel is fully public.
//
// Upsert-only, like syncTags: a channel dropped from the YAML keeps its row
// and its Discord channel, it just stops being updated. Provisioning is
// one-time (an existing channel is never renamed or recreated), but the topic
// and the overwrites are rewritten on every run.
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const {
  getGuildChannels,
  createChannel,
  patchChannel,
  getGuildRoles,
  createGuildRole,
  putChannelOverwrite,
} = require("./discordRest");
const { hashNameToColor } = require("./roleColor");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const CHANNEL_TYPE_TEXT = 0;

function loadDoc() {
  const yamlPath = path.join(__dirname, "..", "..", "docs", "channels.yaml");
  return yaml.load(fs.readFileSync(yamlPath, "utf8"));
}

// Gate roles are named after the channel so they're self-explanatory in
// Discord's role list, where a GM will see them next to the character roles.
function gateRoleName(entry, gate) {
  return `${entry.name}-${gate}`;
}

async function ensureGateRole(existingRoles, entry, gate, cachedId) {
  const name = gateRoleName(entry, gate);
  if (cachedId && existingRoles.some((r) => r.id === cachedId)) return cachedId;
  // Recover a role that exists in Discord but whose id we lost (e.g. the DB
  // was rebuilt) rather than creating a duplicate.
  const byName = existingRoles.find((r) => r.name === name);
  if (byName) return byName.id;
  const created = await createGuildRole({
    name,
    color: hashNameToColor(name),
    hoist: false,
    mentionable: false,
  });
  console.log(`created gate role "${name}"`);
  return created.id;
}

async function syncSpecialChannelsFromYaml(prisma) {
  const entries = loadDoc()?.channels ?? [];
  const stats = { created: 0, updated: 0, provisioned: [] };
  if (entries.length === 0) return stats;

  const tagIdBySlug = new Map(
    (await prisma.tag.findMany({ select: { id: true, slug: true } })).map((t) => [t.slug, t.id]),
  );
  for (const entry of entries) {
    for (const gate of ["viewTag", "sendTag"]) {
      if (entry[gate] && !tagIdBySlug.has(entry[gate])) {
        throw new Error(`docs/channels.yaml: channel "${entry.id}" has unknown ${gate} "${entry[gate]}" — run db:sync-tags first`);
      }
    }
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  const canReachDiscord = Boolean(guildId && process.env.DISCORD_TOKEN);
  const guildChannels = canReachDiscord ? await getGuildChannels() : [];
  const guildRoles = canReachDiscord ? await getGuildRoles() : [];

  for (const entry of entries) {
    const data = {
      name: entry.name,
      topic: entry.topic ?? "",
      isTupper: entry.tupper !== false,
      viewTagId: entry.viewTag ? tagIdBySlug.get(entry.viewTag) : null,
      sendTagId: entry.sendTag ? tagIdBySlug.get(entry.sendTag) : null,
    };

    let row = await prisma.specialChannel.findUnique({ where: { slug: entry.id } });
    if (!row) {
      row = await prisma.specialChannel.create({ data: { slug: entry.id, ...data } });
      stats.created++;
    } else if (Object.entries(data).some(([k, v]) => row[k] !== v)) {
      row = await prisma.specialChannel.update({ where: { id: row.id }, data });
      stats.updated++;
    }

    if (!canReachDiscord) continue;

    // Gate roles first — the overwrites below reference them.
    const viewRoleId = data.viewTagId ? await ensureGateRole(guildRoles, entry, "view", row.discordViewRoleId) : null;
    const sendRoleId = data.sendTagId ? await ensureGateRole(guildRoles, entry, "send", row.discordSendRoleId) : null;

    // Provisioning is one-time; recover an existing channel by name so a
    // rebuilt DB re-adopts it instead of creating a second one.
    let channelId = row.discordChannelId;
    if (!channelId || !guildChannels.some((c) => c.id === channelId)) {
      const existing = guildChannels.find((c) => c.type === CHANNEL_TYPE_TEXT && c.name === entry.name);
      if (existing) {
        channelId = existing.id;
      } else {
        const created = await createChannel({ name: entry.name, type: CHANNEL_TYPE_TEXT, topic: data.topic });
        channelId = created.id;
        stats.provisioned.push(entry.name);
        console.log(`provisioned #${entry.name}`);
      }
    } else {
      await patchChannel(channelId, { topic: data.topic });
    }

    // @everyone is denied exactly the permissions that are gated, and the
    // gate roles allow them back. A channel with no gates gets no overwrite
    // at all, leaving it fully public.
    let everyoneDeny = 0n;
    if (data.viewTagId) everyoneDeny |= PERM_VIEW_CHANNEL;
    if (data.sendTagId) everyoneDeny |= PERM_SEND_MESSAGES;
    if (everyoneDeny !== 0n) {
      await putChannelOverwrite(channelId, guildId, { deny: everyoneDeny });
    }
    if (viewRoleId) await putChannelOverwrite(channelId, viewRoleId, { allow: PERM_VIEW_CHANNEL });
    if (sendRoleId) {
      // A send-gated, publicly visible channel still needs ViewChannel in the
      // allow mask for members whose only overwrite is this role.
      await putChannelOverwrite(channelId, sendRoleId, { allow: PERM_VIEW_CHANNEL | PERM_SEND_MESSAGES });
    }

    await prisma.specialChannel.update({
      where: { id: row.id },
      data: { discordChannelId: channelId, discordViewRoleId: viewRoleId, discordSendRoleId: sendRoleId },
    });
  }

  return stats;
}

module.exports = { syncSpecialChannelsFromYaml };
