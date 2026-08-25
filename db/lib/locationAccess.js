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
const { deleteChannelOverwrite, getChannel } = require("./discordRest");

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
//
// Returns { attempted, failed, failures } rather than nothing. The bare
// `.catch(() => {})` this used to carry was justified by "deleting an
// overwrite that isn't there is a 404, i.e. free" — true of a 404, and true of
// nothing else it was swallowing. A 429, a 403, or the circuit breaker
// REFUSING to make the call at all (db/lib/discordRest.js throws when it is
// open) all came back looking exactly like success, on the one code path that
// stops a departed player from still reading every room they stood in.
async function revokeAllCharacterAccess(prisma, character) {
  const targetIds = [character.discordUserId, character.discordRoleId].filter(Boolean);
  if (targetIds.length === 0) return { attempted: 0, failed: 0, failures: [] };

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

  let attempted = 0;
  const failures = [];
  for (const channelId of channelIds.filter(Boolean)) {
    for (const targetId of targetIds) {
      attempted += 1;
      try {
        // allow404 is already on deleteChannelOverwrite, so "there was no
        // overwrite" returns null rather than throwing. Anything that reaches
        // here is a real failure.
        await deleteChannelOverwrite(channelId, targetId);
      } catch (err) {
        failures.push({ channelId, targetId, message: err.message });
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      `Access revoke for ${character.name ?? character.id}: ${failures.length} of ${attempted} ` +
        `overwrite deletions FAILED. They can still read those rooms. First: ${failures[0].message}`,
    );
  }

  return { attempted, failed: failures.length, failures };
}

// The same revoke for MANY characters at once — Restart Game, where every
// character is going away.
//
// Channel-major rather than character-major, which is the whole point. The
// singular version above sweeps every channel blindly for one character, and
// that is right for a single death: ~124 calls, mostly 404s, buying certainty
// that no overwrite survives on a room they left. Run once per character over
// a full roster it becomes quadratic — 15 locations is 62 channels, so 100
// characters is 12,400 sequential requests and the better part of an hour,
// with ~58 of every 62 deletes hitting nothing.
//
// Reading each channel once and deleting only the overwrites actually on it
// costs `channels + real overwrites` instead: about 460 calls for the same
// roster. Same read-then-delete shape as
// db/lib/syncLocations.js#reconcileChannelOverwrites, and exactly as thorough
// — it still visits every channel, it just stops guessing what is on them.
//
// Sequential throughout (ARCHITECTURE.md §5). Returns { channels, removed }
// so the caller can log what it really did.
async function revokeAccessForCharacters(prisma, characters) {
  const targetIds = new Set();
  for (const character of characters ?? []) {
    if (character.discordUserId) targetIds.add(character.discordUserId);
    if (character.discordRoleId) targetIds.add(character.discordRoleId);
  }
  if (targetIds.size === 0) return { channels: 0, removed: 0 };

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

  let removed = 0;
  let failed = 0;
  let unreadable = 0;
  const visited = channelIds.filter(Boolean);
  for (const channelId of visited) {
    // allow404 returns null for a channel deleted by hand, which is an
    // ordinary state here and not a reason to abandon the sweep half-done. A
    // THROW is different: it means the read failed, and treating that as
    // "there is no such channel" quietly skipped every overwrite on it. Now
    // the two are distinguished and only the first one is silent.
    let live;
    try {
      live = await getChannel(channelId, { allow404: true });
    } catch (err) {
      unreadable += 1;
      console.error(`Access revoke: couldn't read channel ${channelId}, its overwrites are untouched:`, err.message);
      continue;
    }
    if (!live) continue;

    for (const overwrite of live.permission_overwrites ?? []) {
      if (!targetIds.has(overwrite.id)) continue;
      try {
        await deleteChannelOverwrite(channelId, overwrite.id);
        // Counted AFTER the delete succeeds. It used to increment regardless,
        // so the number this function reports "so the caller can log what it
        // really did" counted deletions that never happened.
        removed += 1;
      } catch (err) {
        failed += 1;
        console.error(`Access revoke: failed to remove ${overwrite.id} from ${channelId}:`, err.message);
      }
    }
  }

  if (failed > 0 || unreadable > 0) {
    console.error(
      `Access revoke finished with ${failed} failed deletions and ${unreadable} unreadable channels. ` +
        `Those overwrites are still live.`,
    );
  }

  return { channels: visited.length, removed, failed, unreadable };
}

module.exports = {
  PERM_VIEW_CHANNEL,
  OVERWRITE_TYPE_ROLE,
  OVERWRITE_TYPE_MEMBER,
  locationAccessChannelIds,
  revokeAllCharacterAccess,
  revokeAccessForCharacters,
};
