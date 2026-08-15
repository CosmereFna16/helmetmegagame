const { prisma } = require("@lifeweb/db");
const { sendAsCharacter } = require("../lib/proxy");
const { isDesignatedTupperChannel } = require("../lib/channels");
const { handleActionSubmission } = require("../lib/actionSubmission");

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
    if (channelName === "moves" || channelName === "effort") {
      const type = channelName === "moves" ? "MOVE" : "EFFORT";
      await handleActionSubmission(message, type).catch((err) =>
        console.error(`Failed to submit ${type.toLowerCase()}:`, err),
      );
      return;
    }

    if (!isDesignatedTupperChannel(message.channel)) return;

    const character = await prisma.character.findFirst({
      where: { discordUserId: message.author.id, status: "ALIVE" },
    });
    if (!character) return;

    try {
      await sendAsCharacter(message.channel, character, message);
    } catch (err) {
      console.error("Failed to proxy message:", err);
    }
  },
};
