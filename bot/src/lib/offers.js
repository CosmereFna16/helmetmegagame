// The Accept / Decline click on a consent DM (docs/systemdocs/LESSONS.md).
//
// The DM arrives in the responder's DMs, so guild/member are null; the
// clicker is matched to the Offer's responder by Discord user id. The
// acknowledgement is interaction.update(): the buttons come off the message
// and the outcome is written under it, so a dead button can't be clicked
// twice and the DM reads as a record afterwards. Everything both faces check
// lives in db/lib/lessons.js and db/lib/bind.js; this file only routes.
const { prisma } = require("@lifeweb/db");
const { acceptLesson, declineOffer } = require("@lifeweb/db/lib/lessons");
const { acceptBind } = require("@lifeweb/db/lib/bind");
const { acceptConfession } = require("@lifeweb/db/lib/confession");
const { settleCarry, deliverCarryDrop } = require("@lifeweb/db/lib/carry");
const { syncCharacterRoomAccess } = require("@lifeweb/db/lib/roomAccess");
const { sendDm } = require("./dm");

async function loadOfferFor(interaction, offerId) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer)
    return { offer: null, responder: null, problem: "That offer's gone. ‡" };
  const responder = await prisma.character.findFirst({
    where: { id: offer.responderId, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true },
  });
  if (!responder || responder.discordUserId !== interaction.user.id) {
    return { offer, responder: null, problem: "That's not yours to answer. ‡" };
  }
  return { offer, responder, problem: null };
}

// Strips the buttons and writes the outcome under the original text. The
// original content already carries sendDm's `»`; the outcome gets its own.
async function settle(interaction, line) {
  const original = interaction.message?.content ?? "";
  await interaction
    .update({
      content: `${original}\n» ${line}`.slice(0, 2000),
      components: [],
    })
    .catch((err) => console.error("Offer button update failed:", err));
}

async function fanOut(interaction, dms) {
  for (const dm of dms ?? []) {
    const user = await interaction.client.users
      .fetch(dm.discordUserId)
      .catch(() => null);
    if (!user) continue;
    await sendDm(user, `» ${dm.content}`).catch((err) =>
      console.error(`Offer DM to ${dm.discordUserId} failed:`, err),
    );
  }
}

async function handleOfferAccept(interaction, offerId) {
  const { offer, responder, problem } = await loadOfferFor(
    interaction,
    offerId,
  );
  if (problem) return void (await settle(interaction, problem));

  const result =
    offer.kind === "BIND"
      ? await acceptBind(prisma, offer, responder)
      : offer.kind === "CONFESSION"
        ? await acceptConfession(prisma, offer, responder)
        : await acceptLesson(prisma, offer, responder);
  await settle(interaction, result.ok ? result.line : result.reason);
  await fanOut(interaction, result.dms);

  // A fresh Bound tag changes what rooms the target may stand in and, for
  // the carry settle, nothing — but the room sync is the same post-commit
  // step the web action runs (web/lib/afterInventoryChange.js).
  if (result.ok && result.boundId) {
    try {
      const drop = await settleCarry(prisma, result.boundId);
      const row = await prisma.character.findUnique({
        where: { id: result.boundId },
      });
      if (row) await syncCharacterRoomAccess(prisma, row).catch(() => {});
      if (drop) await deliverCarryDrop(prisma, drop).catch(() => {});
    } catch (err) {
      console.error(`Post-bind sync for ${result.boundId} failed:`, err);
    }
    const target = await prisma.character.findUnique({
      where: { id: result.boundId },
      select: { discordUserId: true },
    });
    const user = target?.discordUserId
      ? await interaction.client.users
          .fetch(target.discordUserId)
          .catch(() => null)
      : null;
    if (user) await sendDm(user, "» Someone bound you.").catch(() => {});
  }
}

async function handleOfferDecline(interaction, offerId) {
  const { offer, responder, problem } = await loadOfferFor(
    interaction,
    offerId,
  );
  if (problem) return void (await settle(interaction, problem));
  const result = await declineOffer(prisma, offer, responder);
  await settle(interaction, result.ok ? result.line : result.reason);
  await fanOut(interaction, result.dms);
}

module.exports = { handleOfferAccept, handleOfferDecline };
