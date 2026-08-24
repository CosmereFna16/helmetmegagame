// Re-export of db/lib/formatTagRequirement.js, in the shape web/lib/characterName.js
// established.
//
// This was a hand-maintained COPY of that file — identical logic, differing
// only in `export function` vs `module.exports`. The copy existed for a real
// reason (the @lifeweb/db barrel unconditionally requires @prisma/client, which
// leaks node:fs into any "use client" bundle that imports from it, and
// PointBuy.js and TagChip.js are client components), but nothing kept the two
// halves in step: the medicine rework had to remember to edit both, and did.
// The next edit might not have.
//
// The deep path resolves because @lifeweb/db declares no `exports` map, so it
// reaches the module without going through the barrel — no Prisma, no fs. That
// is the same trick ten other call sites already use.
//
// Named rather than `export *`: the target is CommonJS, so a star re-export
// makes Turbopack emit runtime interop and warn on every build.
export { formatTagRequirement } from "@lifeweb/db/lib/formatTagRequirement";
