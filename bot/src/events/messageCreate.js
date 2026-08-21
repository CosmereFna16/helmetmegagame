const { prisma, concealedAlias } = require("@lifeweb/db");
const { sendAsCharacter } = require("../lib/proxy");
const { isDesignatedTupperChannel } = require("../lib/channels");
const { handleActionSubmission } = require("../lib/actionSubmission");
const { sendDm } = require("../lib/dm");

// A literal prefix rather than a registered slash command: a slash command
// replies through an interaction, which would not be a webhook message, so
// ✏️ / ❌ / ⭐ / 🔍 would all stop working on it. As a prefix it rides the
// ordinary proxy path and every reaction keeps behaving.
const CONCEAL_PREFIX = "/conceal";

module.exports = {
  name: "messageCreate",
  async execute(message) {
    if (message.author.bot || message.webhookId) return;

    if (!message.inGuild()) {
      await prisma.directMessage
        .create({ data: { discordUserId: message.author.id, direction: "INBOUND", content: message.content } })
        .catch(() => {});
      return;
    }

    const channelName = message.channel.name?.toLowerCase();
    if (channelName === "turns") {
      await handleActionSubmission(message).catch((err) => console.error("Failed to submit action:", err));
      return;
    }

    if (!isDesignatedTupperChannel(message.channel)) return;

    const character = await prisma.character.findFirst({
      where: { discordUserId: message.author.id, status: "ALIVE" },
    });
    if (!character) return;

    const trimmed = message.content.trimStart();
    const wantsConceal = trimmed.toLowerCase().startsWith(CONCEAL_PREFIX);

    let conceal = null;
    let content = null;
    if (wantsConceal) {
      content = trimmed.slice(CONCEAL_PREFIX.length).trim();

      // Open to everyone, with nothing equipped and no tag required — a player
      // decides for themselves when to go unnamed. Tag.concealsIdentity still
      // exists in the catalog but nothing reads it; re-gating is one query here.
      if (!content && message.attachments.size === 0) {
        await message.delete().catch(() => {});
        await sendDm(message.author, "» *Add a message after `/conceal`.*").catch(() => {});
        return;
      }
      conceal = { alias: concealedAlias(character) };
    }

    try {
      await sendAsCharacter(message.channel, character, message, { conceal, content });
    } catch (err) {
      console.error("Failed to proxy message:", err);
    }
  },
};
