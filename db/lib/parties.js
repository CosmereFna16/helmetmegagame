// A "party" is either a character or a Room stash, resolved to one uniform
// shape so a transfer never has to branch on which side of it it's looking
// at. Promoted out of web/app/(app)/character/requestActions.js so the
// turn-end push (db/lib/stagedPush.js, CommonJS, no Next.js request context)
// and every GM transfer surface can resolve the same key the player-facing
// TRANSFER_RESOURCES request does. Faction Silos used to be the third kind;
// they were removed in 9/2026 (FACTIONS.md).
//
// Takes `prisma` as the first parameter, same reason as db/lib/dm.js:
// db/index.js is the one importing this module, so requiring it back would
// resolve to a partial (prisma-less) exports object.

// "character:<id>" / "room:<id>". A posted key of just "character" (no
// colon, no id) used to leave `id` undefined — Prisma DELETES an undefined
// field from a where clause rather than matching nothing, so "find the
// character with this id" quietly became "find any living character". `?? ""`
// matches nobody, which is the answer a malformed key deserves.
async function resolveParty(prisma, key, { allowDead = false } = {}) {
  const [kind, id] = (key ?? "").split(":");
  if (!id) return null;
  if (kind === "character") {
    // Looting is the one caller that walks past the ALIVE filter — a corpse
    // is still a "party" whose ⬢ someone else can pull. Every other caller
    // (SEND transfer, healing payer, every GM transfer) leaves the flag off
    // and gets the original ALIVE-only lookup.
    const statusFilter = allowDead ? { in: ["ALIVE", "DEAD"] } : "ALIVE";
    const c = await prisma.character.findFirst({
      where: { id: id ?? "", status: statusFilter },
      select: {
        id: true,
        name: true,
        resources: true,
        zoneId: true,
        locationId: true,
        status: true,
        concealed: true,
        buriedAt: true,
        discordUserId: true,
      },
    });
    // locationId/concealed/status/buriedAt are what web/lib/peopleHere.js#isHere
    // judges reach on.
    return c
      ? {
          kind,
          id: c.id,
          name: c.name,
          balance: c.resources,
          zoneId: c.zoneId,
          locationId: c.locationId,
          status: c.status,
          concealed: c.concealed,
          buriedAt: c.buriedAt,
          discordUserId: c.discordUserId,
        }
      : null;
  }
  // A Room's stash (docs/systemdocs/CARRY.md): reach is "standing in this
  // Location, and admitted to this room", decided by web/lib/transferReach.js
  // with db/lib/roomAccess.js#accessibleRooms.
  if (kind === "room") {
    const r = await prisma.room.findUnique({
      where: { id: id ?? "" },
      select: {
        id: true,
        name: true,
        kind: true,
        resources: true,
        locationId: true,
        accessTagSlugs: true,
        destroysContents: true,
        discordThreadId: true,
        location: { select: { name: true, zoneId: true } },
      },
    });
    return r
      ? {
          kind,
          id: r.id,
          name: r.name,
          balance: r.resources,
          zoneId: r.location.zoneId,
          locationId: r.locationId,
          locationName: r.location.name,
          roomKind: r.kind,
          accessTagSlugs: r.accessTagSlugs,
          // The Godard Factory's Spillway, and nothing else. Carried on the
          // party rather than looked up again by every writer, so the one
          // place that puts things into a room can see it.
          destroysContents: r.destroysContents === true,
          discordThreadId: r.discordThreadId,
        }
      : null;
  }
  return null;
}

function partyKey(party) {
  return party ? `${party.kind}:${party.id}` : null;
}

function partyLabel(party) {
  return party?.name ?? "Unknown";
}

module.exports = { resolveParty, partyKey, partyLabel };
