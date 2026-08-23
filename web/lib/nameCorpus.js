// Re-export of db/lib/nameCorpus.js, for the same reason and in the same shape
// as web/lib/characterName.js: CreateCharacterWizard.js and BioNameFields.js
// are client components, and importing the @lifeweb/db barrel would construct a
// PrismaClient in the browser bundle. The deep path resolves because
// @lifeweb/db declares no `exports` map.
//
// Named rather than `export *`: the target is CommonJS, so a star re-export
// makes Turbopack emit runtime interop and warn on every build.
//
// Safe to bundle — nameCorpus.js is pure and its only require is
// db/lib/concealedIdentity.js, which in turn only requires
// db/lib/characterName.js. No prisma, no `node:` builtins anywhere in that
// chain.
export { NAME_CORPUS, FLAVOUR_CHANCE, CROSS_REGION_CHANCE, randomCharacterName } from "@lifeweb/db/lib/nameCorpus";
