// Re-export of db/lib/characterName.js. Unlike web/lib/factionPermissions.js
// this binds nothing — the module is pure — but the shim is still required:
// CreateCharacterWizard.js is a client component, and importing the
// @lifeweb/db barrel would construct a PrismaClient in the browser bundle.
// The deep path resolves because @lifeweb/db declares no `exports` map.
//
// Named rather than `export *`: the target is CommonJS, so a star re-export
// makes Turbopack emit runtime interop and warn on every build.
export {
  NAME_LIMITS,
  AGE_MIN,
  AGE_MAX,
  formatCharacterName,
  formatBareName,
  splitLegacyName,
  normalizeHonorific,
  normalizeEarnedHonorific,
} from "@lifeweb/db/lib/characterName";

// The title catalog, same shim for the same reason — the wizard and the two
// other pickers are client components.
export { TITLE_WORDS, earnedTitles, genderOf } from "@lifeweb/db/lib/titles";
