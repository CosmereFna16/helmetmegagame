// The Move enums as prose, in the one place both surfaces can reach.
// web/lib/requests.js is this module's twin for Requests.
//
// No Prisma import here, deliberately: RecordTab is a client component, and
// pulling the @lifeweb/db barrel in would construct a PrismaClient in the
// browser bundle.

// Where a Move sits before a GM ever sees it — the player is still filling it
// in over Discord dropdowns.
export const MOVE_PIPELINE_LABELS = {
  PENDING_TYPE: "Setting up Move",
  // Legacy value, never written; kept for old rows. See ActionStatus.PENDING_OPPOSED.
  PENDING_OPPOSED: "Pending confirm",
  PENDING: "Pending confirm",
};

export const MOVE_REVIEW_LABELS = {
  OPEN: "Open",
  PASSED: "Passed",
  // Legacy value, never written; kept for old rows. See MoveReviewStatus.WAITING_FOR_OPPONENTS.
  WAITING_FOR_OPPONENTS: "Waiting for Opponents",
  IN_PROGRESS: "In Progress",
  SOLVED: "Solved",
};

const MOVE_KIND_LABELS = {
  ROUTINE: "Routine",
  GAMBIT: "Gambit",
};

// A gmNotes marker a GM never types themselves — stamped by db/lib/travel.js
// to identify a Move the desk generated rather than a player submitted.
export const AUTO_ZONE_CHANGE = "auto:zone_change";

// A travel stub (db/lib/travel.js#performTravel) files a Move with no
// moveKind — there's no Routine/Gambit to pick, it's just "walked to a
// place". gmNotes can carry more than one marker (stagedPush appends
// auto:silent_close on top), so check for the substring, not equality.
export function isTravelMove(gmNotes) {
  return typeof gmNotes === "string" && gmNotes.includes(AUTO_ZONE_CHANGE);
}

// Tones for StatusPill. Open and Passed stay neutral: they are where most
// Moves sit, and a table where every row is coloured reads as noise.
export const MOVE_REVIEW_TONES = {
  Open: "neutral",
  Passed: "neutral",
  "Waiting for Opponents": "warn",
  "In Progress": "warn",
  Solved: "good",
};

export function moveKindLabel(moveKind, gmNotes) {
  if (isTravelMove(gmNotes)) return "Travel";
  return MOVE_KIND_LABELS[moveKind] ?? "Move";
}

// Raw roll, then the summed modifier (Hunger) and total — a GM
// has to be able to tell a modified 5 from a natural 5.
export function rollLabel(a) {
  if (a.diceRoll == null) return "";
  const mod = a.diceModifier ?? 0;
  if (!mod) return `rolled ${a.diceRoll}`;
  return `rolled ${a.diceRoll} (${mod > 0 ? `+${mod}` : mod}) = ${a.diceRoll + mod}`;
}
