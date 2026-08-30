// The bare constants module, not the @lifeweb/db barrel — MoveDesk.js (a
// client component) imports moveStatusLabel from this file, and the barrel
// would drag the Prisma client into that bundle.
import { CATATONIC_SLUG } from "@lifeweb/db/lib/constants";
import { MOVE_PIPELINE_LABELS, MOVE_REVIEW_LABELS, moveKindLabel, isTravelMove, rollLabel } from "@/lib/moves";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";

// The DTO mappers the adjudication desk's queue is built from, in one place
// so the two callers can't drift.
//
// They used to live inside gm/turns/[[...selection]]/page.js, which was fine
// while the open turn was the only thing the desk could load. The History
// lens loads a resolved turn through a server action instead, and StagedItems
// reads these rows field by field — a mapper written twice would have gone
// wrong the first time either copy grew a key. Server-side only: the includes
// below are Prisma shapes, and the two callers are an RSC and a server action.

// The includes each mapper expects. Exported for the same reason the mappers
// are — a query missing one of these produces a DTO with silently empty
// fields rather than an error.
export const MOVE_INCLUDE = {
  character: {
    include: {
      // faction.zone is the ZONE SEAT this row answers to — a faction always
      // banks on a seat zone, never on a cave level; `zone` is the PRESENCE
      // zone, where they physically stand, which is what the desk labels.
      faction: { include: { zone: true } },
      zone: true,
      tags: {
        select: {
          tagId: true,
          quantity: true,
          expiresTurn: true,
          tag: { select: TAG_CHIP_FIELDS },
        },
      },
    },
  },
};

export const STAGED_EFFECT_INCLUDE = {
  targetCharacter: { select: { id: true, name: true, updatedAt: true } },
  turn: { select: { id: true, number: true } },
};

export const STAGED_MESSAGE_INCLUDE = {
  recipients: { include: { character: { select: { id: true, name: true, updatedAt: true } } } },
  zone: { select: { id: true, name: true } },
  turn: { select: { id: true, number: true } },
};

function isConfirmed(a) {
  return a.status === "CONFIRMED" || a.status === "ADJUDICATED";
}

// The label is always the review-status label — a live lock never masks it.
// It used to render "In Progress" for any Move under a live lock, which let a
// GM's OWN lock on a Move they had just Solved make the desk they were
// sitting in read back `solved = false` (moveStatusLabel(a, now) === "Solved"
// was the desk's test) and offer Save/Solve on a row that was already SOLVED
// in the DB — the incident this rework fixes. The lock renders separately, as
// presence (a GmAvatar chip — see QueueRail.js), never as a status.
export function moveStatusLabel(a, now) {
  if (!isConfirmed(a)) return MOVE_PIPELINE_LABELS[a.status] ?? a.status;
  return MOVE_REVIEW_LABELS[a.moveReviewStatus] ?? "Open";
}

// "+3 ⬢" / "rolled 5–12 ⬢ → +8". Takes anything carrying the two columns, so
// a raw Action row works as well as a mapped one.
export function declaredLabel(a) {
  const parts = [];
  if (a.resourceRollExpression) parts.push(`rolled ${a.resourceRollExpression.replace("-", "–")} ⬢`);
  if (a.resourceDelta != null) parts.push(`${a.resourceDelta > 0 ? "+" : ""}${a.resourceDelta} ⬢`);
  return parts.length ? parts.join(" → ") : null;
}

// What actually paid at the push — the appliedEffects snapshot as one line.
// Same form as db/lib/moveEffects.js#describeMoveEffects, written out here so
// the web side doesn't pull a db/lib module in just to print "+5 ⬢".
export function paidLabel(applied) {
  const parts = [];
  for (const [key, value] of Object.entries(applied ?? {})) {
    if (!value) continue;
    if (key === "resources") parts.push(`${value > 0 ? "+" : ""}${value} ⬢`);
    else parts.push(`${key}: ${value}`);
  }
  return parts.join(", ");
}

// ctx: { usernameById, now }
export function moveRow(a, { usernameById, now }) {
  const username = usernameById.get(a.character.discordUserId) ?? a.character.discordUserId;
  return {
    id: a.id,
    characterId: a.characterId,
    characterName: a.character.name,
    avatarVersion: a.character.updatedAt.getTime(),
    // AFK marker for the queue row's avatar badge — read straight off the
    // tags MOVE_INCLUDE already loads, so the History lens gets it too.
    catatonic: a.character.tags.some((ct) => ct.tag?.slug === CATATONIC_SLUG),
    // The player desk keys on discordUserId, not characterId — carried here
    // so a Move can link straight to that player's conversation.
    discordUserId: a.character.discordUserId,
    discordUsername: username,
    roleTitle: a.character.roleTitle ?? "",
    factionName: a.character.faction?.name ?? "",
    factionId: a.character.factionId ?? null,
    factionZoneName: a.character.faction?.zone?.name ?? "",
    description: a.description,
    kindLabel: moveKindLabel(a.moveKind, a.gmNotes),
    moveKind: a.moveKind ?? "ROUTINE",
    isTravel: isTravelMove(a.gmNotes),
    gmNotes: a.gmNotes ?? "",
    rollLabel: rollLabel(a),
    statusLabel: moveStatusLabel(a, now),
    // The enum itself, alongside the display label — clients branch on this,
    // not on the string, so a locale/wording change to the label can never
    // silently break a `solved` check (MoveDesk.js).
    reviewStatus: a.moveReviewStatus,
    // Where they stand. Key name kept because MoveDesk and InspectorColumn
    // still read `locationLabel`; the value is now just the presence zone,
    // since Locations are prose Topics and no longer a place on the sheet.
    locationLabel: a.character.zone?.name || "Unassigned",
    // The bare zoneId alongside the label above — PublicComposer needs the
    // id to preselect the Move's own zone, not just its name.
    zoneId: a.character.zone?.id ?? null,
    resources: a.character.resources,
    tags: a.character.tags.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      expiresTurn: ct.expiresTurn,
    })),
    resourceDelta: a.resourceDelta ?? null,
    resourceRollExpression: a.resourceRollExpression ?? null,
    declaredLabel: declaredLabel(a),
    paidLabel: paidLabel(a.appliedEffects),
    resultMessage: a.resultMessage ?? "",
    reviewedByUsername: a.reviewedByDiscordUserId
      ? (usernameById.get(a.reviewedByDiscordUserId) ?? a.reviewedByDiscordUserId)
      : null,
    reviewedByDiscordUserId: a.reviewedByDiscordUserId ?? null,
    reviewedAtLabel: a.reviewedAt ? a.reviewedAt.toISOString().slice(0, 16).replace("T", " ") : null,
    lockedByDiscordUserId: a.lockExpiresAt && a.lockExpiresAt > now ? (a.lockedByDiscordUserId ?? null) : null,
    createdAtMs: a.createdAt.getTime(),
  };
}

// ctx: { usernameById, presenceZoneNameById, openTurn }
export function stagedEffectRow(e, { usernameById, presenceZoneNameById, openTurn }) {
  return {
    id: e.id,
    moveId: e.moveId,
    cavingRollId: e.cavingRollId,
    batchId: e.batchId,
    // Nullable: a Silo -> Silo transfer has no character end.
    targetCharacterId: e.targetCharacterId,
    targetName: e.targetCharacterId ? (e.targetCharacter?.name ?? "(deleted)") : null,
    targetAvatarVersion: e.targetCharacter?.updatedAt ? e.targetCharacter.updatedAt.getTime() : null,
    resources: e.payload?.resources ?? 0,
    tagPoints: e.payload?.tagPoints ?? 0,
    tagOps: e.payload?.tagOps ?? [],
    // { from: {kind,id,name}, to: {kind,id,name}, amount } — mutually
    // exclusive with `resources`, see StagedEffect.payload in schema.prisma.
    transfer: e.payload?.transfer ?? null,
    zoneId: e.payload?.zoneId ?? null,
    zoneName: e.payload?.zoneId ? (presenceZoneNameById.get(e.payload.zoneId) ?? "(deleted zone)") : null,
    applied: Boolean(e.appliedAt),
    appliedError: e.appliedEffect?.error ?? null,
    createdByUsername: usernameById.get(e.createdByDiscordUserId) ?? e.createdByDiscordUserId,
    createdByDiscordUserId: e.createdByDiscordUserId ?? null,
    turnNumber: e.turn?.number ?? null,
    missed: openTurn ? e.turnId !== openTurn.id && !e.appliedAt : !e.appliedAt,
  };
}

// ctx: { usernameById, openTurn }
export function stagedMessageRow(m, { usernameById, openTurn }) {
  return {
    id: m.id,
    moveId: m.moveId,
    cavingRollId: m.cavingRollId,
    kind: m.kind,
    content: m.content,
    zoneId: m.zoneId,
    zoneName: m.zone?.name ?? null,
    recipients: m.recipients.map((r) => ({
      characterId: r.character.id,
      name: r.character.name,
      avatarVersion: r.character.updatedAt.getTime(),
    })),
    sent: Boolean(m.sentAt),
    deliveryFailures: m.deliveryFailures ?? null,
    createdByUsername: usernameById.get(m.createdByDiscordUserId) ?? m.createdByDiscordUserId,
    createdByDiscordUserId: m.createdByDiscordUserId ?? null,
    turnNumber: m.turn?.number ?? null,
    missed: openTurn ? m.turnId !== openTurn.id && !m.sentAt : !m.sentAt,
  };
}

// One copy of each distinct held tag across a set of Moves, for TagChip
// rendering — bounded by the catalog, not the row count.
export function tagsByIdFor(actions) {
  const tagsById = {};
  for (const action of actions) {
    for (const ct of action.character.tags) {
      if (!tagsById[ct.tagId]) tagsById[ct.tagId] = ct.tag;
    }
  }
  return tagsById;
}
