// Static Discord role IDs, hardcoded rather than env-configured.
//
// These are not secrets: a role ID is visible to anyone in the guild, and
// Bascinet is a single-guild game, so there is exactly one correct value for
// each and it will never differ between environments. Keeping them in code
// means they cannot be half-configured — the failure mode of an env var here
// was a deploy where the player gate silently locked everyone out or the
// spectator overwrite silently did nothing.
//
// Same reasoning as web/lib/superadmin.js's SUPERADMIN_DISCORD_IDS.
//
// Contrast with DISCORD_TOKEN/DISCORD_GUILD_ID/DISCORD_GM_ROLE_ID, which stay
// in the environment — the token is a real credential, and the others predate
// this and are still wired through .env.

// Who may create a character. Paired with GameConfig.openToPlayers: the
// config says the doors are open, this role says who is on the list.
const PLAYER_ROLE_ID = "1539805619903791219";

// The standing read-only observer seat — sees every Location channel and both
// narrowcast channels, can never contribute anything anywhere.
const SPECTATOR_ROLE_ID = "1540054129752154292";

module.exports = { PLAYER_ROLE_ID, SPECTATOR_ROLE_ID };
