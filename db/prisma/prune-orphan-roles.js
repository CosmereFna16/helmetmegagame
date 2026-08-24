// Deletes personal character roles in Discord that no living character claims.
//
// Every ALIVE character owns one guild role, titled after their bare name and
// used purely as a mentionable name token (PROXYING.md §6). Deleting that role
// is best-effort at all three call sites — killCharacter, guildMemberRemove,
// and the Restart Game wipe — so a rate-limited or failed DELETE leaves a role
// behind that nothing ever reaps. Discord's cap is 250 roles per guild against
// a roster of ~120, and past it `ensureCharacterRole` silently stops creating
// them: new characters become unmentionable with no error anyone sees.
//
// Dry-run by default with an --apply flag, matching db:prune-tags and
// db:prune-orphan-categories — the other destructive scripts here.
//
// Conservative by construction. A role is only a candidate when ALL of:
//   - it carries the character-role SIGNATURE (see below),
//   - no Character row references it (alive or dead),
//   - nobody in the guild holds it,
//   - it has no permissions of its own,
//   - it isn't managed by an integration, and
//   - it isn't one of the standing roles in db/lib/roleIds.js or the env.
// Anything else is reported and kept.
//
// The signature is what makes this safe, and it is not optional. Every other
// condition above is also true of a divider role like "—[ Characters ]—" or a
// GM cosmetic like "Mentor": held by nobody, permissionless, absent from the
// database. Deleting those would be destructive and wrong, and the first
// version of this script proposed exactly that.
//
// ensureCharacterRole (web/lib/discordGuild.js) creates every character role
// mentionable and colored by hashNameToColor(bareName) — the colour is derived
// from the name, so "mentionable AND colour === hash(name)" is a signature
// nothing else in the guild reproduces by accident. Verified against the live
// guild: of 14 roles, only the one real character role matched.
require("dotenv").config();
const { prisma } = require("../index");
const { discordRequest } = require("../lib/discordRest");
const { PLAYER_ROLE_ID, SPECTATOR_ROLE_ID } = require("../lib/roleIds");
const { hashNameToColor } = require("../lib/roleColor");

// See the header: mentionable, and coloured by a hash of its own name.
function looksLikeCharacterRole(role) {
  return role.mentionable === true && role.color === hashNameToColor(role.name);
}

function protectedRoleIds() {
  return new Set(
    [
      PLAYER_ROLE_ID,
      SPECTATOR_ROLE_ID,
      process.env.DISCORD_GM_ROLE_ID,
      process.env.DISCORD_CURSED_ROLE_ID,
      process.env.DISCORD_TURN_PING_ROLE_ID,
      process.env.DISCORD_NO_ROMANCE_ROLE_ID,
    ].filter(Boolean),
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error("DISCORD_GUILD_ID is not set.");

  const [roles, characters, members] = await Promise.all([
    discordRequest(`/guilds/${guildId}/roles`),
    prisma.character.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true, name: true, status: true },
    }),
    discordRequest(`/guilds/${guildId}/members?limit=1000`),
  ]);

  const claimed = new Map(characters.map((c) => [c.discordRoleId, c]));
  const protectedIds = protectedRoleIds();

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
