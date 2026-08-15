import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { describeTurn } from "@/lib/turn";
import { adjudicateAction, sendAffectedParties } from "../../actions";
import PartyRows from "./PartyRows";

export default async function ArbitrationPage({ params }) {
  const { actionId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const action = await prisma.action.findUnique({
    where: { id: actionId },
    include: {
      character: { include: { faction: true, zone: true, tags: { include: { tag: true } } } },
      turn: true,
    },
  });
  if (!action) notFound();

  const otherCharacters = await prisma.character.findMany({
    where: { status: "ALIVE", id: { not: action.characterId } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 sm:p-8">
      <Link href="/gm/turns" className="btn-quiet">
        &larr; Back to Turns
      </Link>

      <section className="panel p-4">
        <h1 className="mb-2 text-xl font-bold">
          {action.character.name} — {action.type === "MOVE" ? "Move" : "Effort"}
        </h1>
        <p className="mb-1 text-sm" style={{ color: "var(--muted)" }}>
          {describeTurn(action.turn).label} — {action.character.roleTitle ?? "No role"} —{" "}
          {action.character.faction?.name ?? "No faction"} — {action.character.zone?.name ?? "No zone"}
          {action.diceRoll != null ? ` — rolled ${action.diceRoll}` : ""}
        </p>
        {action.character.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {action.character.tags.map((ct) => (
              <span key={ct.id} className="chip">
                {ct.tag.name}
              </span>
            ))}
          </div>
        )}
        <p className="text-sm">{action.description}</p>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Adjudication</h2>
        {action.status === "PENDING" && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Waiting on the player to confirm in Discord.
          </p>
        )}
        {action.status === "CONFIRMED" && (
          <form action={adjudicateAction} className="flex flex-col gap-4">
            <input type="hidden" name="actionId" value={action.id} />
            <label className="field">
              <span className="field-label">Adjudication message (sent to the player)</span>
              <textarea name="resultMessage" rows={3} />
            </label>
            <label className="field">
              <span className="field-label">GM notes (private — never shown to the player)</span>
              <textarea name="gmNotes" rows={3} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPublic" defaultChecked />
              Also post the adjudication message to summary channels
            </label>

            <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <h3 className="mb-1 font-bold">Message affected parties</h3>
              <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
                Privately contact any other character about this action&apos;s outcome.
              </p>
              <PartyRows characters={otherCharacters} />
            </div>

            <button type="submit" className="btn self-start">
              Adjudicate
            </button>
          </form>
        )}
        {action.status === "ADJUDICATED" && (
          <div className="text-sm">
            <p style={{ color: "var(--muted)" }}>Adjudicated{action.isPublic ? " (public)" : " (private)"}.</p>
            <p className="mt-2">{action.resultMessage || "(no message sent)"}</p>
            {action.gmNotes && (
              <p className="mt-2" style={{ color: "var(--muted)" }}>
                GM notes: {action.gmNotes}
              </p>
            )}
          </div>
        )}
      </section>

      {action.status === "ADJUDICATED" && (
        <section className="panel p-4">
          <h2 className="mb-1 font-bold">Message affected parties</h2>
          <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
            Privately contact any other character about this action&apos;s outcome.
          </p>
          <form action={sendAffectedParties} className="flex flex-col gap-3">
            <PartyRows characters={otherCharacters} />
            <button type="submit" className="btn self-start">
              Send
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
