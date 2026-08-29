// The Move enums as prose, in the one place both surfaces can reach.
//
// These maps lived inside gm/turns/page.js, so the Dev Panel's Record tab —
// the only other place that shows a Move's kind and review status — had no way
// to reach them and rendered the raw DB enums instead: ROUTINE, SOLVED,
// WAITING_FOR_OPPONENTS. web/lib/requests.js had already solved the same
// problem for Requests; this is its twin.
//
// No Prisma import here, deliberately: RecordTab is a client component, and
// pulling the @lifeweb/db barrel in would construct a PrismaClient in the
// browser bundle.

// Where a Move sits before a GM ever sees it — the player is still filling it
// in over Discord dropdowns.
export const MOVE_PIPELINE_LABELS = {
  PENDING_TYPE: "Setting up Move",
  // Legacy: no longer written, kept for old rows. See ActionStatus.PENDING_OPPOSED.
  PENDING_OPPOSED: "Pending confirm",
  PENDING: "Pending confirm",
};

export const MOVE_REVIEW_LABELS = {
  OPEN: "Open",
  PASSED: "Passed",
  // Legacy: no longer written, kept for old rows. See MoveReviewStatus.WAITING_FOR_OPPONENTS.
  WAITING_FOR_OPPONENTS: "Waiting for Opponents",
  IN_PROGRESS: "In Progress",
  SOLVED: "Solved",
};

export const MOVE_KIND_LABELS = {
  ROUTINE: "Routine",
  GAMBIT: "Gambit",
};

// gmNotes markers a GM never types themselves — stamped by the auto-filed
// paths (db/lib/travel.js, db/lib/defaultMovePass.js, db/lib/stagedPush.js)
// to identify a Move the desk generated rather than a player submitted.
export const AUTO_ZONE_CHANGE = "auto:zone_change";
export const AUTO_DEFAULT_MOVE = "auto:default_move";
export const AUTO_SILENT_CLOSE = "auto:silent_close";

// A travel stub (db/lib/travel.js#performTravel) files a Move with no
// moveKind — there's no Routine/Gambit to pick, it's just "walked to a
// place" — which is why moveKindLabel used to fall through to the generic
// "Move". gmNotes can carry more than one marker (stagedPush appends
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
