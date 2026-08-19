const { prisma } = require("@lifeweb/db");

function contentOf(payload) {
  if (typeof payload === "string") return payload;
  if (payload?.content) return payload.content;
  return payload?.embeds?.length ? "[embed]" : "";
}

// Every DM the bot sends is logged so the GM message inbox has a full
// record without needing to also intercept every call site individually.
async function sendDm(user, payload) {
  const dm = await user.createDM();
  const sent = await dm.send(payload);
  await prisma.directMessage
    .create({
      data: { discordUserId: user.id, direction: "OUTBOUND", content: contentOf(payload) },
    })
    .catch(() => {});
  return { dm, sent };
}

module.exports = { sendDm };
