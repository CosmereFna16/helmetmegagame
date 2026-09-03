// The Cursed role's ghost seat — read-only visibility for the dead. A player
// who dies keeps it until buried or engraved (docs/documents.yaml,
// Respawning); while cursed they see every zone (cave levels included) plus
// #watch, but private threads stay invisible as to any non-member.
// Mirrors db/lib/spectatorAccess.js except ADD_REACTIONS is allowed (the
// wind whisper, 🌬️, is a ghost's only voice) and MANAGE_THREADS is denied
// by name. The role's COLOR is pinned to 0 by ensureCursedRoleAppearance —
// a colored role would out who is dead in the member list. The role id is
// an env var (DISCORD_CURSED_ROLE_ID); every helper here no-ops when unset.
const { putChannelOverwrite, patchGuildRole } = require("./discordRest");

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
  ensureCursedRoleAppearance,
  CURSED_ALLOW,
  CURSED_DENY,
};
