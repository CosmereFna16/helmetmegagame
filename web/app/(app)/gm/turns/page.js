import { redirect } from "next/navigation";
import { prisma, describeMoveEffects } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/requests";
import { MOVE_PIPELINE_LABELS, MOVE_REVIEW_LABELS, moveKindLabel } from "@/lib/moves";
import { getOpenTurn } from "@/lib/turn";
import AdjudicateTabs from "./AdjudicateTabs";
import PageShell, { PageHeader } from "@/app/components/PageShell";

const HISTORY_LIMIT = 500;
const DESCRIPTION_LIMIT = 100;

// Player-side submission states, before a Move reaches the GM at all.
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

function kindLabel(a) {
  return moveKindLabel(a.moveKind);
}

// Raw roll, then the summed modifier (Mood ±1, Hunger -1) and total — a GM
// has to be able to tell a modified 5 from a natural 5.
function rollLabel(a) {
  if (a.diceRoll == null) return "";
  const mod = a.diceModifier ?? 0;
  if (!mod) return `rolled ${a.diceRoll}`;
  return `rolled ${a.diceRoll} (${mod > 0 ? `+${mod}` : mod}) = ${a.diceRoll + mod}`;
}

function truncate(text, limit) {
  const clean = (text ?? "").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function turnLabel(turn) {
  if (!turn) return "—";
  return `${turn.number} · ${turn.phase === "DAWN" ? "Dawn" : "Dusk"}`;
}

// A one-line "what actually happened", so a GM can triage the table without
// opening every panel.
function summarize(request) {
  const e = request.effect ?? {};
  switch (request.type) {
    case "FULFILL_DESIRE":
      return `+${e.pointsAwarded ?? 0} Tag Points — ${truncate(e.desireText, 60)}`;
    case "ADD_TAG":
      return `+${e.tagName ?? "tag"}${e.resourcesSpent ? ` for ${e.resourcesSpent} ⬢` : ""}`;
    case "REMOVE_TAG":
      return `-${e.tagName ?? "tag"}${e.resourcesSpent ? ` for ${e.resourcesSpent} ⬢` : ""}`;
    case "TRANSFER_RESOURCES":
      return `${e.amount ?? 0} ⬢: ${e.from?.name ?? "?"} → ${e.to?.name ?? "?"}`;
    case "TRANSFER_TAG":
      return `${e.tagName ?? "tag"} → ${e.toName ?? "?"}`;
    case "SET_MOOD":
      return `Mood: ${e.mood ?? "NEUTRAL"}`;
    case "CONSUME_TAG":
      return `Used up ${e.tagName ?? "a tag"}${
        (e.granted ?? []).filter((g) => g.added > 0).length
          ? ` → ${e.granted
              .filter((g) => g.added > 0)
              .map((g) => g.tagName)
              .join(", ")}`
          : ""
      }`;
    case "CHANGE_WORST_FEAR":
      return `Worst Fear: ${truncate(e.text, 60)}`;
    case "FULFILL_WORST_FEAR":
      return `\u2212${e.pointsDeducted ?? 0} Tag Points — ${truncate(e.fearText, 60)}`;
    case "DONATE_BLOOD":
      return `+${e.bloodDelta ?? 0} blood — drained ${e.targetName ?? "?"}${e.tier ? ` (${e.tier})` : ""}`;
    case "FEED_PERSON":
      return `+${e.bloodDelta ?? 0} blood — fed ${e.targetName ?? "?"} to the Lifeweb${
        e.killed ? "" : " · NOT YET KILLED"
      }`;
    default:
      return "";
  }
}

// The ⬢ a Request moved, from whichever effect key carries it. Sign is from
// the requesting character's point of view: a cost is negative, a transfer in
// is positive.
function requestResourceDelta(request) {
  const e = request.effect ?? {};
  if (e.resourcesSpent) return -e.resourcesSpent;
  if (request.type === "TRANSFER_RESOURCES" && e.amount) {
    if (e.to?.kind === "character" && e.to.id === request.characterId) return e.amount;
    if (e.from?.kind === "character" && e.from.id === request.characterId) return -e.amount;
  }
  return null;
}

export default async function TurnsPage({ searchParams }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const { tab } = (await searchParams) ?? {};

  const [actions, requests, members, openTurn] = await Promise.all([
    prisma.action.findMany({
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      include: {
        character: {
          include: {
            faction: true,
            zone: true,
            location: true,
            // requirementSkills must be named — see the same include in
            // web/app/(app)/character/page.js for why omitting it fails quietly.
            tags: {
              include: {
                tag: { include: { group: true, requirementSkills: { select: { name: true } } } },
              },
            },
          },
        },
        turn: true,
      },
    }),
    prisma.request.findMany({
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      include: { character: { include: { faction: true } }, turn: true },
    }),
    listGuildMembers(),
    // Only for the tag-expiry countdown in MovePanel: a row's own turn number
    // is the turn it was filed on, which is not what "2 turns left" is
    // measured against. cache()-deduped, so this costs nothing.
    getOpenTurn(),
  ]);

  const usernameById = new Map(members.map((m) => [m.id, m.username]));
  const nameFor = (c) => usernameById.get(c.discordUserId) ?? c.discordUserId;
  const now = new Date();

  return (
    <PageShell width="wide">
      <PageHeader title="Adjudicate" />
      <AdjudicateTabs
        initialTab={tab}
        moves={actions.map((a) => ({
          id: a.id,
          characterId: a.characterId,
          characterName: a.character.name,
          discordUsername: nameFor(a.character),
          factionName: a.character.faction?.name ?? "",
          factionId: a.character.factionId ?? null,
          turnNumber: a.turn?.number ?? null,
          turnLabel: turnLabel(a.turn),
          description: truncate(a.description, DESCRIPTION_LIMIT),
          kindLabel: kindLabel(a),
          moveKind: a.moveKind ?? "ROUTINE",
          opposed: a.opposed,
          rollLabel: rollLabel(a),
          statusLabel: statusLabel(a, now),
          gmNotes: a.gmNotes ?? "",
          // Panel-only fields — the Character section and the resolution form.
          locationLabel: [a.character.zone?.name, a.character.location?.name].filter(Boolean).join(" / ") || "Unassigned",
          resources: a.character.resources,
          tags: a.character.tags.map((ct) => ({
            ...ct.tag,
            quantity: ct.quantity,
            expiresTurn: ct.expiresTurn,
          })),
          currentTurnNumber: openTurn?.number ?? null,
          resourceDelta: a.resourceDelta ?? null,
          resultMessage: a.resultMessage ?? "",
          appliedSummary: describeMoveEffects(a.appliedEffects),
          reviewedByUsername: a.reviewedByDiscordUserId
            ? (usernameById.get(a.reviewedByDiscordUserId) ?? a.reviewedByDiscordUserId)
            : null,
          reviewedAtLabel: a.reviewedAt ? a.reviewedAt.toISOString().slice(0, 16).replace("T", " ") : null,
        }))}
        requests={requests.map((r) => ({
          id: r.id,
          characterId: r.characterId,
          characterName: r.character.name,
          discordUsername: nameFor(r.character),
          factionName: r.character.faction?.name ?? "",
          factionId: r.character.factionId ?? null,
          turnNumber: r.turn?.number ?? null,
          turnLabel: turnLabel(r.turn),
          type: r.type,
          typeLabel: REQUEST_TYPE_LABELS[r.type] ?? r.type,
          statusLabel: REQUEST_STATUS_LABELS[r.status] ?? r.status,
          reason: r.reason,
          summary: summarize(r),
          resourceDelta: requestResourceDelta(r),
          effect: r.effect ?? {},
          gmNotes: r.gmNotes ?? "",
          createdAtMs: r.createdAt.getTime(),
        }))}
      />
    </PageShell>
  );
}
