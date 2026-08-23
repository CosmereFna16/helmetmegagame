// Which Discord objects carry a character's access to a Location, and the
// shape of the overwrite that grants it. Pure — no prisma, no Discord client —
// so both faces build the identical thing (ARCHITECTURE.md §3).
//
// Two things used to be implicit here and both bit:
//
//   1. Access was written to the CATEGORY ONLY, on the belief that the three
//      child channels inherit from it. They don't reliably — Discord "syncs" a
//      channel to its category by copying the overwrites at creation, and the
//      two drift apart afterwards. So a grant on the category alone can leave
//      a character unable to see the rooms they're standing in, the mirror
//      image of the @everyone bug in syncLocations.js. Every one of the four
//      objects is named explicitly now.
//
//   2. The target was the character's personal ROLE. That role is what makes a
//      character mentionable, and it used to be assigned to the player — which
//      put the player's account in the role's member list and quietly
//      deanonymized the whole game. The role is now held by nobody and access
//      is keyed on the MEMBER instead.
const { deleteChannelOverwrite } = require("./discordRest");

const PERM_VIEW_CHANNEL = 1024;

// Discord permission-overwrite types.
const OVERWRITE_TYPE_ROLE = 0;
const OVERWRITE_TYPE_MEMBER = 1;

// Every object a character's ViewChannel grant has to be written to (or
// removed from) for one Location. The category is included as
// defense-in-depth: harmless where inheritance works, and the thing that
// keeps a hand-synced channel correct where it does.
//
// Order matters on grant — category first, so a client that *is* honouring
// inheritance never shows a child channel before the category exists for it.
function locationAccessChannelIds(location) {
  if (!location) return [];
  return [
    location.discordCategoryId,
    location.discordChannelId,
    location.discordPublicChannelId,
    location.discordPrivateChannelId,
  ].filter(Boolean);
}

// Strips every channel-viewing grant a character holds, anywhere in the guild.
//
// Takes `prisma` as its first parameter — the db/lib/dm.js convention — because
// both faces need it: the bot on guildMemberRemove, the web app on death and
// on Restart Game. It is deliberately NOT spread into the @lifeweb/db barrel
// alongside the pure helpers above; require it by path.
//
// Deleting the personal role used to be enough on its own: Discord drops every
// overwrite tied to a role the moment the role goes. That stopped being true
// when access moved to the MEMBER — a member overwrite is not tied to the role
// and outlives it, which would leave a departed player still seeing the room
// they left. So the revoke is explicit, and it clears BOTH keys: the user id
// for the current model, the role id to mop up anything the old one left
// behind. Deleting an overwrite that isn't there is a 404, i.e. free.
//
// It sweeps every Location — category and all three channels — not just the
// character's current one. A grant should only exist where they stand, but a
// half-failed swapLocationAccess leaves one behind on the room they left, and
// this is exactly the wrong moment to trust that invariant.
async function revokeAllCharacterAccess(prisma, character) {
  const targetIds = [character.discordUserId, character.discordRoleId].filter(Boolean);
  if (targetIds.length === 0) return;

  const [locations, config] = await Promise.all([
    prisma.location.findMany({
      where: { discordCategoryId: { not: null } },
      select: {
        discordCategoryId: true,
        discordChannelId: true,
        discordPublicChannelId: true,
        discordPrivateChannelId: true,
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);

  const channelIds = locations.flatMap(locationAccessChannelIds);
  channelIds.push(config?.radioChannelId, config?.intercomChannelId);

  for (const channelId of channelIds.filter(Boolean)) {
    for (const targetId of targetIds) {
      await deleteChannelOverwrite(channelId, targetId).catch(() => {});
    }
  }
}

module.exports = {
  PERM_VIEW_CHANNEL,
  OVERWRITE_TYPE_ROLE,
  OVERWRITE_TYPE_MEMBER,
  locationAccessChannelIds,
  revokeAllCharacterAccess,
};
