// Re-export of db/lib/formatTagArmor.js, in the shape
// web/lib/formatTagRequirement.js established.
//
// The deep path avoids the @lifeweb/db barrel, which unconditionally requires
// @prisma/client and would leak node:fs into this "use client" bundle
// (PointBuy.js, TagChip.js). It resolves because @lifeweb/db declares no
// `exports` map.
//
// Named rather than `export *`: the target is CommonJS, so a star re-export
// makes Turbopack emit runtime interop and warn on every build.
export { formatTagArmor } from "@lifeweb/db/lib/formatTagArmor";
