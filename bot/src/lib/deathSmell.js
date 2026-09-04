// "It smells like death…"
//
// Every 2–5 hours, randomized, any Location holding a rotten corpse gets one
// line in its own channel. That is the whole feature — see
// docs/systemdocs/CORPSES.md.
//
// WHY A setTimeout CHAIN AND NOT CRON. node-cron expresses "every N", never
// "somewhere between 2 and 5 hours from now", and the randomness is the point:
// a fixed cadence would make the smell a clock players could read, and the
// thing it is meant to do is nag unpredictably until somebody buries the body.
// So each firing picks its own next delay.
//
// WHY IT NEEDS NO CLEANUP. The message goes to Location.discordChannelId, and
// the Dawn wipe already deletes every top-level message in a Location channel
// except the pinned anchor (CHANNELS.md). So the only obligations here are
// negative ones, and they matter: never pin this, and never write its id
// anywhere the wipe treats as an anchor. Do neither and it clears itself.
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");

// Four to ten real hours, randomized. It was two to five when a turn was half
// a day; a turn is a whole day now, so the window doubled to keep a body
// nagging about as often per turn as it always has. Wall-clock rather than a
// turn pass on purpose — see nextDelay() below.
const MIN_DELAY_MS = 4 * 60 * 60 * 1000;
const MAX_DELAY_MS = 10 * 60 * 60 * 1000;
const LINE = ambientLine("It smells like death…");

function nextDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
}

// Every Location with a rotten corpse in it — lying in one of its Rooms, or
// being carried by somebody standing there. Both, because a body in a bag
// smells exactly as much as one on the floor.
async function locationsThatStink(prisma) {
  const rotten = { corpseKind: "ROTTEN" };
  const [stashed, carried] = await Promise.all([
    prisma.roomTag.findMany({
      where: { tag: rotten },
      select: { room: { select: { location: { select: { id: true, name: true, discordChannelId: true } } } } },
    }),
    prisma.characterTag.findMany({
      where: { tag: rotten, character: { status: "ALIVE" } },
      select: { character: { select: { location: { select: { id: true, name: true, discordChannelId: true } } } } },
    }),
  ]);

  const byId = new Map();
  for (const row of stashed) {
    const loc = row.room?.location;
    if (loc?.discordChannelId) byId.set(loc.id, loc);
  }
  for (const row of carried) {
    const loc = row.character?.location;
    if (loc?.discordChannelId) byId.set(loc.id, loc);
  }
  return [...byId.values()];
}

// One pass. Exported so a GM script or a test can fire it by hand without
// waiting for the timer.
async function runDeathSmell(prisma) {
  const locations = await locationsThatStink(prisma);
  let posted = 0;
  // Sequential, no Promise.all: a fan-out across every Location would burst
  // Discord's rate-limit buckets, and this is never urgent.
  for (const loc of locations) {
    try {
      await postMessage(loc.discordChannelId, LINE);
      posted += 1;
    } catch (err) {
      console.error(`Death smell failed for ${loc.name}:`, err.message ?? err);
    }
  }
  return posted;
}

// Arms the chain. Each firing schedules the next one, so a thrown error inside
// runDeathSmell must never escape — it would stop the chain silently and the
// smell would just never happen again until the next restart.
function startDeathSmell(prisma) {
  const arm = () => {
    const delay = nextDelay();
    const timer = setTimeout(async () => {
      try {
        const posted = await runDeathSmell(prisma);
        if (posted > 0) console.log(`Death smell: ${posted} location(s) told.`);
      } catch (err) {
        console.error("Death smell pass failed:", err);
      } finally {
        arm();
      }
    }, delay);
    // Never hold the process open for a smell.
    if (typeof timer.unref === "function") timer.unref();
  };
  arm();
}

module.exports = { startDeathSmell, runDeathSmell, MIN_DELAY_MS, MAX_DELAY_MS };
