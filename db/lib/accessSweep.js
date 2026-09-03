// Strips everything that grants a character sight of the game — the zone
// role, and every per-member channel overwrite: the Location channel they
// were standing in, the special channels' grants, and any strays. Used on
// death, on guildMemberRemove, and — in bulk — by Restart Game.
//
// The Location channel sweep is load-bearing now rather than tidy-up. A
// Location wears no Discord role since the overwrite rework, so a dead
// character's sight of the room they died in is an overwrite, and this is
// the only thing that takes it away (the doctor's occupancy check is the
// safety net). allAccessChannelIds() already enumerates every Location
// channel, which is why the shape below did not have to change.
//
// Takes `prisma` as the first parameter (the db/lib/dm.js convention) and is
// deliberately NOT on the @lifeweb/db barrel; require it by path.
//
// Both functions return counts and failure lists rather than nothing:
// a revoke that silently fails leaves a departed player still reading rooms,
// which is exactly the class of bug the zone rework exists to end.
const { deleteChannelOverwrite, getChannel, removeMemberRole, listGuildMembers } = require("./discordRest");
const { SPECIAL_CHANNELS } = require("./specialChannels");

function zoneChannelIds(zone) {
  if (!zone) return [];
  return [
    zone.discordCategoryId,
    zone.discordSummaryChannelId,
    ...(zone.locations ?? []).map((l) => l.discordChannelId),
  ].filter(Boolean);
}

async function allAccessChannelIds(prisma) {
  const [zones, config] = await Promise.all([
    prisma.zone.findMany({
      select: {
        discordCategoryId: true,
        discordSummaryChannelId: true,
        locations: { select: { discordChannelId: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
  ]);
  const channelIds = zones.flatMap(zoneChannelIds);
  for (const entry of SPECIAL_CHANNELS) channelIds.push(config?.[entry.configKey]);
  return channelIds.filter(Boolean);
}

// One character's full revoke: every zone role stripped (removing a role the
// member doesn't hold is a no-op, so all of them cost less than working out
// which they held from possibly-stale state), then their member overwrites
// swept from every Location channel, zone channel and special channel.
async function revokeAllCharacterAccess(prisma, character) {
  const targetIds = [character.discordUserId, character.discordRoleId].filter(Boolean);
  const failures = [];
  let attempted = 0;

  if (character.discordUserId) {
    const zoneRoles = await prisma.zone.findMany({
      where: { discordRoleId: { not: null } },
      select: { discordRoleId: true, name: true },
    });
    for (const row of zoneRoles) {
      attempted += 1;
      try {
        await removeMemberRole(character.discordUserId, row.discordRoleId);
      } catch (err) {
        failures.push({ target: `access role ${row.name}`, message: err.message });
      }
    }
  }

  if (targetIds.length > 0) {
    const channelIds = await allAccessChannelIds(prisma);
    for (const channelId of channelIds) {
      for (const targetId of targetIds) {
        attempted += 1;
        try {
          // allow404 is already on deleteChannelOverwrite, so "there was no
          // overwrite" returns null rather than throwing. Anything that
          // reaches the catch is a real failure.
          await deleteChannelOverwrite(channelId, targetId);
        } catch (err) {
          failures.push({ target: `${channelId}/${targetId}`, message: err.message });
        }
      }
    }
  }

  if (failures.length > 0) {
    console.error(
      `Access revoke for ${character.name ?? character.id}: ${failures.length} of ${attempted} ` +
        `revocations FAILED. They may still read those rooms. First: ${failures[0].message}`,
    );
  }
  return { attempted, failed: failures.length, failures };
}

// The same revoke for MANY characters at once — Restart Game, where every
// character is going away.
//
// Two halves, both bulk-shaped rather than per-character:
//   1. Role strip: one paginated member-list read, then one removal per
//      (member × zone role actually held) — never a blind per-character loop.
//      Zone roles only; a Location grants sight by overwrite, swept below.
//   2. Overwrite sweep, channel-major: read each channel once, delete only
//      the member overwrites actually present that belong to the roster.
//      Same read-then-delete shape as the sync's reconcile, and what keeps a
//      full-roster wipe at hundreds of calls instead of tens of thousands.
//
// Sequential throughout (ARCHITECTURE.md §5).
async function revokeAccessForCharacters(prisma, characters) {
  const targetIds = new Set();
  for (const character of characters ?? []) {
    if (character.discordUserId) targetIds.add(character.discordUserId);
    if (character.discordRoleId) targetIds.add(character.discordRoleId);
  }
  if (targetIds.size === 0) return { channels: 0, removed: 0, rolesRemoved: 0, failed: 0, unreadable: 0 };

  let rolesRemoved = 0;
  let failed = 0;

  const zoneRoles = await prisma.zone.findMany({
    where: { discordRoleId: { not: null } },
    select: { discordRoleId: true },
  });
  const zoneRoleIds = new Set(zoneRoles.map((z) => z.discordRoleId));
  if (zoneRoleIds.size > 0) {
    try {
      const members = await listGuildMembers();
      for (const member of members) {
        if (!targetIds.has(member.user.id)) continue;
        for (const roleId of member.roles) {
          if (!zoneRoleIds.has(roleId)) continue;
          try {
            await removeMemberRole(member.user.id, roleId);
            rolesRemoved += 1;
          } catch (err) {
            failed += 1;
            console.error(`Access revoke: failed to strip zone role from ${member.user.id}:`, err.message);
          }
        }
      }
    } catch (err) {
      failed += 1;
      console.error("Access revoke: couldn't list guild members, zone roles were not stripped:", err.message);
    }
  }

  let removed = 0;
  let unreadable = 0;
  const visited = await allAccessChannelIds(prisma);
  for (const channelId of visited) {
    // allow404 returns null for a channel deleted by hand — ordinary here. A
    // THROW means the read failed, and treating that as "no such channel"
    // would quietly skip every overwrite on it.
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
        removed += 1;
      } catch (err) {
        failed += 1;
        console.error(`Access revoke: failed to remove ${overwrite.id} from ${channelId}:`, err.message);
      }
    }
  }

  if (failed > 0 || unreadable > 0) {
    console.error(
      `Access revoke finished with ${failed} failures and ${unreadable} unreadable channels. ` +
        `Some access may still be live — the channel doctor's next pass reconciles it.`,
    );
  }

  return { channels: visited.length, removed, rolesRemoved, failed, unreadable };
}

module.exports = {
  zoneChannelIds,
  revokeAllCharacterAccess,
  revokeAccessForCharacters,
};
