// When the open turn ends, and when Moves stop being accepted.
//
// Nothing stores a turn's end time: turns advance at 0:00 America/Chicago
// (bot/src/events/ready.js's cron), once a real day, strictly alternating
// DAWN/DUSK, so the end is derivable — every turn opens at midnight and closes
// at the next midnight (and this module does not even need to know the phase:
// the next boundary is the next boundary). Turns were 12 hours once, with a
// second boundary at noon; the phases still alternate, so an in-game day is
// now two real days. The old helper
// (weather.js#turnEndEpochSeconds) derived it from *now* and the phase, which
// is only correct at the instant the turn opens: the bot rebuilds the #turns
// announcement on restart, so a restart at 18:00 posted "ends at noon, six
// hours ago". Everything here derives it from `turn.startedAt` instead, which
// is also what makes a manually advanced turn come out right.
//
// Pure: no Prisma, no discord.js. Takes a Turn row (only `phase` and
// `startedAt` are read) and returns Dates.

const TIME_ZONE = "America/Chicago";

// Moves must be in this many hours before the turn ends, so a GM has a window
// to adjudicate what was filed before the turn rolls over.
const MOVE_LOCK_HOURS = 3;

const MOVE_LOCK_MS = MOVE_LOCK_HOURS * 60 * 60 * 1000;

// The Chicago hours the turn cron fires at, and so the hours a turn can end on.
// One entry, one turn a day. Must match bot/src/events/ready.js's cron.
const TURN_BOUNDARY_HOURS = [0];

// DST-safe local-time-in-a-zone -> UTC conversion using only the built-in Intl
// API (no date library needed for one zone). Lived in db/weather.js, which now
// requires it from here so there is one copy.
function getTimeZoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date(utcMs))
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUTC - utcMs;
}

function zonedTimeToUtc(y, m, d, h, min, s, timeZone) {
  let utc = Date.UTC(y, m - 1, d, h, min, s);
  for (let i = 0; i < 2; i++) {
    utc = Date.UTC(y, m - 1, d, h, min, s) - getTimeZoneOffsetMs(utc, timeZone);
  }
  return utc;
}

// The Chicago calendar date/time a UTC instant falls on.
function zonedParts(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = Number(p.value);
      return acc;
    }, {});
}

// The first 00:00 Chicago boundary strictly after `turn.startedAt`. The cron
// fires there regardless of phase — so a turn a GM opened by hand at 13:00
// really does end at the coming midnight, eleven hours later, rather than
// running a full 24. (The phase-based rule was the one db/weather.js used to
// derive from "now"; it only ever matched the cron for turns the cron itself
// opened.) "Strictly after" is what keeps a turn opened a second past its own
// boundary from ending immediately. The hour list is the single place the
// cadence lives: it held [0, 12] when a turn was half a day.
function turnEndsAt(turn) {
  if (!turn?.startedAt) return null;
  const startedAt = new Date(turn.startedAt).getTime();
  const { year, month, day } = zonedParts(new Date(startedAt), TIME_ZONE);
  const candidates = [];
  for (const dayOffset of [0, 1]) {
    for (const hour of TURN_BOUNDARY_HOURS) {
      candidates.push(zonedTimeToUtc(year, month, day + dayOffset, hour, 0, 0, TIME_ZONE));
    }
  }
  const end = Math.min(...candidates.filter((t) => t > startedAt));
  return new Date(end);
}

function moveCutoffAt(turn) {
  const end = turnEndsAt(turn);
  return end ? new Date(end.getTime() - MOVE_LOCK_MS) : null;
}

// `hasLock` is false — no cutoff at all — in two cases:
//
//   * autoTurnAdvanceDisabled: the cron is off, so there is no real end time
//     to count back from and the derived one would be a lie.
//   * a turn shorter than MOVE_LOCK_HOURS: a GM advancing manually at, say,
//     23:00 opens a one-hour turn, and counting three hours back from midnight
//     would lock the entire turn the moment it opened.
//
// `locked` is only true inside the window between the cutoff and the end, so a
// turn that has somehow outlived its derived end (the cron missed) reopens
// rather than staying locked forever.
function moveWindow(turn, { now = new Date(), autoTurnAdvanceDisabled = false } = {}) {
  const endsAt = turnEndsAt(turn);
  const cutoffAt = endsAt ? new Date(endsAt.getTime() - MOVE_LOCK_MS) : null;
  const longEnough = Boolean(endsAt) && endsAt.getTime() - new Date(turn.startedAt).getTime() > MOVE_LOCK_MS;
  const hasLock = longEnough && !autoTurnAdvanceDisabled;
  const locked = hasLock && now.getTime() >= cutoffAt.getTime() && now.getTime() < endsAt.getTime();
  return { endsAt, cutoffAt, locked, hasLock };
}

// Discord <t:EPOCH:t> tags want seconds, not milliseconds.
function epochSeconds(date) {
  return date ? Math.round(date.getTime() / 1000) : null;
}

module.exports = {
  MOVE_LOCK_HOURS,
  TURN_BOUNDARY_HOURS,
  turnEndsAt,
  moveCutoffAt,
  moveWindow,
  epochSeconds,
};
