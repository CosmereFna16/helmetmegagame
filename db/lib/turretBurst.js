// The noise a turret makes. Separate from db/lib/turretPass.js because that
// file must never depend on Discord: being shot is a database fact and is
// resolved above every DISCORD_TOKEN guard in the codebase. This is the part
// that happens afterwards, and is allowed to fail.
//
// Two volumes, on purpose. In the Location the gun is standing in, the burst is
// the loudest thing in the room and is full-size text. Everywhere else in the
// zone it is a sound carrying over rooftops, so it goes as `-#` subtext through
// db/lib/ambientLine.js like every other thing the world says.
//
// It fires on EVERY burst, grazes included. A gun that only makes noise when it
// draws blood is a gun nobody can learn to avoid, and the whole point of the
// Gatehouse is that the yard is visibly dangerous before you walk into it.
//
// Once per BURST, never once per victim: the turn-end sweep shoots everyone
// standing there in one go (db/lib/turretPass.js#sweepTurretAt), and five
// identical lines for five people would read as five guns.
//
// Takes `prisma` as a parameter; see db/lib/dm.js for why.
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");

// Bascinet's own word, so `signed: false` — a ‡ marks copy Claude drafted and
// nobody has signed off, and putting one on their line says the opposite of
// what it means (CLAUDE.md).
const BURST_TEXT = "RRATATAT!";

async function announceTurretBurst(prisma, locationId) {
  if (!locationId || !process.env.DISCORD_TOKEN) return { sent: 0 };

  const here = await prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, discordChannelId: true, zoneId: true },
  });
  if (!here) return { sent: 0 };

  let sent = 0;

  // The room the gun is in, first and at full size — whoever is standing there
  // should see it before anyone a zone away does.
  if (here.discordChannelId) {
    try {
      await postMessage(here.discordChannelId, BURST_TEXT);
      sent += 1;
    } catch (err) {
      console.error(`Turret burst in ${here.name} failed:`, err.message ?? err);
    }
  }

  if (!here.zoneId) return { sent };

  // Sequential and individually caught. Never Promise.all a Discord fan-out
  // (docs/systemdocs/TURN-ENGINE.md) — the burst of 429s is what earns an
  // IP-level ban, and a zone can hold a dozen Locations.
  const elsewhere = await prisma.location.findMany({
    where: { zoneId: here.zoneId, id: { not: here.id }, discordChannelId: { not: null } },
    select: { name: true, discordChannelId: true },
  });
  const heard = ambientLine(BURST_TEXT, [], { signed: false });
  for (const location of elsewhere) {
    try {
      await postMessage(location.discordChannelId, heard);
      sent += 1;
    } catch (err) {
      console.error(`Turret burst carrying to ${location.name} failed:`, err.message ?? err);
    }
  }

  return { sent };
}

module.exports = { BURST_TEXT, announceTurretBurst };
