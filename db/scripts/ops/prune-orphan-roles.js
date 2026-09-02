// Deletes personal character roles in Discord that no living character
// claims. Role deletion is best-effort at every call site, so a failed
// DELETE can leave one behind, and Discord's 250-role cap means orphans
// eventually block new characters from getting a mentionable role. Dry-run
// by default with an --apply flag, matching db:prune-tags.
//
// Conservative by construction: a role is only a candidate when it carries
// the character-role SIGNATURE below (mentionable AND colour ===
// hashNameToColor(name), set by ensureCharacterRole), no Character row
// references it, nobody holds it, it has no permissions, and it isn't
// integration-managed or a standing role.
require("dotenv").config();
const { prisma } = require("../../index");
const { discordRequest } = require("../../lib/discordRest");
const {
  PLAYER_ROLE_ID,
  SPECTATOR_ROLE_ID,
  LEADER_WHITELIST_ROLE_ID,
} = require("../../lib/roleIds");
const { hashNameToColor } = require("../../lib/roleColor");

// See the header: mentionable, and coloured by a hash of its own name. A
// Catatonic character's role ("<name> • Catatonic", flat grey —
// db/lib/characterRoleAppearance.js) fails this on purpose; it's safe anyway,
// because a claimed role is never a candidate.
function looksLikeCharacterRole(role) {
  return role.mentionable === true && role.color === hashNameToColor(role.name);
}

function protectedRoleIds() {
  return new Set(
    [
      PLAYER_ROLE_ID,
      SPECTATOR_ROLE_ID,
      LEADER_WHITELIST_ROLE_ID,
      process.env.DISCORD_GM_ROLE_ID,
      process.env.DISCORD_CURSED_ROLE_ID,
      process.env.DISCORD_TURN_PING_ROLE_ID,
    ].filter(Boolean),
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set.");

  const [roles, characters, zones, locations, members] = await Promise.all([
    discordRequest(`/guilds/${guildId}/roles`),
    prisma.character.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true, name: true, status: true },
    }),
    prisma.zone.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true },
    }),
    prisma.location.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true },
    }),
    discordRequest(`/guilds/${guildId}/members?limit=1000`),
  ]);

  const claimed = new Map(characters.map((c) => [c.discordRoleId, c]));
  const protectedIds = protectedRoleIds();
  // The zone-access roles ("Zone: Town") are standing infrastructure, owned
  // by db:sync-zones. Their signature (unmentionable, color 0) already fails
  // looksLikeCharacterRole, but protecting them by id keeps this script safe
  // against any future signature change.
  for (const zone of zones) protectedIds.add(zone.discordRoleId);
  for (const location of locations) protectedIds.add(location.discordRoleId);

  // Held by at least one member — never a candidate, whatever else is true.
  const held = new Set();
  for (const m of members) for (const roleId of m.roles ?? []) held.add(roleId);

  const candidates = [];
  const kept = [];

  for (const role of roles) {
    if (role.id === guildId) continue; // @everyone shares the guild's id
    const reasons = [];
    if (protectedIds.has(role.id)) reasons.push("standing role");
    if (claimed.has(role.id)) reasons.push(`claimed by ${claimed.get(role.id).name}`);
    if (held.has(role.id)) reasons.push("held by a member");
    if (role.managed) reasons.push("managed by an integration");
    // A name token grants nothing; anything with permissions is somebody's
    // real access role and is not ours to delete.
    if (role.permissions && role.permissions !== "0") reasons.push("carries permissions");
    if (!looksLikeCharacterRole(role)) reasons.push("not a character role");

    if (reasons.length) kept.push({ role, reasons });
    else candidates.push(role);
  }

  console.log(`Guild has ${roles.length} role(s) of Discord's 250 cap.`);
  console.log(
    `${characters.length} character role(s) claimed (${characters.filter((c) => c.status === "ALIVE").length} by living characters).\n`,
  );

  if (!candidates.length) {
    console.log("No orphaned roles. Nothing to prune.");
    return;
  }

  console.log(`${apply ? "Deleting" : "Would delete"} ${candidates.length} orphaned role(s):`);
  for (const role of candidates) console.log(`  - ${role.name} (${role.id})`);

  if (!apply) {
    console.log(`\n${kept.length} role(s) kept. Dry run — re-run with \`-- --apply\` to delete.`);
    return;
  }

  // Sequential: this is a burst of guild-role DELETEs against one per-guild
  // bucket, which is exactly the pattern the wipe path had to be converted
  // away from (web/app/(app)/gm/dev/actions.js).
  let deleted = 0;
  for (const role of candidates) {
    try {
      await discordRequest(`/guilds/${guildId}/roles/${role.id}`, { method: "DELETE", allow404: true });
      deleted += 1;
    } catch (err) {
      console.error(`  ! failed to delete ${role.name} (${role.id}): ${err.message}`);
    }
  }
  console.log(`\nDeleted ${deleted} of ${candidates.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
