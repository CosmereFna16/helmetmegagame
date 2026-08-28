import { prisma } from "@lifeweb/db";
import { listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/requests";
import { MOVE_PIPELINE_LABELS, MOVE_REVIEW_LABELS, moveKindLabel, rollLabel } from "@/lib/moves";
import { getOpenTurn } from "@/lib/turn";
import { getMyZones } from "@/lib/gmZone";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";
import Workspace from "../Workspace";

// The adjudication workspace's server half: one load, all DTOs, no
// Prisma-shaped object across the boundary. The queue is the OPEN turn's
// Moves — under staged arbitration a resolved turn's Moves are already
// pushed and silently closed, so there is nothing left to do to them —
// plus the newest Requests, which keep their own review lifecycle.

const REQUEST_LIMIT = 300;

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
    case "CAVING_LOOT":
      return `Found ${e.tagName ?? "something"}`;
    case "LOOT_CHARACTER": {
      const took = [
        ...(e.tags ?? []).map((t) => t.tagName ?? "a tag"),
        ...(e.amount ? [`${e.amount} ⬢`] : []),
      ];
      const what = took.length ? took.join(", ") : "nothing";
      return `Took ${what} off ${e.targetName ?? "?"}${e.targetStatus === "DEAD" ? "'s body" : ""}`;
    }
    case "MOVE_CHARACTER":
      return `${e.targetStatus === "DEAD" ? "Dragged" : "Moved"} ${e.targetName ?? "?"} to ${
        e.toZoneName ?? "?"
      }`;
    case "CREATE_TAG":
      return `Made ${e.tagName ?? "an item"}${e.quantity > 1 ? ` ×${e.quantity}` : ""}`;
    case "BIND_CHARACTER":
      return `Bound ${e.targetName ?? "?"}`;
    case "FREE_CHARACTER":
      return `Freed ${e.targetName ?? "?"}`;
    case "HARM_CHARACTER": {
      const hurt = e.tagName ? `Inflicted ${e.tagName} on ${e.targetName ?? "?"}` : null;
      const kill = e.lethal ? (e.killed ? "killed" : "NOT YET KILLED") : null;
      return [hurt ?? `Moved to finish ${e.targetName ?? "?"}`, kill].filter(Boolean).join(" · ");
    }
    case "DROP_ITEM":
      return `Left ${e.tagName ?? "an item"}${e.quantity > 1 ? ` ×${e.quantity}` : ""} on the ground`;
    case "PICK_UP_ITEM":
      return `Picked up ${e.tagName ?? "an item"}${e.quantity > 1 ? ` ×${e.quantity}` : ""}`;
    default:
      return "";
  }
}

// An optional catch-all rather than a [moveId] child route, for two reasons.
// The desk selects a Move, a Request OR a Caving roll, so the URL has to carry
// both halves of Workspace's { type, id }. And a child route would force this
// file to become a layout, putting the client Workspace above `children` —
// which cannot then hand tagsById/roster/zones/stagedByMove down to a server
// child, so every desk would have to reload its own DTOs and loading.js would
// flash on each queue click.
//
// The route also has to exist, not just be tolerated: Workspace polls
// router.refresh() every 45s against the CURRENT url, so a GM parked on
// /gm/turns/move/abc would 404 on the first poll without it.
function parseSelection(segments) {
  if (!segments || segments.length !== 2) return null;
  const [type, id] = segments;
  if (!["move", "request", "caving"].includes(type)) return null;
  return { type, id };
}

export default async function TurnsWorkspacePage({ params }) {
  const { selection } = await params;
  const openTurn = await getOpenTurn();

  const [actions, requests, cavingRolls, stagedEffects, stagedMessages, roster, presenceZones, tagCatalog, members, myZones, gmProfiles] =
    await Promise.all([
      openTurn
        ? prisma.action.findMany({
            where: { turnId: openTurn.id },
            orderBy: { createdAt: "desc" },
            include: {
              character: {
                include: {
                  // faction.zone is the ZONE SEAT this row answers to — a
                  // faction always banks on a seat zone, never on a cave
                  // level; `zone` is the PRESENCE zone, where they physically
                  // stand, which is what the desk labels.
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
            },
          })
        : [],
      prisma.request.findMany({
        orderBy: { createdAt: "desc" },
        take: REQUEST_LIMIT,
        include: { character: { include: { faction: { include: { zone: true } } } }, turn: true },
      }),
      // The Caving lens — every roll on the open turn. See
      // docs/systemdocs/CAVING.md. No "strays from earlier turns" clause
      // like stagedEffects/stagedMessages below: a CavingRoll is never
      // "unapplied", it just sits resolved or not.
      openTurn
        ? prisma.cavingRoll.findMany({
            where: { turnId: openTurn.id },
            orderBy: { createdAt: "desc" },
            include: {
              character: {
                select: { id: true, name: true, discordUserId: true, updatedAt: true, faction: { include: { zone: true } } },
              },
              zone: { select: { name: true } },
              lootTag: { select: { name: true } },
            },
          })
        : [],
      // Open-turn staging plus every unapplied stray from earlier turns —
      // the strays feed the missed-push banner.
      prisma.stagedEffect.findMany({
        where: openTurn ? { OR: [{ turnId: openTurn.id }, { appliedAt: null }] } : { appliedAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          targetCharacter: { select: { id: true, name: true, updatedAt: true } },
          turn: { select: { id: true, number: true } },
        },
      }),
      prisma.stagedMessage.findMany({
        where: openTurn ? { OR: [{ turnId: openTurn.id }, { sentAt: null }] } : { sentAt: null },
        orderBy: { createdAt: "asc" },
        include: {
          recipients: { include: { character: { select: { id: true, name: true, updatedAt: true } } } },
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
      // Every zone picker on this desk (staged relocation, public-declaration
      // delivery) offers PRESENCE zones only — a character stands in a
      // surface zone or a single cave level, never on the abstract Caves
      // group row (mirrors web/lib/devPanelData.js's zone query).
      prisma.zone.findMany({
        where: { kind: { not: "CAVE_GROUP" } },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      }),
      // The effect composer's search space: the whole catalog. TAG_CHIP_FIELDS
      // is what TagChip/ChipLabel need to render coloured with a working
      // tooltip (group, category, description, …) — this used to be a lean,
      // bespoke select missing all of that, which is why chips here rendered
      // uncoloured with an empty tooltip. See referenceData.js's own comment;
      // this is the second time that regression happened.
      prisma.tag.findMany({
        orderBy: { name: "asc" },
        select: {
          ...TAG_CHIP_FIELDS,
          stackable: true,
          equippable: true,
        },
      }),
      listGuildMembers(),
      getMyZones(),
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
    avatarVersion: a.character.updatedAt.getTime(),
    // The player desk keys on discordUserId, not characterId — carried here
    // so a Move can link straight to that player's conversation.
    discordUserId: a.character.discordUserId,
    discordUsername: nameFor(a.character),
    factionName: a.character.faction?.name ?? "",
    factionId: a.character.factionId ?? null,
    factionZoneName: a.character.faction?.zone?.name ?? "",
    description: a.description,
    kindLabel: moveKindLabel(a.moveKind),
    moveKind: a.moveKind ?? "ROUTINE",
    rollLabel: rollLabel(a),
    statusLabel: statusLabel(a, now),
    // Where they stand. Key name kept because MoveDesk and InspectorColumn
    // still read `locationLabel`; the value is now just the presence zone,
    // since Locations are prose Topics and no longer a place on the sheet.
    locationLabel: a.character.zone?.name || "Unassigned",
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
    avatarVersion: r.character.updatedAt.getTime(),
    discordUserId: r.character.discordUserId,
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

  const cavingRows = cavingRolls.map((c) => ({
    id: c.id,
    characterId: c.characterId,
    characterName: c.character.name,
    avatarVersion: c.character.updatedAt.getTime(),
    discordUsername: nameFor(c.character),
    factionZoneName: c.character.faction?.zone?.name ?? c.zone?.name ?? "",
    die: c.die,
    kind: c.kind,
    lootTier: c.lootTier ?? null,
    lootTagName: c.lootTag?.name ?? null,
    statusLabel: c.resolvedAt ? "Resolved" : "Needs attention",
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    resolvedByUsername: c.resolvedByDiscordUserId
      ? (usernameById.get(c.resolvedByDiscordUserId) ?? c.resolvedByDiscordUserId)
      : null,
    resolvedAtLabel: c.resolvedAt ? c.resolvedAt.toISOString().slice(0, 16).replace("T", " ") : null,
    gmNotes: c.gmNotes ?? "",
    createdAtMs: c.createdAt.getTime(),
  }));

  const presenceZoneNameById = new Map(presenceZones.map((z) => [z.id, z.name]));

  const effects = stagedEffects.map((e) => ({
    id: e.id,
    moveId: e.moveId,
    cavingRollId: e.cavingRollId,
    batchId: e.batchId,
    targetCharacterId: e.targetCharacterId,
    targetName: e.targetCharacter?.name ?? "(deleted)",
    targetAvatarVersion: e.targetCharacter?.updatedAt ? e.targetCharacter.updatedAt.getTime() : null,
    resources: e.payload?.resources ?? 0,
    tagPoints: e.payload?.tagPoints ?? 0,
    tagOps: e.payload?.tagOps ?? [],
    zoneId: e.payload?.zoneId ?? null,
    zoneName: e.payload?.zoneId ? (presenceZoneNameById.get(e.payload.zoneId) ?? "(deleted zone)") : null,
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
  }));

  return (
    <Workspace
      initialSelection={parseSelection(selection)}
      openTurn={openTurn ? { id: openTurn.id, number: openTurn.number, phase: openTurn.phase } : null}
      myZoneNames={myZones.map((z) => z.name)}
      tagsById={tagsById}
      tagCatalog={tagCatalog}
      roster={roster.map((c) => ({ id: c.id, name: c.name, factionName: c.faction?.name ?? "" }))}
      presenceZones={presenceZones}
      moves={moves}
      requests={requestRows}
      cavingRolls={cavingRows}
      stagedEffects={effects}
      stagedMessages={messages}
      gmProfiles={gmProfilesById}
    />
  );
}
