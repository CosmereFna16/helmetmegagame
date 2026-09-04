"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { UserError, guarded } from "@/lib/actionResult";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { refreshLocationAnchor } from "@lifeweb/db/lib/syncZones";
import { notifyCharacter } from "@/lib/notifyCharacter";
import {
  HOLDS_EDGE,
  PRESENT_STATUSES,
  announceEdgeState,
  stakeholderCharacterIds,
  structureDamagedLine,
  structureRepairedLine,
  structureDestroyedLine,
  structureClearedLine,
} from "@lifeweb/db/lib/structures";

// The GM's half of the destruction story (/gm/structures): Damage, Repair,
// Destroy, Clear. IMMEDIATE microactions, the Dev Panel posture — the player
// half is a Gambit adjudicated at the desk, and the GM clicks the outcome
// here while resolving it. Never a Request: these log to AuditLog, and
// Repair is Damage's undo. Every status change is a conditional claim, so
// two GMs clicking at once land exactly one change.

async function requireGm() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId || !isGm) throw new UserError("GMs only. ‡");
  return session;
}

async function loadSite(structureId) {
  const site = await prisma.structure.findUnique({
    where: { id: structureId ?? "" },
    include: { location: { select: { id: true, name: true, discordChannelId: true } } },
  });
  if (!site) throw new UserError("That structure is gone — reload. ‡");
  return site;
}

// Scenery into the Location channel, post-commit and catch-logged — the
// speakAtSite rule: Discord must never roll back a ruling that committed.
function speak(site, line) {
  const channelId = site.location?.discordChannelId;
  if (!channelId || !line) return;
  after(() =>
    postMessage(channelId, line).catch((err) =>
      console.error("Structure ruling ambient line failed:", err),
    ),
  );
}

// Contributors and the payer hear when the thing their turns raised changes
// state (plan: the notification list is what ownership left behind).
function dmStakeholders(site, text) {
  after(async () => {
    const ids = await stakeholderCharacterIds(prisma, site.id, { payerKey: site.payerKey });
    if (!ids.length) return;
    const people = await prisma.character.findMany({
      where: { id: { in: ids }, status: "ALIVE" },
      select: { id: true, discordUserId: true },
    });
    for (const person of people) notifyCharacter(person, text);
  });
}

function repostAnchors(locationIds) {
  if (!locationIds?.length) return;
  after(async () => {
    for (const locationId of locationIds) {
      await refreshLocationAnchor(prisma, locationId).catch((err) =>
        console.error(`Structure anchor refresh failed for ${locationId}:`, err?.message ?? err),
      );
    }
  });
}

async function logOp(tx, session, actionType, site, extra = {}) {
  await tx.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType,
      details: {
        structureId: site.id,
        typeSlug: site.typeSlug,
        typeName: site.typeName,
        locationId: site.locationId,
        locationName: site.location?.name ?? null,
        ...extra,
      },
    },
  });
}

function refreshViews() {
  revalidatePath("/gm/structures");
  // The dynamic-route form, so a GM parked on /gm/turns/move/<id> is
  // invalidated too, not just the bare desk URL.
  revalidatePath("/gm/turns/[[...selection]]", "page");
  revalidatePath("/character");
}

async function damageStructureImpl({ structureId }) {
  const session = await requireGm();
  const site = await loadSite(structureId);
  await prisma.$transaction(async (tx) => {
    const claim = await tx.structure.updateMany({
      where: { id: site.id, status: "COMPLETE" },
      data: { status: "DAMAGED" },
    });
    if (claim.count === 0) throw new UserError("Only a standing structure can be damaged — reload. ‡");
    await logOp(tx, session, "structure_damaged", site);
  });
  // Its edge stays held (HOLDS_EDGE includes DAMAGED) — damaged is a word,
  // not a demolition — so there is no link work and no anchor to repost.
  speak(site, structureDamagedLine(site));
  dmStakeholders(site, `The ${site.typeName} at ${site.location?.name ?? "its ground"} has been damaged. ‡`);
  refreshViews();
  return { status: "DAMAGED" };
}

async function repairStructureImpl({ structureId }) {
  const session = await requireGm();
  const site = await loadSite(structureId);
  await prisma.$transaction(async (tx) => {
    const claim = await tx.structure.updateMany({
      where: { id: site.id, status: "DAMAGED" },
      data: { status: "COMPLETE" },
    });
    if (claim.count === 0) throw new UserError("Only a damaged structure can be repaired — reload. ‡");
    await logOp(tx, session, "structure_repaired", site);
  });
  speak(site, structureRepairedLine(site));
  dmStakeholders(site, `The ${site.typeName} at ${site.location?.name ?? "its ground"} stands whole again. ‡`);
  refreshViews();
  return { status: "COMPLETE" };
}

// Destroy takes any present status — a rising site sabotaged mid-build is
// destroyed work, never silently (plan §4f) — and reverts a held edge to
// its born state. The wreck stays on Examine; Clear is what sweeps it.
async function destroyStructureImpl({ structureId }) {
  const session = await requireGm();
  const site = await loadSite(structureId);
  let anchorIds = [];
  let linkNowOpen = null;
  await prisma.$transaction(async (tx) => {
    // Lock the row and read the status FRESH — the pre-transaction load is
    // a snapshot, and the audit detail must not record a state another GM
    // changed a heartbeat ago.
    const lockedRows =
      await tx.$queryRaw`SELECT "status" FROM "Structure" WHERE "id" = ${site.id} FOR UPDATE`;
    const wasStatus = lockedRows?.[0]?.status ?? site.status;
    const claim = await tx.structure.updateMany({
      where: { id: site.id, status: { in: PRESENT_STATUSES } },
      data: { status: "RUINED" },
    });
    if (claim.count === 0) throw new UserError("That structure is already down — reload. ‡");
    if (site.linkId) {
      await tx.$queryRaw`SELECT "id" FROM "LocationLink" WHERE "id" = ${site.linkId} FOR UPDATE`;
      const link = await tx.locationLink.findUnique({
        where: { id: site.linkId },
        select: { aId: true, bId: true, authoredOpen: true },
      });
      if (link) {
        // Defensive: binding guarantees one holder, but revert only when
        // nothing in HOLDS_EDGE still holds the edge (our row is RUINED
        // now, so it no longer counts).
        const holders = await tx.structure.count({
          where: { linkId: site.linkId, status: { in: HOLDS_EDGE } },
        });
        if (holders === 0) {
          await tx.locationLink.update({
            where: { id: site.linkId },
            data: { isOpen: link.authoredOpen },
          });
          anchorIds = [link.aId, link.bId];
          linkNowOpen = link.authoredOpen;
        }
      }
    }
    await logOp(tx, session, "structure_destroyed", site, {
      wasStatus,
      linkId: site.linkId ?? null,
      linkReverted: anchorIds.length > 0,
    });
  });
  repostAnchors(anchorIds);
  if (anchorIds.length > 0) {
    // Both banks hear the road change — the destruction line below speaks
    // only at the site, and the far side must not learn by walking into it.
    after(() =>
      announceEdgeState(prisma, anchorIds, linkNowOpen).catch((err) =>
        console.error("Destroy edge announcement failed:", err?.message ?? err),
      ),
    );
  }
  speak(site, structureDestroyedLine(site));
  dmStakeholders(site, `The ${site.typeName} at ${site.location?.name ?? "its ground"} has been destroyed. ‡`);
  refreshViews();
  return { status: "RUINED" };
}

// Clearing deletes the row (StructureWork cascades) — the ground forgets.
// Wrecks only, and no stakeholder DM: they already heard the destruction or
// abandonment, and "the rubble was tidied" is not news anyone needs at 3am.
async function clearStructureImpl({ structureId }) {
  const session = await requireGm();
  const site = await loadSite(structureId);
  await prisma.$transaction(async (tx) => {
    // Same fresh-under-lock read as Destroy: the audit row must record
    // what the row really said when the ruling landed.
    const lockedRows =
      await tx.$queryRaw`SELECT "status" FROM "Structure" WHERE "id" = ${site.id} FOR UPDATE`;
    const wasStatus = lockedRows?.[0]?.status ?? site.status;
    const gone = await tx.structure.deleteMany({
      where: { id: site.id, status: { in: ["RUINED", "ABANDONED"] } },
    });
    if (gone.count === 0) throw new UserError("Only a wreck can be cleared — reload. ‡");
    await logOp(tx, session, "structure_cleared", site, { wasStatus });
  });
  speak(site, structureClearedLine(site));
  refreshViews();
  return { cleared: true };
}

export async function damageStructure(input) {
  return guarded(() => damageStructureImpl(input));
}

export async function repairStructure(input) {
  return guarded(() => repairStructureImpl(input));
}

export async function destroyStructure(input) {
  return guarded(() => destroyStructureImpl(input));
}

export async function clearStructure(input) {
  return guarded(() => clearStructureImpl(input));
}
