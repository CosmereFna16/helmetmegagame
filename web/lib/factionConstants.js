// Re-export of db/lib/factionConstants.js for the web app's ESM imports, the
// same shim pattern web/lib/factionPermissions.js uses. No prisma binding
// needed here — these are pure predicates over a faction row.
export { UNAFFILIATED_SLUG, isUnaffiliated, inRealFaction } from "@lifeweb/db/lib/factionConstants";
