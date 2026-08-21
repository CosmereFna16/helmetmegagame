// REST-based logged DM — the third twin of bot/src/lib/dm.js#sendDm (gateway)
// and web/lib/discordGuild.js#sendDm (web REST). This one exists so
// db/index.js's advanceTurn/resolveNeeds path can DM players from BOTH the
// bot's cron and the web Dev Panel's "End turn" button, neither of which can
// rely on a gateway client being present.
//
// Takes `prisma` as a parameter rather than require("../index"), same reason
// as turnAnnouncement.js: db/index.js is the one importing this module, so
// requiring it back would resolve to a partial (prisma-less) exports object.
//
// Deliberately NOT spread into the db/index.js barrel — a bare `sendDm` on
// @lifeweb/db would be a third same-named export with a third signature and
// would invite the wrong one being grabbed. Require it by path.
const { createDmChannel, postMessage } = require("./discordRest");

// Applies the `»` prefix (see CLAUDE.md "Bot message style") and logs to
// DirectMessage so /gm/messages keeps a full conversation record. The log is
// best-effort; the send itself throws on a Discord failure, so callers
// .catch() it.
async function sendDm(prisma, discordUserId, content) {
  const channel = await createDmChannel(discordUserId);
  const formatted = `» ${content}`;
  const message = await postMessage(channel.id, formatted);
  await prisma.directMessage
    .create({ data: { discordUserId, direction: "OUTBOUND", content: formatted } })
    .catch(() => {});
  return message;
}

module.exports = { sendDm };
