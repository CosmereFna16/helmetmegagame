import { redirect } from "next/navigation";
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/requests";
import { CAVING_KIND_LABELS } from "@/lib/cavingLabels";
import { getOpenTurn } from "@/lib/turn";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { getMyZones } from "@/lib/gmZone";
import { TAG_CHIP_FIELDS } from "@/lib/referenceData";
import { deployVersion } from "@/lib/deployVersion";
import {
  MOVE_INCLUDE,
  STAGED_EFFECT_INCLUDE,
  STAGED_MESSAGE_INCLUDE,
  moveRow,
  stagedEffectRow,
  stagedMessageRow,
  tagsByIdFor,
} from "@/lib/moveRows";
import Workspace from "../Workspace";

// The adjudication workspace's server half: one load, all DTOs, no
// Prisma-shaped object across the boundary. The queue is the OPEN turn's
// Moves — under staged arbitration a resolved turn's Moves are already
// pushed, so nothing here can still be done to them — plus the newest
// Requests, which keep their own review lifecycle. A past turn is readable
// through the History lens, but it fetches itself (actions.js#getMoveHistory);
// all this file ships for it is the picker's list of resolved turns.

const REQUEST_LIMIT = 300;

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
    case "BURY_CHARACTER":
      return `Buried ${e.targetName ?? "?"} — curse lifted`;
    case "FAST_TRAVEL":
      return `Rode ${e.fromZoneName ?? "?"} → ${e.toZoneName ?? "?"}`;
    case "BIRD_MESSAGE":
      return `${e.delivered ? "Wrote" : "Missed"} ${e.recipientName ?? "?"} in ${e.guessedZoneName ?? "?"}`;
    case "DEPOT_BUY":
      return `Bought ${e.tagName ?? "something"}${(e.quantity ?? 1) > 1 ? ` ×${e.quantity}` : ""} for ${e.total ?? 0} ⬢`;
    case "DEPOT_SELL":
      return `Sold ${e.tagName ?? "something"}${(e.quantity ?? 1) > 1 ? ` ×${e.quantity}` : ""} for ${e.total ?? 0} ⬢`;
    case "DEPOT_CREDIT":
      return `${e.direction === "DRAW" ? "Drew" : "Repaid"} ${e.amount ?? 0} ⬢ — owes ${e.debtAfter ?? 0} ⬢`;
    case "BIND_CHARACTER":
      return `Bound ${e.targetName ?? "?"}`;
    case "FREE_CHARACTER":
      return `Freed ${e.targetName ?? "?"}`;
    case "HARM_CHARACTER": {
      const hurt = e.tagName ? `Inflicted ${e.tagName} on ${e.targetName ?? "?"}` : null;
      const kill = e.lethal ? (e.killed ? "killed" : "NOT YET KILLED") : null;
      return [hurt ?? `Moved to finish ${e.targetName ?? "?"}`, kill].filter(Boolean).join(" · ");
    }
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
//
// `history` is the fourth type: a Move on a RESOLVED turn, opened read-only.
// It never overlaps `move` — the open turn's Move is always `move`, and a
// history URL naming one is redirected below.
function parseSelection(segments) {
  if (!segments || segments.length !== 2) return null;
  const [type, id] = segments;
  if (!["move", "request", "caving", "history"].includes(type)) return null;
  return { type, id };
}

export default async function TurnsWorkspacePage({ params }) {
  const { selection } = await params;
  const parsedSelection = parseSelection(selection);
  // The move cutoff needs both of these, and neither needs the other, so they
  // go out together rather than one after the other. (turnClock is a db/lib
  // module and Workspace is a client component, so the derivation stays
  // server-side here and only the two numbers cross the boundary. The header
  // ticks against cutoffAtMs itself.) The big batch below still waits on
  // openTurn — it filters by turn id.
  const [openTurn, gameConfig] = await Promise.all([
    getOpenTurn(),
    prisma.gameConfig.findFirst({ select: { autoTurnAdvanceDisabled: true } }),
  ]);
  const window_ = openTurn
    ? moveWindow(openTurn, { autoTurnAdvanceDisabled: Boolean(gameConfig?.autoTurnAdvanceDisabled) })
    : null;

  const [
    actions,
    requests,
    cavingRolls,
    stagedEffects,
    stagedMessages,
    roster,
    presenceZones,
    tagCatalog,
    members,
    myZones,
    gmProfiles,
    factions,
    resolvedTurns,
    catatonicTagRows,
  ] = await Promise.all([
    openTurn
      ? prisma.action.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          include: MOVE_INCLUDE,
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
              select: {
                id: true,
                name: true,
                discordUserId: true,
                updatedAt: true,
                roleTitle: true,
                faction: { include: { zone: true } },
              },
            },
            zone: { select: { name: true } },
            lootTag: { select: { name: true } },
            // A FIND's loot is undoable from the Caving desk as well as the
            // Requests lens — both routes call the one CAVING_LOOT handler,
            // so the desk needs the request's id and its current status.
            lootRequest: { select: { id: true, status: true } },
          },
        })
      : [],
    // Open-turn staging plus every unapplied stray from earlier turns —
    // the strays feed the missed-push banner.
    prisma.stagedEffect.findMany({
      where: openTurn ? { OR: [{ turnId: openTurn.id }, { appliedAt: null }] } : { appliedAt: null },
      orderBy: { createdAt: "asc" },
      include: STAGED_EFFECT_INCLUDE,
    }),
    prisma.stagedMessage.findMany({
      where: openTurn ? { OR: [{ turnId: openTurn.id }, { sentAt: null }] } : { sentAt: null },
      orderBy: { createdAt: "asc" },
      include: STAGED_MESSAGE_INCLUDE,
    }),
    // Recipient and mass-apply pickers. Living characters only — a staged
    // message to someone who dies mid-turn keeps its recipient row anyway.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        roleTitle: true,
        discordUserId: true,
        faction: { select: { name: true } },
        zone: { select: { name: true } },
      },
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
    // The History lens's turn picker. Just the labels — a resolved turn's
    // Moves are fetched on demand by getMoveHistory when a GM actually
    // opens the lens, so the open turn's desk never pays for history it
    // isn't looking at (and neither does the 45s router.refresh()).
    // The transfer composer's Silo picker. Unaffiliated has no Silo worth
    // moving ⬢ into or out of — same exclusion db/lib/parties.js#resolveParty
    // applies.
    prisma.faction.findMany({
      where: { name: { not: "Unaffiliated" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, silo: true },
    }),
    prisma.turn.findMany({
      where: { status: "RESOLVED" },
      orderBy: { number: "desc" },
      select: { id: true, number: true, phase: true },
    }),
    // Who's AFK right now, for the queue rows' avatar badge — one indexed
    // read rather than a tags include bolted onto the request and caving
    // queries above. (Moves don't need it: MOVE_INCLUDE already carries the
    // held tags, and moveRow reads the slug straight off them.)
    prisma.characterTag.findMany({
      where: { tag: { slug: CATATONIC_SLUG }, character: { status: "ALIVE" } },
      select: { characterId: true },
    }),
  ]);

  const usernameById = new Map(members.map((m) => [m.id, m.username]));
  const nameFor = (c) => usernameById.get(c.discordUserId) ?? c.discordUserId;
  const now = new Date();
  const gmProfilesById = Object.fromEntries(gmProfiles.map((p) => [p.discordUserId, { username: p.username, avatarUrl: p.avatarUrl }]));

  const catatonicIds = new Set(catatonicTagRows.map((row) => row.characterId));

  const tagsById = tagsByIdFor(actions);
  const moves = actions.map((a) => moveRow(a, { usernameById, now }));

  const requestRows = requests.map((r) => ({
    id: r.id,
    characterId: r.characterId,
    characterName: r.character.name,
    avatarVersion: r.character.updatedAt.getTime(),
    catatonic: catatonicIds.has(r.characterId),
    discordUserId: r.character.discordUserId,
    discordUsername: nameFor(r.character),
    roleTitle: r.character.roleTitle ?? "",
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
    catatonic: catatonicIds.has(c.characterId),
    discordUsername: nameFor(c.character),
    roleTitle: c.character.roleTitle ?? "",
    factionZoneName: c.character.faction?.zone?.name ?? c.zone?.name ?? "",
    die: c.die,
    kind: c.kind,
    kindLabel: CAVING_KIND_LABELS[c.kind] ?? c.kind,
    lootTier: c.lootTier ?? null,
    lootTagName: c.lootTag?.name ?? null,
    lootRequestId: c.lootRequest?.id ?? null,
    lootRequestStatus: c.lootRequest?.status ?? null,
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

  const effectCtx = { usernameById, presenceZoneNameById, openTurn };
  const messageCtx = { usernameById, openTurn };
  const effects = stagedEffects.map((e) => stagedEffectRow(e, effectCtx));
  const messages = stagedMessages.map((m) => stagedMessageRow(m, messageCtx));

  // A /gm/turns/history/<id> deep link, so one GM can send another the exact
  // past Move and have it open on arrival. The lens fetches the rest of that
  // turn on its own; this is only the one row the URL names. A row that turns
  // out to be on the OPEN turn isn't history at all — it is still live work,
  // so the URL corrects itself to /gm/turns/move/<id>.
  let initialHistory = null;
  if (parsedSelection?.type === "history") {
    const past = await prisma.action.findUnique({
      where: { id: parsedSelection.id },
      include: MOVE_INCLUDE,
    });
    if (past && openTurn && past.turnId === openTurn.id) redirect(`/gm/turns/move/${past.id}`);
    if (past) {
      const [pastEffects, pastMessages] = await Promise.all([
        prisma.stagedEffect.findMany({
          where: { moveId: past.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_EFFECT_INCLUDE,
        }),
        prisma.stagedMessage.findMany({
          where: { moveId: past.id },
          orderBy: { createdAt: "asc" },
          include: STAGED_MESSAGE_INCLUDE,
        }),
      ]);
      initialHistory = {
        turnId: past.turnId,
        move: moveRow(past, { usernameById, now }),
        effects: pastEffects.map((e) => stagedEffectRow(e, effectCtx)),
        messages: pastMessages.map((m) => stagedMessageRow(m, messageCtx)),
        tagsById: tagsByIdFor([past]),
      };
    }
  }

  // `label` is built by the same turnLabel() the resolved turns are, so the
  // History lens can list the open turn in its Turn dropdown alongside them
  // with no second formatting rule to keep in sync (Workspace.js only appends
  // the "· open" suffix).
  const openTurnDto = openTurn
    ? { id: openTurn.id, number: openTurn.number, phase: openTurn.phase, label: turnLabel(openTurn) }
    : null;

  return (
    <Workspace
      initialSelection={parsedSelection}
      initialHistory={initialHistory}
      resolvedTurns={resolvedTurns.map((t) => ({ id: t.id, number: t.number, label: turnLabel(t) }))}
      openTurn={openTurnDto}
      myZoneNames={myZones.map((z) => z.name)}
      tagsById={tagsById}
      tagCatalog={tagCatalog}
      roster={roster.map((c) => ({
        id: c.id,
        name: c.name,
        factionName: c.faction?.name ?? "",
        roleTitle: c.roleTitle ?? "",
        zoneName: c.zone?.name ?? "",
        discordUserId: c.discordUserId,
        username: usernameById.get(c.discordUserId) ?? "",
      }))}
      presenceZones={presenceZones}
      factions={factions}
      moves={moves}
      requests={requestRows}
      cavingRolls={cavingRows}
      stagedEffects={effects}
      stagedMessages={messages}
      gmProfiles={gmProfilesById}
      moveLock={
        window_?.hasLock
          ? { cutoffAtMs: window_.cutoffAt.getTime(), endsAtMs: window_.endsAt.getTime() }
          : null
      }
      deployVersion={deployVersion()}
    />
  );
}
