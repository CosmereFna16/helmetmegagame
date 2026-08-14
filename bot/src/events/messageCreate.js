const { prisma } = require("@lifeweb/db");
const { sendAsCharacter } = require("../lib/proxy");

module.exports = {
  name: "messageCreate",
  async execute(message) {
    if (message.author.bot || message.webhookId) return;
    if (!message.inGuild()) return;

    const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
    const tupperChannelIds = config?.tupperChannelIds ?? [];
    if (tupperChannelIds.length === 0) return;

    const isDesignated =
      tupperChannelIds.includes(message.channel.id) ||
      (message.channel.parentId && tupperChannelIds.includes(message.channel.parentId));
    if (!isDesignated) return;

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
