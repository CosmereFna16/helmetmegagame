// The Cathedral bell. A rope in the Bell Tower, which is what docs/zones.yaml
// has always said is up there — "waiting for a tug from below to let it sound
// across the land."
//
// It is the intercom's quiet cousin. Same shape: one line, posted into every
// zone's #summary that is in earshot, full size rather than `-#` subtext,
// because a bell is not scenery either — somebody chose to ring it, and the
// whole point is that the barony hears. What it does NOT carry is the @here.
// The PA is addressed to you; a bell is simply audible, and pinging a hundred
// people every time a chaplain pulls a rope would have made it a nuisance
// rather than a signal.
//
// The Black Hills do not hear it for the intercom's reason — the barony's
// writ, and its wiring, stop at the river — and the two cave levels need no
// exclusion, having no #summary to post into.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { postMessage } = require("./discordRest");

// The Cathedral's Bell Tower, hardcoded for the db/lib/roleIds.js reason: one
// guild, one correct value, and a missing env var would have been a silent
// no-op.
const BELL_ROOM_SLUG = "cathedral-bell-tower";

// Zone slugs within earshot. An allowlist rather than the intercom's
// exclusion list, because this one is a sound travelling over hills and the
// list is the fiction, not a wiring diagram.
const BELL_ZONE_SLUGS = ["town", "fortress", "forest", "marshes"];

// Five minutes. Short enough that the bell stays usable as a signal people
// agree on beforehand, long enough that nobody can peal it into noise.
const BELL_COOLDOWN_MS = 5 * 60 * 1000;

// No allowed_mentions of any kind, and nothing player-typed goes into it, so
// there is nothing here to defang.
const BELL_LINE = "The church bell is ringing. ‡";

// Null until somebody has rung it. Returns { ok } or { ok: false, secondsLeft }
// so the caller can say how long the rope has left to hang still.
function bellCooldown(bellRungAt, now = Date.now()) {
  if (!bellRungAt) return { ok: true, secondsLeft: 0 };
  const elapsed = now - new Date(bellRungAt).getTime();
  if (elapsed >= BELL_COOLDOWN_MS) return { ok: true, secondsLeft: 0 };
  return { ok: false, secondsLeft: Math.ceil((BELL_COOLDOWN_MS - elapsed) / 1000) };
}

// Posts to every zone in earshot, sequentially and individually caught. Never
// Promise.all a Discord fan-out (docs/systemdocs/TURN-ENGINE.md) — the burst
// of 429s is what earns an IP-level ban.
//
// Returns { sent, failed } rather than throwing: a bell heard in three zones
// out of four still rang.
async function broadcastBell(prisma) {
  const zones = await prisma.zone.findMany({
    where: { discordSummaryChannelId: { not: null }, slug: { in: BELL_ZONE_SLUGS } },
    select: { name: true, discordSummaryChannelId: true },
    orderBy: { sortOrder: "asc" },
  });

  let sent = 0;
  const failed = [];
  for (const zone of zones) {
    try {
      await postMessage(zone.discordSummaryChannelId, BELL_LINE);
      sent += 1;
    } catch (err) {
      failed.push(zone.name);
      console.error(`Bell broadcast to ${zone.name} failed:`, err.message ?? err);
    }
  }
  return { sent, failed };
}

module.exports = {
  BELL_ROOM_SLUG,
  BELL_ZONE_SLUGS,
  BELL_COOLDOWN_MS,
  BELL_LINE,
  bellCooldown,
  broadcastBell,
};
