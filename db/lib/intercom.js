// Ravenheart's PA. A button on the table in the Council Room, which is what
// docs/zones.yaml has always said is there.
//
// It used to be #intercom, a standing Discord channel a tag-holder typed
// into. That made the PA a place you went rather than a thing in a room, and
// it cost a channel, a registry entry, a per-member access rule and a tag to
// say so. Now the announcement lands where people already are: their own
// zone's #summary.
//
// The Black Hills do not hear it. The barony's writ thins out across the
// river, and no speaker was ever strung that far. The two cave levels need no
// exclusion — they have no #summary at all, so the rock swallows the PA for
// free.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.
const { postMessage } = require("./discordRest");

// The Council Room, hardcoded for the db/lib/roleIds.js reason: one guild, one
// correct value, and a missing env var would have been a silent no-op.
const INTERCOM_ROOM_SLUG = "keep-council-room";

// Zone slugs the PA does not reach. `hills` is the Black Hills.
const OUT_OF_RANGE_ZONE_SLUGS = ["hills"];

// The body is player-typed, so `parse: ["everyone"]` is doing two jobs: it
// lets OUR @here through, and it blocks every user and role ping somebody
// might type into the box. That is the same posture proxy.js takes with
// character speech, pointed the other way.
//
// But `parse: ["everyone"]` is one permission covering both @everyone and
// @here — Discord has no way to allow the quieter one alone. So the body is
// defanged first (below). Otherwise anybody at that table could escalate to
// @everyone, which wakes people who are offline, just by typing it.
const ALLOWED_MENTIONS = { parse: ["everyone"] };

// Break a typed @everyone/@here without eating the word: a zero-width space
// after the @ stops Discord matching it, and reads identically.
function defang(text) {
  return text.replace(/@(everyone|here)\b/gi, "@\u200b$1");
}

// Discord caps a message at 2000 characters and the modal caps the input well
// under that, so this is always one message — which matters, because chunking
// would ping @here once per chunk.
const MAX_BODY = 1200;

// Deliberately NOT ambientLine. Every other line the world says is scenery and
// belongs in `-#` subtext, under the conversation rather than in it — but a PA
// is the opposite of scenery. It is a loudspeaker. It carries an @here, and
// delivering the loudest notification Discord has in the quietest text Discord
// renders was exactly backwards. This one is full size.
//
// Full size also means the body can carry newlines safely: there is no
// per-line prefix left to break.
function intercomLine(text) {
  const body = defang(String(text ?? "").trim().slice(0, MAX_BODY));
  // Supply a full stop only when the speaker didn't end on one themselves,
  // so "Get to the wall!" doesn't broadcast as "Get to the wall!."
  const stop = /[.!?…]$/.test(body) ? "" : ".";
  return `@here You hear a voice from the intercom: ${body}${stop} ‡`;
}

// Posts to every zone in range, sequentially and individually caught. Never
// Promise.all a Discord fan-out (docs/systemdocs/TURN-ENGINE.md) — the burst
// of 429s is what earns an IP-level ban.
//
// Returns { sent, failed } rather than throwing: a PA that reached four zones
// out of five is not a failed announcement, and the caller has to be able to
// say so.
async function broadcastIntercom(prisma, text) {
  const content = intercomLine(text);
  const zones = await prisma.zone.findMany({
    where: { discordSummaryChannelId: { not: null }, slug: { notIn: OUT_OF_RANGE_ZONE_SLUGS } },
    select: { name: true, discordSummaryChannelId: true },
    orderBy: { sortOrder: "asc" },
  });

  let sent = 0;
  const failed = [];
  for (const zone of zones) {
    try {
      await postMessage(zone.discordSummaryChannelId, content, undefined, ALLOWED_MENTIONS);
      sent += 1;
    } catch (err) {
      failed.push(zone.name);
      console.error(`Intercom broadcast to ${zone.name} failed:`, err.message ?? err);
    }
  }
  return { sent, failed };
}

module.exports = {
  INTERCOM_ROOM_SLUG,
  OUT_OF_RANGE_ZONE_SLUGS,
  broadcastIntercom,
  intercomLine,
};
