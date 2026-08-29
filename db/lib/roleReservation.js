// Seat holds for a role in progress on the creation wizard. Without this, a
// player who picks a capacity-1 role at step 1 and spends ten minutes on the
// tag menu can lose the seat at Confirm with no warning ("someone took my
// role"). This is the wizard-side half; the actual race-closing lock lives
// in createActions.js's create transaction — see the header comment there.
//
// Takes `prisma` as its first parameter, the same convention as
// db/lib/dm.js and db/lib/factionPermissions.js, and deliberately not spread
// into the @lifeweb/db barrel for the same reason: db/lib/roleCapacity.js
// (the seat-cap math this module builds on) IS in the barrel, so requiring
// this by path keeps the two call shapes distinct rather than colliding.
const { roleCapacity, isPermanentSeat, seatHolderStatuses } = require("./roleCapacity");

// 30 minutes: long enough to read the tag menu carefully, short enough that
// an abandoned tab frees a unique seat the same session. Refreshed on every
// step advance in the wizard, not just on the initial pick.
const RESERVATION_TTL_MS = 30 * 60 * 1000;

// Deletes reservations that have expired for one role. Called inline by
// every read/write below rather than from a cron job — expiry only ever
// needs to be correct at the moment someone is checking capacity.
async function sweepExpired(tx, roleId) {
  await tx.roleReservation.deleteMany({ where: { roleId, expiresAt: { lt: new Date() } } });
}

// Attempts to hold (or extend) a seat for discordUserId. Takes a row lock on
// the Role first — same pattern as equipActions.js's equip-slot check and
// gm/dev/characters/[characterId]/actions.js — so two concurrent reservers
// serialize instead of both reading the same stale count.
async function reserveRole(prisma, discordUserId, roleId, playerCount) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${roleId} FOR UPDATE`;
    await sweepExpired(tx, roleId);

    const role = await tx.role.findUnique({ where: { id: roleId } });
    if (!role) return { ok: false, reason: "ROLE_NOT_FOUND" };

    const cap = roleCapacity(role, playerCount);
    const [aliveCount, reservedByOthers] = await Promise.all([
      tx.character.count({ where: { roleId, status: { in: seatHolderStatuses(role) } } }),
      tx.roleReservation.count({ where: { roleId, discordUserId: { not: discordUserId } } }),
    ]);
    // The caller's own existing hold on THIS role doesn't count against
    // itself — re-reserving to push the expiry out must never fail.
    if (aliveCount + reservedByOthers >= cap) {
      return { ok: false, reason: "ROLE_FULL" };
    }

    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
    // @unique on discordUserId: a player can hold exactly one seat, ever.
    // Reserving a different role while already holding one releases the
    // first as part of the same upsert.
    await tx.roleReservation.upsert({
      where: { discordUserId },
      create: { discordUserId, roleId, expiresAt },
      update: { roleId, expiresAt },
    });
    return { ok: true, expiresAt };
  });
}

// The picker's count: seated characters (ALIVE, plus DEAD on a permanent
// seat — roleCapacity.js#seatHolderStatuses) plus live reservations by
// everyone EXCEPT the caller, so a player's own hold renders their role as
// available to them and taken to everyone else. Takes role rows ({ id, slug })
// rather than ids because the slug decides which statuses count.
async function takenCounts(prisma, roles, excludeDiscordUserId) {
  if (roles.length === 0) return new Map();
  const roleIds = roles.map((r) => r.id);
  const permanentIds = roles.filter(isPermanentSeat).map((r) => r.id);
  await prisma.roleReservation.deleteMany({
    where: { roleId: { in: roleIds }, expiresAt: { lt: new Date() } },
  });
  const [aliveRows, deadRows, reservedRows] = await Promise.all([
    prisma.character.groupBy({ by: ["roleId"], where: { roleId: { in: roleIds }, status: "ALIVE" }, _count: true }),
    permanentIds.length === 0
      ? []
      : prisma.character.groupBy({ by: ["roleId"], where: { roleId: { in: permanentIds }, status: "DEAD" }, _count: true }),
    prisma.roleReservation.groupBy({
      by: ["roleId"],
      where: { roleId: { in: roleIds }, discordUserId: { not: excludeDiscordUserId ?? "" } },
      _count: true,
    }),
  ]);
  const counts = new Map();
  for (const row of [...aliveRows, ...deadRows, ...reservedRows]) {
    counts.set(row.roleId, (counts.get(row.roleId) ?? 0) + row._count);
  }
  return counts;
}

async function releaseRole(prisma, discordUserId) {
  await prisma.roleReservation.deleteMany({ where: { discordUserId } });
}

module.exports = { reserveRole, takenCounts, releaseRole, RESERVATION_TTL_MS };
