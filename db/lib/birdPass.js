// The Bird's failure pass — the delayed half of a mechanic whose other half
// is instant. See docs/systemdocs/BIRD.md.
//
// A wrong guess resolves instantly, into silence; this pass tells the sender,
// one turn later, that it never arrived. The delay is the point — an instant
// answer would make a Bird a free, reliable "is X alive and in Town?" check.
// The message is identical for a wrong guess and a dead recipient, on purpose
// — different wordings would make one of them a reliable death detector.
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
