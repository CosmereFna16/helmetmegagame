// The spectator role — a standing observer seat. Read-only visibility into
// every Location channel and both narrowcast channels, applied once at
// provisioning (not swapped per-Move like a character's personal role,
// since a spectator sees everywhere at once).
//
// The deny list is wider than SendMessages: ViewChannel alone still leaves
// a forum channel postable and a thread writable, and Location `-private`
// channels grant @everyone CreatePrivateThreads — denying the thread perms
// explicitly is what "read-only, no private threads" requires.
const { putChannelOverwrite } = require("./discordRest");
const { SPECTATOR_ROLE_ID } = require("./roleIds");

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

// The overwrite object for inlining into a createChannel()
// permission_overwrites array at provisioning time — same shape as
// syncLocations' gmChannelOverwrite, so call sites can spread it.
function spectatorOverwrite() {
  return [
    { id: SPECTATOR_ROLE_ID, type: 0, allow: SPECTATOR_ALLOW.toString(), deny: SPECTATOR_DENY.toString() },
  ];
}

// The REST equivalent, for channels that already exist. A single PUT that
// adds/updates just this one overwrite without disturbing the channel's
// others (unlike PATCHing the whole permission_overwrites array), so it is
// safe to re-run and safe alongside the @everyone and GM overwrites.
async function applySpectatorOverwrite(channelId) {
  if (!channelId) return false;
  await putChannelOverwrite(channelId, SPECTATOR_ROLE_ID, {
    allow: SPECTATOR_ALLOW.toString(),
    deny: SPECTATOR_DENY.toString(),
  });
  return true;
}

module.exports = {
  spectatorOverwrite,
  applySpectatorOverwrite,
  SPECTATOR_ALLOW,
  SPECTATOR_DENY,
};
