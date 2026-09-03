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
const {
  CATATONIC_ROLE_COLOR,
  CATATONIC_ROLE_SUFFIX,
} = require("../../lib/characterRoleAppearance");

// See the header: mentionable, and coloured by a hash of its own name. A
// Catatonic character's role ("<name> • Catatonic", flat grey —
// db/lib/characterRoleAppearance.js) fails this on purpose; it's safe anyway,
// because a claimed role is never a candidate.
function looksLikeCharacterRole(role) {
  return role.mentionable === true && role.color === hashNameToColor(role.name);
}

// The Catatonic repaint (db/lib/characterRoleAppearance.js) renames a role to
// "<name> • Catatonic" in one fixed grey, so it can no longer match the
// signature above. While a character claims the role that is exactly right —
// the claim check protects it either way. But a role left behind by a PREVIOUS
// game is unclaimed AND unmatchable, so the normal sweep can never reach it.
// --include-catatonic accepts that second exact appearance as well. Every
// other gate (unclaimed, unheld, permissionless, unmanaged, not standing) is
// unchanged, so this only widens the net by genuine catatonic leftovers.
function looksLikeCatatonicRole(role) {
  return (
    role.mentionable === true &&
    role.color === CATATONIC_ROLE_COLOR &&
    role.name.endsWith(CATATONIC_ROLE_SUFFIX)
  );
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
  const includeCatatonic = process.argv.includes("--include-catatonic");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set.");

  const [roles, characters, zones, members] = await Promise.all([
    discordRequest(`/guilds/${guildId}/roles`),
    prisma.character.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true, name: true, status: true },
    }),
    prisma.zone.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true },
    }),
    discordRequest(`/guilds/${guildId}/members?limit=1000`),
  ]);

  // "Permissionless" can't just mean "0". Discord's create-role endpoint
  // copies @everyone's permissions whenever the field is omitted, and
  // ensureCharacterRole omitted it for the whole of Bascinet 1 — so every
  // character role in this guild carries @everyone's exact bitfield and the
  // gate below rejected all of them, making this script a silent no-op.
  // A role matching @everyone grants nothing over the baseline, so it counts
  // as permissionless here; anything ELSE is somebody's real access role.
  const everyoneRole = roles.find((r) => r.id === guildId);
  const baselinePermissions = new Set(["0", everyoneRole?.permissions].filter(Boolean));

  const claimed = new Map(characters.map((c) => [c.discordRoleId, c]));
  const protectedIds = protectedRoleIds();
  // The zone-access roles ("Zone: Town") are standing infrastructure, owned
  // by db:sync-zones. Their signature (unmentionable, color 0) already fails
  // looksLikeCharacterRole, but protecting them by id keeps this script safe
  // against any future signature change. Locations wear no role at all since
  // the overwrite rework, so there is nothing of theirs to protect; a
  // leftover "Location: X" role is db:prune-stale-channels' to retire.
  for (const zone of zones) protectedIds.add(zone.discordRoleId);

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
    if (role.permissions && !baselinePermissions.has(role.permissions)) {
      reasons.push("carries permissions");
    }
    const isCharacterRole =
      looksLikeCharacterRole(role) || (includeCatatonic && looksLikeCatatonicRole(role));
    if (!isCharacterRole) reasons.push("not a character role");

    if (reasons.length) kept.push({ role, reasons });
    else candidates.push(role);
  }

  console.log(`Guild has ${roles.length} role(s) of Discord's 250 cap.`);
  if (includeCatatonic) console.log("--include-catatonic: catatonic-styled roles are candidates too.");
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
