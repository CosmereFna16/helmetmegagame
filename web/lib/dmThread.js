// Excludes bot/UI plumbing that happens to go out as a DM but isn't part of
// a GM<->player conversation: embeds (meta.embed === true) and anything
// tagged source: "system_notice" (edit-flow prompts, mention relays, proxy
// hand-back, reaction refusals — see bot/src/lib/dm.js call sites). Applied
// at the query, not the render, so a future noisy sendDm() call needs to
// pass its own `source` to show up here at all.
const NOT_CONVERSATION = [{ source: "system_notice" }, { meta: { path: ["embed"], equals: true } }];

export function withoutDmNoise(where) {
  return { ...where, NOT: NOT_CONVERSATION };
}
