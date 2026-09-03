// The database half of ANY player-driven location change — the #turns Travel
// button and /location (bot) both come through here; the web app's writers
// (creation, GM teleport, Bulk Move, MOVE_CHARACTER) are raw relocations and
// do not. It validates the hop, enforces the same-zone cooldown or files the
// Move a zone crossing costs, moves anyone dragged along, and performs **no
// Discord side effects**: the caller runs
// db/lib/locationMove.js#applyLocationMoveSideEffects over `moved`.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { recordArchiveEvent } = require("./archive");
const { seatZoneIdFor } = require("./seatZone");
const { rollCavingOnArrival } = require("./cavingPass");
const { INCAPACITATING_SLUGS } = require("./incapacitation");
const { OVERBURDENED_SLUG } = require("./constants");
const { isMounted } = require("./mounts");
const { turnDay } = require("./turnFormat");

const CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  discordUserId: true,
  locationId: true,
  zoneId: true,
  factionId: true,
  isLeader: true,
  buriedAt: true,
  tags: { select: { tag: { select: { slug: true } } } },
};

// Who `mover` may bring along: anyone in the same ZONE who is a corpse, is
// helpless (INCAPACITATING_SLUGS), or is in the mover's faction if the mover
// leads it — the MOVE_CHARACTER authority. Pure, so the picker and the
// server-side re-check share it.
function canDrag(mover, target) {
  if (!target || target.id === mover.id) return false;
  if (target.buriedAt) return false;
  if (target.zoneId !== mover.zoneId) return false;
  if (target.status === "DEAD") return true;
  if (target.status !== "ALIVE") return false;
  if (target.tags?.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))) return true;
  return Boolean(mover.isLeader && target.factionId && target.factionId === mover.factionId);
}

function dragReason(target) {
  if (target.status === "DEAD") return "corpse";
  if (target.tags?.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))) return "can't stop you";
  return "your faction";
}

// Everyone the mover could drag right now.
async function dragCandidates(prisma, mover) {
  if (!mover.zoneId) return [];
  const others = await prisma.character.findMany({
    where: { id: { not: mover.id }, zoneId: mover.zoneId, buriedAt: null, status: { in: ["ALIVE", "DEAD"] } },
    select: CHARACTER_SELECT,
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });
  return others.filter((t) => canDrag(mover, t)).map((t) => ({ ...t, reason: dragReason(t) }));
}

class MoveRefused extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.refused = true;
    Object.assign(this, extra);
  }
}

// `character` is the mover as loaded by the caller (needs id, name,
// locationId, zoneId, factionId, isLeader, discordUserId, tags);
// `targetLocation` must include its zone. `dragged` is a list of character
// ids, re-authorized here — a picker is a hint, not a lock.
async function performLocationMove(prisma, character, targetLocation, { dragged = [] } = {}) {
  if (!targetLocation?.zone) throw new Error("performLocationMove needs targetLocation.zone");

  let currentLocation = null;
  if (character.locationId) {
    if (character.locationId === targetLocation.id) {
      return { ok: false, reason: "You're already there." };
    }
    currentLocation = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { zone: true, connectsTo: { where: { id: targetLocation.id }, select: { id: true } } },
    });
    if (!currentLocation || currentLocation.connectsTo.length === 0) {
      return { ok: false, reason: "You can't get there directly from here." };
    }
  }

  // A first placement (no current location) is free — it isn't travel, it's
  // arrival. A walk inside the zone is free on the cooldown. Only a hop
  // whose edge crosses into another zone files the Move.
  const first = !currentLocation;
  const crossedZone = !first && currentLocation.zoneId !== targetLocation.zoneId;
  const dragIds = [...new Set(dragged.filter(Boolean))];

  let openTurn = null;
  if (crossedZone) {
    // Over a carry cap (db/lib/carry.js). Only the mover is gated — the
    // dragged are corpses and the helpless — and only a zone crossing: a hop
    // inside the zone stays free so they can walk to a room and stash.
    if (character.tags?.some((ct) => ct.tag?.slug === OVERBURDENED_SLUG)) {
      return {
        ok: false,
        reason: "You're overburdened. Stash or hand off some of what you carry before you cross into another zone. ‡",
      };
    }
    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };
  }
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { locationMoveCooldownSeconds: true, archiveTravelEvents: true },
  });
  const cooldownMs = Math.max(0, config?.locationMoveCooldownSeconds ?? 60) * 1000;

  const now = new Date();
  const outcome = { spentTurn: false, usedHorse: false, draggedRows: [] };

  try {
    await prisma.$transaction(async (tx) => {
      // Dragged characters are re-loaded and re-authorized INSIDE the
      // transaction. One who wandered off fails the whole move rather than
      // being silently dropped — the same posture the old FAST_TRAVEL
      // request took with its passengers.
      if (dragIds.length > 0) {
        const mover = await tx.character.findUnique({ where: { id: character.id }, select: CHARACTER_SELECT });
        const targets = await tx.character.findMany({ where: { id: { in: dragIds } }, select: CHARACTER_SELECT });
        for (const id of dragIds) {
          const target = targets.find((t) => t.id === id);
          if (!canDrag(mover, target)) {
            throw new MoveRefused(
              target ? `You can't bring ${target.name} along.` : "Someone you picked isn't here any more.",
            );
          }
        }
        outcome.draggedRows = targets;
      }

      if (crossedZone) {
        // Acting and crossing zones are mutually exclusive within a turn, in
        // either order. @@unique([characterId, turnId]) is the enforcement;
        // the read here is for the message — and for the mount, which buys
        // ONE extra crossing a day, claimed by a conditional updateMany whose
        // WHERE is the check (two tabs cannot both pass).
        const existing = await tx.action.findFirst({
          where: { characterId: character.id, turnId: openTurn.id },
          select: { id: true },
        });
        if (existing) {
          const heldSlugs = new Set((character.tags ?? []).map((ct) => ct.tag.slug));
          if (!isMounted(heldSlugs)) throw new MoveRefused("You've already acted this turn.");
          const dayKey = String(turnDay(openTurn));
          const claimed = await tx.character.updateMany({
            where: {
              id: character.id,
              OR: [{ fastTravelTurnId: null }, { fastTravelTurnId: { not: dayKey } }],
            },
            data: { fastTravelTurnId: dayKey },
          });
          if (claimed.count === 0) throw new MoveRefused("Your mount has already carried you today.");
          outcome.usedHorse = true;
        } else {
          await tx.action.create({
            data: {
              characterId: character.id,
              turnId: openTurn.id,
              type: "MOVE",
              status: "CONFIRMED",
              moveReviewStatus: "SOLVED",
              description: `Traveled to ${targetLocation.name} (${targetLocation.zone.name}).`,
              // The SEAT zone, not the presence zone — a Move filed from the
              // Railroad belongs on the Caves GM's table.
              zoneId: seatZoneIdFor(targetLocation.zone),
              resultMessage: `» Traveled to ${targetLocation.name}.`,
              gmNotes: "auto:zone_change",
            },
          });
          outcome.spentTurn = true;
        }
        await tx.character.update({
          where: { id: character.id },
          data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId, lastLocationMoveAt: now },
        });
      } else {
        // Same zone (or first placement): the cooldown, enforced by the
        // WHERE of a conditional update so two clicks in one tick can't both
        // pass.
        const cutoff = new Date(now.getTime() - cooldownMs);
        const claimed = await tx.character.updateMany({
          where: {
            id: character.id,
            OR: [{ lastLocationMoveAt: null }, { lastLocationMoveAt: { lte: cutoff } }],
          },
          data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId, lastLocationMoveAt: now },
        });
        if (claimed.count === 0) {
          const row = await tx.character.findUnique({
            where: { id: character.id },
            select: { lastLocationMoveAt: true },
          });
          const readyAt = (row?.lastLocationMoveAt?.getTime() ?? 0) + cooldownMs;
          const seconds = Math.max(1, Math.ceil((readyAt - now.getTime()) / 1000));
          throw new MoveRefused(`You're still catching your breath — ${seconds}s. ‡`, { retryAfterSeconds: seconds });
        }
      }

      if (outcome.draggedRows.length > 0) {
        await tx.character.updateMany({
          where: { id: { in: outcome.draggedRows.map((t) => t.id) } },
          data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId, lastLocationMoveAt: now },
        });
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: character.discordUserId ?? null,
            actionType: "characters_dragged",
            targetCharacterId: character.id,
            details: {
              mover: character.name,
              to: targetLocation.name,
              zone: targetLocation.zone.name,
              dragged: outcome.draggedRows.map((t) => ({ id: t.id, name: t.name })),
            },
          },
        });
      }
    });
  } catch (err) {
    if (err?.refused) return { ok: false, reason: err.message, retryAfterSeconds: err.retryAfterSeconds };
    if (err?.code === "P2002") return { ok: false, reason: "You've already acted this turn." };
    throw err;
  }

  // Off by default (see GameConfig.archiveTravelEvents), and only for a
  // zone crossing — a row per cooldown step would be exactly the volume the
  // gate exists to prevent.
  if (config?.archiveTravelEvents && crossedZone) {
    await recordArchiveEvent(prisma, {
      kind: "TRAVEL",
      character,
      zoneId: targetLocation.zoneId,
      zoneName: targetLocation.zone.name,
      content: `${character.name} left ${currentLocation.zone.name} for ${targetLocation.zone.name}.`,
    });
  }

  const moved = [];
  for (const row of [character, ...outcome.draggedRows]) {
    const fromLocationId = row.id === character.id ? currentLocation?.id ?? null : row.locationId;
    const fromZoneId = row.id === character.id ? currentLocation?.zoneId ?? null : row.zoneId;
    // The Caving Die's "on arrival" trigger. Null on any zone that isn't a
    // cave level, or if the character already rolled this turn some other
    // way; kind, open turn and error swallowing all live in the helper.
    const cavingDm = await rollCavingOnArrival(prisma, row, targetLocation.zone);
    moved.push({
      character: { id: row.id, name: row.name, discordUserId: row.discordUserId, status: row.status },
      fromLocationId,
      fromZoneId,
      toLocationId: targetLocation.id,
      toZoneId: targetLocation.zoneId,
      zoneChanged: fromZoneId !== targetLocation.zoneId,
      cavingDm,
    });
  }

  return {
    ok: true,
    oldLocation: currentLocation,
    oldZone: currentLocation?.zone ?? null,
    targetLocation,
    targetZone: targetLocation.zone,
    crossedZone,
    spentTurn: outcome.spentTurn,
    usedHorse: outcome.usedHorse,
    moved,
  };
}

module.exports = { performLocationMove, dragCandidates, canDrag, CHARACTER_SELECT };
