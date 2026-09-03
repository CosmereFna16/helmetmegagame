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
const { isMounted, equippedSlugs } = require("./mounts");
const { linkBetween, crossingCheck } = require("./locationGraph");

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
  zoneMovesTurnId: true,
  zoneMovesUsed: true,
  // `name` rides along for stowedMounts(), which puts it in a sentence.
  tags: { select: { equipped: true, tag: { select: { slug: true, name: true } } } },
};

// How many zone crossings this character gets for free this turn, before a
// crossing starts spending their Move (docs/systemdocs/CARRY.md §2).
//
// Everyone gets GameConfig.freeZoneMovesPerTurn. An EQUIPPED mount adds one,
// and it now refreshes every turn rather than once a day — a horse carries you
// at Dawn and again at Dusk. Being Overburdened takes the lot: that is the
// cost that replaced the old flat refusal, so an overloaded character can
// still cross, they just pay their Move to do it.
// How many are LEFT right now, for the surfaces that have to say so before a
// player commits: the Travel confirm and the character sheet.
function freeMovesLeft(character, config, openTurn) {
  const allowance = freeZoneMoves(character, config);
  if (!openTurn) return allowance;
  const spent = character?.zoneMovesTurnId === openTurn.id ? (character.zoneMovesUsed ?? 0) : 0;
  return Math.max(0, allowance - spent);
}

function freeZoneMoves(character, config) {
  const held = character.tags ?? [];
  if (held.some((ct) => ct.tag?.slug === OVERBURDENED_SLUG)) return 0;
  const base = config?.freeZoneMovesPerTurn ?? 1;
  return base + (isMounted(equippedSlugs(held)) ? 1 : 0);
}

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
      include: { zone: true },
    });
    if (!currentLocation) {
      return { ok: false, reason: "You can't get there directly from here." };
    }

    // The edge, and what it lets this character do. A missing edge, a hidden
    // one they hold no key to, a locked one and a shut modular gate all
    // refuse here — the picker filters the same verdict, but a client can
    // post any location id it likes, so this is the check that counts.
    const link = await linkBetween(prisma, currentLocation.id, targetLocation.id);
    const gate = crossingCheck(link, {
      tagSlugs: (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
      // Equipped, not merely held — CHARACTER_SELECT already loads `equipped`
      // for exactly this kind of question.
      mounted: isMounted(equippedSlugs(character.tags ?? [])),
    });
    if (!gate.passable) return { ok: false, reason: gate.refusal };
  }

  // A first placement (no current location) is free — it isn't travel, it's
  // arrival. A walk inside the zone is free on the cooldown. Only a hop
  // whose edge crosses into another zone files the Move.
  const first = !currentLocation;
  const crossedZone = !first && currentLocation.zoneId !== targetLocation.zoneId;
  const dragIds = [...new Set(dragged.filter(Boolean))];

  let openTurn = null;
  if (crossedZone) {
    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };
  }
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: {
      locationMoveCooldownSeconds: true,
      archiveTravelEvents: true,
      freeZoneMovesPerTurn: true,
    },
  });
  const cooldownMs = Math.max(0, config?.locationMoveCooldownSeconds ?? 60) * 1000;

  const now = new Date();
  const outcome = { spentTurn: false, usedFreeMove: false, freeMovesLeft: null, draggedRows: [] };

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
        // A crossing spends a FREE ZONE MOVE first, and only when those run
        // out does it spend the Move (docs/systemdocs/CARRY.md §2). So a
        // peasant walks town -> forest for nothing, then pays their Move to
        // reach the fortress, and the way back waits for the next turn.
        //
        // The allowance is claimed by a conditional updateMany whose WHERE is
        // the check, so two tabs cannot both spend the last one. A turn id
        // that differs from the stored one resets the counter in the same
        // statement, which is why nothing ever has to sweep this field.
        const allowance = freeZoneMoves(character, config);
        const spentFree = character.zoneMovesTurnId === openTurn.id ? (character.zoneMovesUsed ?? 0) : 0;

        if (spentFree < allowance) {
          const claimed = await tx.character.updateMany({
            where:
              character.zoneMovesTurnId === openTurn.id
                ? { id: character.id, zoneMovesTurnId: openTurn.id, zoneMovesUsed: spentFree }
                : {
                    id: character.id,
                    // `{ not: x }` never matches NULL in SQL, so the null case
                    // has to be spelled out or a character who has not moved
                    // this turn could never claim their first free move.
                    OR: [{ zoneMovesTurnId: null }, { zoneMovesTurnId: { not: openTurn.id } }],
                  },
            data: { zoneMovesTurnId: openTurn.id, zoneMovesUsed: spentFree + 1 },
          });
          if (claimed.count === 0) throw new MoveRefused("You've already moved. Try again in a moment. ‡");
          outcome.usedFreeMove = true;
          outcome.freeMovesLeft = allowance - (spentFree + 1);
        } else {
          // Out of free moves, so this costs the Move. Acting and crossing are
          // mutually exclusive within a turn, in either order;
          // @@unique([characterId, turnId]) is the real enforcement and the
          // read here is for the message.
          const existing = await tx.action.findFirst({
            where: { characterId: character.id, turnId: openTurn.id },
            select: { id: true },
          });
          if (existing) {
            throw new MoveRefused(
              allowance === 0
                ? "You're overburdened, so you have no free moves left, and you've already acted this turn. ‡"
                : "You're out of free moves this turn, and you've already acted. ‡",
            );
          }
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
        outcome.freeMovesLeft ??= 0;
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
    usedFreeMove: outcome.usedFreeMove,
    freeMovesLeft: outcome.freeMovesLeft,
    moved,
  };
}

module.exports = {
  performLocationMove,
  dragCandidates,
  canDrag,
  freeZoneMoves,
  freeMovesLeft,
  CHARACTER_SELECT,
};
