const { prisma, concealedAlias } = require("@lifeweb/db");
const { sendAsCharacter } = require("../lib/proxy");
const { isDesignatedTupperChannel, resolveChannelContext } = require("../lib/channels");
const { handleActionSubmission } = require("../lib/actionSubmission");
const { sendDm } = require("../lib/dm");
const {
  canHearPing,
  canJoinThread,
  isPrivateThread,
  messageLink,
  notifyMentioned,
  resolveMentionedCharacters,
} = require("../lib/mentions");

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

    // Captured BEFORE proxying: sendAsCharacter deletes the original message,
    // and the mention list goes with it.
    const mentionedRoleIds = [...message.mentions.roles.keys()];
    const channel = message.channel;

    let proxied;
    try {
      proxied = await sendAsCharacter(channel, character, message, { conceal, content });
    } catch (err) {
      console.error("Failed to proxy message:", err);
      return;
    }

    // A concealed message deliberately relays nothing: the whole point is that
    // the room doesn't know who spoke, and a DM naming the location would hand
    // the target a thread to pull on.
    if (conceal || mentionedRoleIds.length === 0) return;

    await handleMentions({ message, channel, proxied, mentionedRoleIds }).catch((err) =>
      console.error("Failed to handle mentions:", err),
    );
  },
};

// Two independent things a character-role mention does, both of which the bot
// has to perform itself once the roles are assigned to nobody (see the
// identity/access split): notify the player, and — in a private thread — let
// them in, which Discord used to do for free by auto-adding a mentioned role's
// members.
async function handleMentions({ message, channel, proxied, mentionedRoleIds }) {
  const context = resolveChannelContext(channel);
  const mentioned = await resolveMentionedCharacters(mentionedRoleIds, message.author.id);

  // Every gate on this path used to reject in total silence, and the proxy
  // suppresses the role ping itself (allowedMentions parse: ["users"]), so a
  // swallowed mention looked exactly like a delivered one — the chip renders
  // either way. One line per ping makes the whole thing diagnosable from the
  // Railway logs. The commonest "bug" report is a player pinging their own
  // character: resolveMentionedCharacters drops the sender's own characters
  // deliberately, and that shows up here as resolved=0.
  console.log(
    `[mentions] roles=${mentionedRoleIds.join(",")} resolved=${mentioned.length} ` +
      `zone=${context.zoneId ?? "none"} kind=${context.channelKind ?? "location"}`,
  );
  if (mentioned.length === 0) return;

  const link = messageLink(message.guildId, channel.id, proxied.id);
  const privateThread = isPrivateThread(channel);

  for (const target of mentioned) {
    if (privateThread) {
      // Location-scoped, unlike the Zone gate below — Discord needs the target
      // to be able to view the parent channel, which only holds while they're
      // standing in that Location. Telling the pinger why keeps a refusal from
      // reading as a bug; a proxied message has no interaction to reply to.
      if (!canJoinThread(target, context)) {
        console.log(`[mentions] ${target.name}: not in ${context.locationName ?? "this location"}, no thread add`);
        await sendDm(
          message.author,
          `» *${target.name} isn't in ${context.locationName ?? "this location"} — they can't be brought into this thread.*`,
        ).catch(() => {});
        continue;
      }
      await channel.members.add(target.discordUserId).catch((err) =>
        console.error(`Failed to add ${target.discordUserId} to thread ${channel.id}:`, err),
      );
      await notifyMentioned(message.client, target, context, link);
      continue;
    }

    const heard = await canHearPing(target, context);
    console.log(`[mentions] ${target.name}: ${heard ? "notified" : "out of earshot, no DM"}`);
    if (heard) {
      await notifyMentioned(message.client, target, context, link);
    }
  }
}
