// Re-export of db/lib/threats.js. Like web/lib/characterName.js this binds
// nothing — the module is pure — but the shim is still required:
// CreateCharacterWizard.js is a client component, and importing the
// @lifeweb/db barrel would construct a PrismaClient in the browser bundle.
// The deep path resolves because @lifeweb/db declares no `exports` map.
//
// Named rather than `export *`: the target is CommonJS, so a star re-export
// makes Turbopack emit runtime interop and warn on every build.
export {
  THREATS,
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  threatBySlug,
  threatBySeatTag,
  ANTAGONISTS,
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
} from "@lifeweb/db/lib/threats";
