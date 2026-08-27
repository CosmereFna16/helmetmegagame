import { prisma } from "@lifeweb/db";
import { listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/requests";
import { MOVE_PIPELINE_LABELS, MOVE_REVIEW_LABELS, moveKindLabel } from "@/lib/moves";
import { getOpenTurn } from "@/lib/turn";
import { getMyZone } from "@/lib/gmZone";
import Workspace from "./Workspace";

// The adjudication workspace's server half: one load, all DTOs, no
// Prisma-shaped object across the boundary. The queue is the OPEN turn's
// Moves — under staged arbitration a resolved turn's Moves are already
// pushed and silently closed, so there is nothing left to do to them —
// plus the newest Requests, which keep their own review lifecycle.

const REQUEST_LIMIT = 300;

// Exactly the Tag columns TagChip and formatTagRequirement read, and nothing
// else — same discipline as the old /gm/turns page and referenceData.js.
const TAG_CHIP_FIELDS = {
  id: true,
  slug: true,
  name: true,
  description: true,
  pointCost: true,
  defaultDurationTurns: true,
  expiresInto: true,
  visibleOnInspect: true,
  requirementTurns: true,
  requirementResources: true,
  requirementGambit: true,
  requirementSkills: { select: { name: true } },
};

function isConfirmed(a) {
  return a.status === "CONFIRMED" || a.status === "ADJUDICATED";
}

// "In Progress" is DERIVED from a live lock rather than stored, so a GM whose
// browser died can never strand a Move in that state — the lock simply lapses.
function statusLabel(a, now) {
  if (!isConfirmed(a)) return MOVE_PIPELINE_LABELS[a.status] ?? a.status;
  if (a.lockExpiresAt && a.lockExpiresAt > now) return "In Progress";
  return MOVE_REVIEW_LABELS[a.moveReviewStatus] ?? "Open";
}

// Raw roll, then the summed modifier (Hunger) and total — a GM
// has to be able to tell a modified 5 from a natural 5.
function rollLabel(a) {
  if (a.diceRoll == null) return "";
  const mod = a.diceModifier ?? 0;
  if (!mod) return `rolled ${a.diceRoll}`;
  return `rolled ${a.diceRoll} (${mod > 0 ? `+${mod}` : mod}) = ${a.diceRoll + mod}`;
}

function turnLabel(turn) {
  if (!turn) return "—";
  return `${turn.number} · ${turn.phase === "DAWN" ? "Dawn" : "Dusk"}`;
}

function truncate(text, limit) {
  const clean = (text ?? "").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

// A one-line "what actually happened", so a GM can triage without opening
// every request. Same table the old page carried.
function summarize(request) {
  const e = request.effect ?? {};
  switch (request.type) {
    case "FULFILL_DESIRE":
      return `+${e.pointsAwarded ?? 0} Tag Points — ${truncate(e.desireText, 60)}`;
    case "ADD_TAG":
      return `+${e.tagName ?? "tag"}${e.resourcesSpent ? ` for ${e.resourcesSpent} ⬢` : ""}`;
    case "BUY_TAGS":
      return `${(e.items ?? []).map((i) => i.tagName).join(", ")} for ${e.totalPoints ?? 0} Tag Points`;
    case "REMOVE_TAG":
      return `-${e.tagName ?? "tag"}${e.resourcesSpent ? ` for ${e.resourcesSpent} ⬢` : ""}`;
    case "TRANSFER_RESOURCES":
      return `${e.amount ?? 0} ⬢: ${e.from?.name ?? "?"} → ${e.to?.name ?? "?"}`;
    case "TRANSFER_TAG":
      return `${e.tagName ?? "tag"} → ${e.toName ?? "?"}`;
    case "CONSUME_TAG":
      return `Used up ${e.tagName ?? "a tag"}${
        (e.granted ?? []).filter((g) => g.added > 0).length
          ? ` → ${e.granted
              .filter((g) => g.added > 0)
              .map((g) => g.tagName)
              .join(", ")}`
          : ""
      }`;
    case "DONATE_BLOOD":
      return `+${e.bloodDelta ?? 0} blood — drained ${e.targetName ?? "?"}${e.tier ? ` (${e.tier})` : ""}`;
    case "FEED_PERSON":
      return `+${e.bloodDelta ?? 0} blood — fed ${e.targetName ?? "?"} to the Lifeweb${
        e.killed ? "" : " · NOT YET KILLED"
      }`;
    case "HEAL_CHARACTER":
      return `Healed ${e.tagName ?? "?"} on ${e.targetName ?? "?"}`;
    case "CHANGE_NAME":
      return `${e.previous?.name ?? "?"} → ${e.next?.name ?? "?"}`;
    default:
      return "";
  }
}

export default async function TurnsWorkspacePage() {
  const openTurn = await getOpenTurn();

  const [actions, requests, stagedEffects, stagedMessages, roster, zones, tagCatalog, members, myZone, gmProfiles] =
    await Promise.all([
      openTurn
        ? prisma.action.findMany({
            where: { turnId: openTurn.id },
            orderBy: { createdAt: "desc" },
            include: {
              character: {
                include: {
                  // faction.zone is the ZONE SEAT this row answers to; `zone`
                  // is where they physically stand (desk location label).
                  faction: { include: { zone: true } },
                  zone: true,
                  location: true,
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
            },
          })
        : [],
      prisma.request.findMany({
        orderBy: { createdAt: "desc" },
        take: REQUEST_LIMIT,
        include: { character: { include: { faction: { include: { zone: true } } } }, turn: true },
      }),
      // Open-turn staging plus every unapplied stray from earlier turns —
      // the strays feed the missed-push banner.
      prisma.stagedEffect.findMany({
        where: openTurn ? { OR: [{ turnId: openTurn.id }, { appliedAt: null }] } : { appliedAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          targetCharacter: { select: { id: true, name: true } },
          turn: { select: { id: true, number: true } },
        },
      }),
      prisma.stagedMessage.findMany({
        where: openTurn ? { OR: [{ turnId: openTurn.id }, { sentAt: null }] } : { sentAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          recipients: { include: { character: { select: { id: true, name: true } } } },
          zone: { select: { id: true, name: true } },
          turn: { select: { id: true, number: true } },
        },
      }),
      // Recipient and mass-apply pickers. Living characters only — a staged
      // message to someone who dies mid-turn keeps its recipient row anyway.
      prisma.character.findMany({
        where: { status: "ALIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, faction: { select: { name: true } } },
      }),
      prisma.zone.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      // The effect composer's search space: the whole catalog, lean.
      prisma.tag.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          stackable: true,
          equippable: true,
          pointCost: true,
          defaultDurationTurns: true,
        },
      }),
      listGuildMembers(),
      getMyZone(),
      getGmProfiles(),
    ]);

  const usernameById = new Map(members.map((m) => [m.id, m.username]));
  const nameFor = (c) => usernameById.get(c.discordUserId) ?? c.discordUserId;
  const now = new Date();
  const gmProfilesById = Object.fromEntries(gmProfiles.map((p) => [p.discordUserId, { username: p.username, avatarUrl: p.avatarUrl }]));

  // One copy of each distinct held tag, for TagChip rendering — bounded by
  // the catalog, not the row count.
  const tagsById = {};
  for (const action of actions) {
    for (const ct of action.character.tags) {
      if (!tagsById[ct.tagId]) tagsById[ct.tagId] = ct.tag;
    }
  }

  const moves = actions.map((a) => ({
    id: a.id,
    characterId: a.characterId,
    characterName: a.character.name,
    discordUsername: nameFor(a.character),
    factionName: a.character.faction?.name ?? "",
    factionId: a.character.factionId ?? null,
    factionZoneName: a.character.faction?.zone?.name ?? "",
    description: a.description,
    kindLabel: moveKindLabel(a.moveKind),
    moveKind: a.moveKind ?? "ROUTINE",
    opposed: a.opposed,
    rollLabel: rollLabel(a),
    statusLabel: statusLabel(a, now),
    locationLabel:
      [a.character.zone?.name, a.character.location?.name].filter(Boolean).join(" / ") || "Unassigned",
    resources: a.character.resources,
    tags: a.character.tags.map((ct) => ({
      tagId: ct.tagId,
      quantity: ct.quantity,
      expiresTurn: ct.expiresTurn,
    })),
    resourceDelta: a.resourceDelta ?? null,
    resourceRollExpression: a.resourceRollExpression ?? null,
    resultMessage: a.resultMessage ?? "",
    reviewedByUsername: a.reviewedByDiscordUserId
      ? (usernameById.get(a.reviewedByDiscordUserId) ?? a.reviewedByDiscordUserId)
      : null,
    reviewedByDiscordUserId: a.reviewedByDiscordUserId ?? null,
    reviewedAtLabel: a.reviewedAt ? a.reviewedAt.toISOString().slice(0, 16).replace("T", " ") : null,
    lockedByDiscordUserId: a.lockExpiresAt && a.lockExpiresAt > now ? (a.lockedByDiscordUserId ?? null) : null,
    createdAtMs: a.createdAt.getTime(),
  }));

  const requestRows = requests.map((r) => ({
    id: r.id,
    characterId: r.characterId,
    characterName: r.character.name,
    discordUsername: nameFor(r.character),
    factionName: r.character.faction?.name ?? "",
    factionId: r.character.factionId ?? null,
    factionZoneName: r.character.faction?.zone?.name ?? "",
    turnLabel: turnLabel(r.turn),
    type: r.type,
    typeLabel: REQUEST_TYPE_LABELS[r.type] ?? r.type,
    statusLabel: REQUEST_STATUS_LABELS[r.status] ?? r.status,
    reason: r.reason,
    summary: summarize(r),
    effect: r.effect ?? {},
    gmNotes: r.gmNotes ?? "",
    createdAtMs: r.createdAt.getTime(),
    reviewedByUsername: r.reviewedByDiscordUserId
      ? (usernameById.get(r.reviewedByDiscordUserId) ?? r.reviewedByDiscordUserId)
      : null,
    reviewedByDiscordUserId: r.reviewedByDiscordUserId ?? null,
    reviewedAtLabel: r.reviewedAt ? r.reviewedAt.toISOString().slice(0, 16).replace("T", " ") : null,
  }));

  const effects = stagedEffects.map((e) => ({
    id: e.id,
    moveId: e.moveId,
    batchId: e.batchId,
    targetCharacterId: e.targetCharacterId,
    targetName: e.targetCharacter?.name ?? "(deleted)",
    resources: e.payload?.resources ?? 0,
    tagPoints: e.payload?.tagPoints ?? 0,
    tagOps: e.payload?.tagOps ?? [],
    applied: Boolean(e.appliedAt),
    appliedError: e.appliedEffect?.error ?? null,
    createdByUsername: usernameById.get(e.createdByDiscordUserId) ?? e.createdByDiscordUserId,
    createdByDiscordUserId: e.createdByDiscordUserId ?? null,
    turnNumber: e.turn?.number ?? null,
    missed: openTurn ? e.turnId !== openTurn.id && !e.appliedAt : !e.appliedAt,
  }));

  const messages = stagedMessages.map((m) => ({
    id: m.id,
    moveId: m.moveId,
    kind: m.kind,
    content: m.content,
    zoneId: m.zoneId,
    zoneName: m.zone?.name ?? null,
    recipients: m.recipients.map((r) => ({ characterId: r.character.id, name: r.character.name })),
    sent: Boolean(m.sentAt),
    deliveryFailures: m.deliveryFailures ?? null,
    createdByUsername: usernameById.get(m.createdByDiscordUserId) ?? m.createdByDiscordUserId,
    createdByDiscordUserId: m.createdByDiscordUserId ?? null,
    turnNumber: m.turn?.number ?? null,
    missed: openTurn ? m.turnId !== openTurn.id && !m.sentAt : !m.sentAt,
  }));

  return (
    <Workspace
      openTurn={openTurn ? { id: openTurn.id, number: openTurn.number, phase: openTurn.phase } : null}
      myZoneName={myZone?.name ?? null}
      tagsById={tagsById}
      tagCatalog={tagCatalog}
      roster={roster.map((c) => ({ id: c.id, name: c.name, factionName: c.faction?.name ?? "" }))}
      zones={zones}
      moves={moves}
      requests={requestRows}
      stagedEffects={effects}
      stagedMessages={messages}
      gmProfiles={gmProfilesById}
    />
  );
}
