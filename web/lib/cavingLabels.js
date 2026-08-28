// The player-facing names for CavingRollKind — see docs/systemdocs/CAVING.md.
// Shared on purpose: the Caving rail (QueueRail.js, through the DTO built in
// gm/turns/[[...selection]]/page.js) and the desk header (CavingDesk.js) both
// print it, and when the desk owned the only copy the rail rendered the raw
// enum's missing twin as "undefined".
export const CAVING_KIND_LABELS = {
  TROUBLE: "Trouble",
  QUIET: "Quiet",
  FIND: "Find",
};
