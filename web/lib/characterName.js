// Re-export of db/lib/characterName.js. Unlike web/lib/factionPermissions.js
// this binds nothing — the module is pure — but the shim is still required:
// CreateCharacterWizard.js is a client component, and importing the
// @lifeweb/db barrel would construct a PrismaClient in the browser bundle.
// The deep path resolves because @lifeweb/db declares no `exports` map.
export * from "@lifeweb/db/lib/characterName";
