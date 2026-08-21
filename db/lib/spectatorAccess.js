// The spectator role (DISCORD_SPECTATOR_ROLE_ID) — a standing observer seat.
// Read-only visibility into every Location channel and both narrowcast
// channels, with no way to contribute anything anywhere.
//
// Unlike a character's personal role, this is ONE static role that never
// moves: it is applied once when a channel is provisioned and otherwise only
// by the backfill script. It is deliberately not part of the per-Move access
// sync (bot/src/lib/location.js#swapLocationAccess and its REST twin), which
// exists to move a single character between categories — a spectator sees
// everywhere at once, so there is nothing to swap.
//
// On a Location the overwrite goes on the CATEGORY, so all three channels
// inherit it, the same mechanism per-character access uses.
//
// The deny list is wider than just SendMessages on purpose. ViewChannel
// without SendMessages still leaves a forum channel postable and a thread
// writable, and Location `-private` channels allow CreatePrivateThreads for
// @everyone — which a spectator would otherwise inherit. Denying the thread
// bits explicitly closes all three, which is what "read-only, no private
// threads" has to mean.
const { putChannelOverwrite } = require("./discordRest");

const PERM_VIEW_CHANNEL = 1024n;
const PERM_SEND_MESSAGES = 2048n;
const PERM_ADD_REACTIONS = 64n;
const PERM_ATTACH_FILES = 32768n;
const PERM_MANAGE_MESSAGES = 8192n;
const PERM_CREATE_PUBLIC_THREADS = 34359738368n;
const PERM_CREATE_PRIVATE_THREADS = 68719476736n;
const PERM_SEND_MESSAGES_IN_THREADS = 274877906944n;

const SPECTATOR_ALLOW = PERM_VIEW_CHANNEL;
const SPECTATOR_DENY =
  PERM_SEND_MESSAGES |
  PERM_ADD_REACTIONS |
  PERM_ATTACH_FILES |
  PERM_MANAGE_MESSAGES |
  PERM_CREATE_PUBLIC_THREADS |
  PERM_CREATE_PRIVATE_THREADS |
  PERM_SEND_MESSAGES_IN_THREADS;

function spectatorRoleId() {
  return process.env.DISCORD_SPECTATOR_ROLE_ID || null;
}

// The overwrite object for inlining into a createChannel()
// permission_overwrites array at provisioning time. Returns [] when the role
// isn't configured, so call sites can spread it unconditionally — same shape
// as syncLocations' gmChannelOverwrite.
function spectatorOverwrite() {
  const roleId = spectatorRoleId();
  if (!roleId) return [];
  return [{ id: roleId, type: 0, allow: SPECTATOR_ALLOW.toString(), deny: SPECTATOR_DENY.toString() }];
}

// The REST equivalent, for channels that already exist. A single PUT that
// adds/updates just this one overwrite without disturbing the channel's
// others (unlike PATCHing the whole permission_overwrites array), so it is
// safe to re-run and safe alongside the @everyone and GM overwrites.
// No-ops when the role isn't configured.
async function applySpectatorOverwrite(channelId) {
  const roleId = spectatorRoleId();
  if (!roleId || !channelId) return false;
  await putChannelOverwrite(channelId, roleId, {
    allow: SPECTATOR_ALLOW.toString(),
    deny: SPECTATOR_DENY.toString(),
  });
  return true;
}

module.exports = {
  spectatorRoleId,
  spectatorOverwrite,
  applySpectatorOverwrite,
  SPECTATOR_ALLOW,
  SPECTATOR_DENY,
};
