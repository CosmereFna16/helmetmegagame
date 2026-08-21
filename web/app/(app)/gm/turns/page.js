import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { REQUEST_TYPE_LABELS, REQUEST_STATUS_LABELS } from "@/lib/requests";
import AdjudicateTabs from "./AdjudicateTabs";

const HISTORY_LIMIT = 500;
const DESCRIPTION_LIMIT = 100;

// Player-side submission states, before a Move reaches the GM at all.
const PIPELINE_LABELS = {
  PENDING_TYPE: "Setting up Move",
  PENDING_OPPOSED: "Picking Opposed",
  PENDING: "Pending confirm",
};

const REVIEW_LABELS = {
  OPEN: "Open",
  WAITING_FOR_OPPONENTS: "Waiting for Opponents",
  IN_PROGRESS: "In Progress",
  SOLVED: "Solved",
};

function isConfirmed(a) {
  return a.status === "CONFIRMED" || a.status === "ADJUDICATED";
}

function statusLabel(a) {
  return isConfirmed(a) ? (REVIEW_LABELS[a.moveReviewStatus] ?? "Open") : (PIPELINE_LABELS[a.status] ?? a.status);
}

function kindLabel(a) {
  if (a.moveKind === "GAMBIT") return "Gambit";
  if (a.moveKind === "ROUTINE") return "Routine";
  return "Move";
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

export default async function TurnsPage({ searchParams }) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const { tab } = (await searchParams) ?? {};

  const [actions, requests, members] = await Promise.all([
    prisma.action.findMany({
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      include: { character: { include: { faction: true } }, turn: true },
    }),
    prisma.request.findMany({
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      include: { character: { include: { faction: true } }, turn: true },
    }),
    listGuildMembers(),
  ]);

  const usernameById = new Map(members.map((m) => [m.id, m.username]));
  const nameFor = (c) => usernameById.get(c.discordUserId) ?? c.discordUserId;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Adjudicate</h1>
      <AdjudicateTabs
        initialTab={tab}
        moves={actions.map((a) => ({
          id: a.id,
          characterId: a.characterId,
          characterName: a.character.name,
          discordUsername: nameFor(a.character),
          factionName: a.character.faction?.name ?? "",
          turnNumber: a.turn?.number ?? null,
          turnLabel: turnLabel(a.turn),
          description: truncate(a.description, DESCRIPTION_LIMIT),
          kindLabel: kindLabel(a),
          opposed: a.opposed,
          rollLabel: rollLabel(a),
          statusLabel: statusLabel(a),
          gmNotes: a.gmNotes ?? "",
        }))}
        requests={requests.map((r) => ({
          id: r.id,
          characterId: r.characterId,
          characterName: r.character.name,
          discordUsername: nameFor(r.character),
          factionName: r.character.faction?.name ?? "",
          turnNumber: r.turn?.number ?? null,
          turnLabel: turnLabel(r.turn),
          type: r.type,
          typeLabel: REQUEST_TYPE_LABELS[r.type] ?? r.type,
          statusLabel: REQUEST_STATUS_LABELS[r.status] ?? r.status,
          reason: r.reason,
          summary: summarize(r),
          effect: r.effect ?? {},
          gmNotes: r.gmNotes ?? "",
          createdAtMs: r.createdAt.getTime(),
        }))}
      />
    </div>
  );
}
