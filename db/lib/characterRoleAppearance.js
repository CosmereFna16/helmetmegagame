// The one place a personal character role's name and colour are composed.
// Two writers rename these roles — web/lib/discordGuild.js#ensureCharacterRole
// on every profile save, and the Catatonic pass's role updates applied by
// advanceTurn() — and both must go through here, or a profile save landing
// mid-catatonia quietly strips the "• Catatonic" suffix the pass just wrote.
//
// While a character is Catatonic (AFK — see db/lib/catatonicPass.js), the
// role reads "<bare name> • Catatonic" in one fixed desaturated grey, so the
// member list shows who's absent at a glance.
//
// A role in the catatonic state no longer matches the character-role
// signature (mentionable + hashNameToColor(role.name) — see
// db/scripts/ops/prune-orphan-roles.js). That's safe: the channel doctor and
// the pruner both skip any role a character claims before testing the
// signature.
const { hashNameToColor } = require("./roleColor");

// Non-zero on purpose — 0 means "no colour" to Discord and is the cursed
// role's deliberate pin (CHANNELS.md §3). A flat desaturated grey in the same
// muted register as the roleColor gradient stops (~L32), reading as a lamp
// gone out next to the living roles' cyan-greys and terracottas.
const CATATONIC_ROLE_COLOR = 0x4e5457;

const CATATONIC_ROLE_SUFFIX = " • Catatonic";

function characterRoleAppearance(bareName, { catatonic = false } = {}) {
  if (catatonic) {
    return { name: `${bareName}${CATATONIC_ROLE_SUFFIX}`, color: CATATONIC_ROLE_COLOR };
  }
  return { name: bareName, color: hashNameToColor(bareName) };
}

module.exports = { characterRoleAppearance, CATATONIC_ROLE_COLOR, CATATONIC_ROLE_SUFFIX };
