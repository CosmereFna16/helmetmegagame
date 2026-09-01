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
const { postDmBatched } = require("./discordRest");

// Applies the `»` prefix (see CLAUDE.md "Bot message style") and logs to
// DirectMessage so /gm/messages keeps a full conversation record. The log is
// best-effort; the send itself throws on a Discord failure, so callers
// .catch() it.
//
// postDmBatched splits anything over Discord's 2000 characters rather than
// letting the send fail, and reuses the cached DM channel. One log row per
// call carries the whole text, however many messages it took to deliver.
// `opts.components` is an optional Discord action row — a DM that carries a
// button (the Bird's Reply, so far). postDmBatched puts it on the LAST chunk.
async function sendDm(prisma, discordUserId, content, opts = {}) {
  const formatted = `» ${content}`;
  const message = await postDmBatched(discordUserId, formatted, opts.components);
  await prisma.directMessage
    .create({
      data: {
        discordUserId,
        direction: "OUTBOUND",
        content: formatted,
        authorDiscordUserId: opts.authorDiscordUserId ?? null,
        source: opts.source ?? "bot_auto",
        discordMessageId: message?.id ?? null,
        // ?? undefined: a caller's explicit null would be rejected by Prisma
        // for a Json? column, and the .catch below would eat the lost row.
        meta: opts.meta ?? undefined,
      },
    })
    .catch(() => {});
  return message;
}

module.exports = { sendDm };
