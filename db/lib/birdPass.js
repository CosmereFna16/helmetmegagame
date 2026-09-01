// The Bird's failure pass — the delayed half of a mechanic whose other half is
// instant. See docs/systemdocs/BIRD.md.
//
// A letter resolves the moment it is sent: right zone and a living recipient,
// and the DM goes out there and then. A wrong guess resolves too, into nothing,
// and the sender is told NOW ONLY THAT THEY SENT IT. This pass is what tells
// them, one turn later, that it never arrived.
//
// THE DELAY IS THE WHOLE POINT, and it is the one thing not to "fix" here. An
// immediate "not delivered" would turn a Bird into a once-a-day question —
// "is Ada alive and standing in Town?" — answered for free and with certainty.
// A turn's delay makes the answer stale on arrival, which is exactly what a
// bird flying back overnight should feel like. For the same reason the message
// is identical whether the guess was wrong or the recipient was dead: two
// wordings would be two different questions, and one of them would be a
// reliable death detector.
//
// Same discipline as every pass: DB writes only, and Discord work returned as
// `notices` for the side-effect thunk in db/index.js rather than sent from in
// here. Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { NOT_DELIVERED_DM } = require("./bird");

async function runBirdPass(prisma, turn) {
  // Undelivered and not yet reported. `failureNotifiedAt` is both the filter
  // and the claim, which is what makes a resumed close unable to tell the same
  // sender twice — the same shape the rest of the engine uses.
  const stranded = await prisma.birdMessage.findMany({
    where: { delivered: false, failureNotifiedAt: null },
    select: { id: true, senderId: true, senderName: true, senderDiscordUserId: true },
  });

  if (stranded.length === 0) {
    return { turnNumber: turn.number, undelivered: 0, notices: [] };
  }

  await prisma.birdMessage.updateMany({
    where: { id: { in: stranded.map((m) => m.id) } },
    data: { failureNotifiedAt: new Date() },
  });

  // A sender who died between letting the bird go and this close still hears
  // back. It was their bird, the player is at the keyboard either way, and
  // silently swallowing it would leave them wondering forever whether it
  // landed — which is a worse outcome than a note arriving for a dead hand.
  const notices = stranded
    .filter((m) => m.senderDiscordUserId)
    .map((m) => ({ discordUserId: m.senderDiscordUserId, content: NOT_DELIVERED_DM }));

  return { turnNumber: turn.number, undelivered: stranded.length, notices };
}

module.exports = { runBirdPass };
