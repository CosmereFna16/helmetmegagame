const { ChannelType } = require("discord.js");
const { prisma, buildNarrowcastContext, computeNarrowcastAccess } = require("@lifeweb/db");
const { sendDm } = require("./dm");

// Character-role mentions: who was pinged, may they hear it, and (in a private
// thread) letting them in.
//
// A character's personal Discord role is a mentionable name token —
// Character.discordRoleId is @unique, so a mentioned role id resolves straight
// back to one character. Mentioning a GM/spectator/player role resolves to
// nothing and is silently ignored, which is how non-character roles stay out
// of this path.

// Whether a ping in this channel should reach `character` at all.
//
// The rule is that a ping must not carry further than a voice would, or it
// becomes a free cross-map signalling channel. Two cases, because the two
// kinds of channel mean different things by "in earshot":
//
//   - A Location channel is gated on ZONE, deliberately looser than the room
//     itself: someone in the Square can shout for someone at the Cathedral.
//   - #watch / #intercom have no Zone at all, so they're gated on whether the
//     target currently *hears that channel* under its own rules — which reuses
//     db/lib/narrowcastAccess.js rather than inventing a second copy of them.
async function canHearPing(character, context) {
  if (context.channelKind === "watch" || context.channelKind === "intercom") {
    const ctx = await buildNarrowcastContext(prisma, character.id);
    return Boolean(computeNarrowcastAccess(ctx)[context.channelKind]?.view);
  }
  if (!context.zoneId) return false;
  return character.zoneId === context.zoneId;
}

// The ALIVE characters behind the roles mentioned in `message`. Read BEFORE
// the message is proxied: sendAsCharacter deletes the original
// (bot/src/lib/proxy.js), so the caller has to capture mentions first and pass
// them here.
//
// Pinging your own character DOES relay. There used to be a filter dropping
// the sender's own characters, on the reasoning that nobody needs telling they
// pinged themselves — but the proxy suppresses the ping itself
// (allowedMentions parse: ["users"], PROXYING.md §2), so a self-ping was the
// one case that looked exactly like a broken relay while being working-as-
// intended, and it is the first thing anyone reaches for to test the feature.
// A redundant DM to yourself is much cheaper than a feature nobody can verify.
async function resolveMentionedCharacters(roleIds) {
  if (roleIds.length === 0) return [];
  return prisma.character.findMany({
    where: { discordRoleId: { in: roleIds }, status: "ALIVE" },
  });
}

function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

// Deliberately carries where and a link, never the message text. A ping into a
// private thread the target hasn't joined would otherwise leak the room's
// content to them, and a DirectMessage row outlives the ❌ that deletes the
// message it quoted.
async function notifyMentioned(client, character, context, link) {
  const where = context.threadName
    ? `${context.zoneName ?? "somewhere"} · ${context.threadName}`
    : (context.zoneName ?? (context.channelKind === "watch" ? "the Watch's radio" : "the Intercom"));

  const user = await client.users.fetch(character.discordUserId).catch(() => null);
  if (!user) return;
  await sendDm(user, `» *You were mentioned in ${where}.*\n${link}`).catch(() => {});
}

// Adding someone to a private thread is LOCATION-scoped, stricter than the
// Zone gate above and not a choice we get to make: Discord requires the target
// to be able to view the thread's parent channel, and that view comes from the
// per-character overwrite on the Location category, which only exists while
// they're standing there. Adding someone who can't see the parent would put a
// thread in their sidebar they can't open.
function canJoinThread(character, context) {
  return Boolean(context.locationId) && character.locationId === context.locationId;
}

function isPrivateThread(channel) {
  return channel?.type === ChannelType.PrivateThread;
}

module.exports = {
  canHearPing,
  canJoinThread,
  isPrivateThread,
  messageLink,
  notifyMentioned,
  resolveMentionedCharacters,
};
