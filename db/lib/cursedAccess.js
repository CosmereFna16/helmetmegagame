// The Cursed role's ghost seat — read-only visibility for the dead.
//
// A player who dies keeps the Cursed role until their body is buried or their
// name is engraved (docs/documents.yaml, the Respawning entry). While cursed
// they linger as a ghost: they see EVERY zone — the cave levels included,
// since the zone rework retired the Depths blackout — plus the special
// channels (#watch/#intercom). Private threads stay invisible to them the way
// they are to any non-member; no overwrite is needed to keep that so.
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
// The role's COLOR is part of the seat too: it is pinned to 0 (Discord's
// "no color") by ensureCursedRoleAppearance below, re-asserted on every zone
// sync and doctor run. A colored cursed role paints its holders' names in
// the member list, which outs who is dead at a glance — exactly what a
// concealed ghost seat must not do.
//
// Unlike the spectator role, the id is an env var (DISCORD_CURSED_ROLE_ID),
// because that is where the rest of the codebase already reads it from —
// web/lib/discordGuild.js#isCursed, grantCursedRole, removeCursedRole. Every
// helper here no-ops when it is unset rather than throwing, so a guild without
// the var configured simply has no ghosts.
const { putChannelOverwrite, deleteChannelOverwrite, patchGuildRole } = require("./discordRest");

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

// The overwrite object for inlining into a createChannel()
// permission_overwrites array at provisioning time — same shape as
// spectatorOverwrite() and the GM overwrite, so call sites can spread it.
// Empty when there is no cursed role configured.
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

// The undo, for a channel that should never have had one. Tolerates a channel
// that has no cursed overwrite, so it is safe to call broadly.
async function removeCursedOverwrite(channelId) {
  const roleId = cursedRoleId();
  if (!channelId || !roleId) return false;
  await deleteChannelOverwrite(channelId, roleId).catch(() => {});
  return true;
}

// Pins the cursed role's appearance: color 0 (Discord renders the holder with
// the default name color, no tint), never hoisted. One PATCH, idempotent,
// called from the zone sync and the channel doctor.
async function ensureCursedRoleAppearance() {
  const roleId = cursedRoleId();
  if (!roleId) return false;
  await patchGuildRole(roleId, { color: 0, hoist: false });
  return true;
}

module.exports = {
  cursedRoleId,
  cursedOverwrite,
  applyCursedOverwrite,
  removeCursedOverwrite,
  ensureCursedRoleAppearance,
  CURSED_ALLOW,
  CURSED_DENY,
};
