// The Cursed role's ghost seat — read-only visibility for the dead.
//
// A player who dies keeps the Cursed role until their body is buried or their
// name is engraved (docs/documents.yaml, the Respawning entry). Until this,
// the role was a pure member-role flag: it gated what they could re-roll as
// and nothing else, so a dead player saw nothing at all. Now they linger.
//
// This is the spectator seat's sibling — see db/lib/spectatorAccess.js, which
// this file mirrors deliberately, down to the two exports (one to inline into
// a createChannel payload, one REST call for a channel that already exists).
// Two differences, both on purpose:
//
//   * ADD_REACTIONS is ALLOWED. A spectator is denied it. A ghost has to be
//     able to press 🌬️ — the wind whisper is its only voice, and denying
//     reactions would take it away (bot/src/events/messageReactionAdd.js).
//   * MANAGE_THREADS is DENIED by name. View, but no thread management. The
//     spectator deny never mentions it because a spectator's ViewChannel-only
//     allow could never confer it anyway; naming it here keeps the intent
//     legible next to the reaction allow.
//
// The Depths stay dark. Caverns, Railroad and Aberrant Pits get no cursed
// overwrite at all, so @everyone's ViewChannel deny is the last word there.
// The exclusion list is DEPTHS_SLUGS from db/lib/travelCost.js — the same set
// that makes each level down its own Move — rather than a second hand-written
// list of cave slugs that could drift from it.
//
// Unlike the spectator role, the id is an env var (DISCORD_CURSED_ROLE_ID),
// because that is where the rest of the codebase already reads it from —
// web/lib/discordGuild.js#isCursed, grantCursedRole, removeCursedRole. Every
// helper here no-ops when it is unset rather than throwing, so a guild without
// the var configured simply has no ghosts.
const { putChannelOverwrite, deleteChannelOverwrite } = require("./discordRest");
const { DEPTHS_SLUGS } = require("./travelCost");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_ADD_REACTIONS = 64n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ATTACH_FILES = 32768n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_MANAGE_THREADS = 17179869184n;
const PERM_CREATE_PUBLIC_THREADS = 34359738368n;
const PERM_CREATE_PRIVATE_THREADS = 68719476736n;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944n;

const CURSED_ALLOW = PERM_VIEW_CHANNEL | PERM_ADD_REACTIONS;
const CURSED_DENY =
  PERM_SEND_MESSAGES |
  PERM_ATTACH_FILES |
  PERM_MANAGE_MESSAGES |
  PERM_MANAGE_THREADS |
  PERM_CREATE_PUBLIC_THREADS |
  PERM_CREATE_PRIVATE_THREADS |
  PERM_SEND_MESSAGES_IN_THREADS;

function cursedRoleId() {
  return process.env.DISCORD_CURSED_ROLE_ID || null;
}

// Whether ghosts may see this Location at all. Keyed on the slug, matching
// how every other Location rule in db/lib is written.
function ghostsMaySee(location) {
  return !DEPTHS_SLUGS.has(location?.slug);
}

// The overwrite object for inlining into a createChannel()
// permission_overwrites array at provisioning time — same shape as
// spectatorOverwrite() and syncLocations' gmChannelOverwrite, so call sites
// can spread it. Empty when there is no cursed role configured.
function cursedOverwrite() {
  const roleId = cursedRoleId();
  if (!roleId) return [];
  return [{ id: roleId, type: 0, allow: CURSED_ALLOW.toString(), deny: CURSED_DENY.toString() }];
}

// The REST equivalent, for channels that already exist. A single PUT that
// adds/updates just this one overwrite without disturbing the channel's
// others, so it is safe to re-run.
async function applyCursedOverwrite(channelId) {
  const roleId = cursedRoleId();
  if (!channelId || !roleId) return false;
  await putChannelOverwrite(channelId, roleId, {
    allow: CURSED_ALLOW.toString(),
    deny: CURSED_DENY.toString(),
  });
  return true;
}

// The undo, for a channel that should never have had one — a Depths channel
// caught by a mis-scoped run. Tolerates a channel that has no cursed
// overwrite, so it is safe to call on everything in the Depths.
async function removeCursedOverwrite(channelId) {
  const roleId = cursedRoleId();
  if (!channelId || !roleId) return false;
  await deleteChannelOverwrite(channelId, roleId).catch(() => {});
  return true;
}

module.exports = {
  cursedRoleId,
  ghostsMaySee,
  cursedOverwrite,
  applyCursedOverwrite,
  removeCursedOverwrite,
  CURSED_ALLOW,
  CURSED_DENY,
};
