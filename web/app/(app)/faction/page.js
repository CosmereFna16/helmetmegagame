import { redirect } from "next/navigation";
import { prisma, TREASURER_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyFactionRole } from "@/lib/factionPermissions";
import {
  createFaction,
  setFactionLeader,
  setTreasurer,
  transferFromSilo,
  addCharacterToFaction,
  removeCharacterFromFaction,
} from "./actions";

async function loadFaction(factionId) {
  return prisma.faction.findUnique({
    where: { id: factionId },
    include: {
      characters: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          status: true,
          isLeader: true,
          tags: { where: { tag: { slug: TREASURER_SLUG } }, select: { id: true } },
        },
      },
    },
  });
}

async function loadSiloHistory(factionId) {
  return prisma.siloTransaction.findMany({
    where: { factionId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

function FactionTable({ factions, showSilo }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Leader</th>
            {showSilo && <th>Silo ⬢</th>}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {factions.map((f) => {
            const leader = f.characters.find((c) => c.isLeader);
            return (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{f.characters.length}</td>
                <td>{leader?.name ?? "-"}</td>
                {showSilo && <td>{f.silo}</td>}
                <td>
                  <a href={`/faction?factionId=${f.id}`} className="menu-item">
                    View
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FactionOverview({ factions }) {
  const unaffiliated = factions.filter((f) => f.name === "Unaffiliated");
  const rest = factions.filter((f) => f.name !== "Unaffiliated");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Factions</h1>
      <FactionTable factions={rest} showSilo />

      {unaffiliated.length > 0 && (
        <div>
          <h2 className="mb-2 font-bold">Unaffiliated</h2>
          <FactionTable factions={unaffiliated} showSilo={false} />
        </div>
      )}

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Create Faction</h2>
        <form action={createFaction} className="flex gap-2">
          <input name="name" placeholder="Faction name" required className="text-input" />
          <button type="submit" className="btn">
            Create
          </button>
        </form>
      </section>
    </div>
  );
}

function SiloHistoryPanel({ history }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 font-bold">Silo History</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Turn</th>
            <th>Amount</th>
            <th>By</th>
            <th>To</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {history.map((t) => (
            <tr key={t.id}>
              <td className="whitespace-nowrap">
                {t.turnNumber != null ? `#${t.turnNumber} (${t.turnPhase})` : "-"}
              </td>
              <td>{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
              <td>{t.actorName}</td>
              <td>{t.toName ?? "-"}</td>
              <td className="max-w-xs truncate">{t.note ?? ""}</td>
            </tr>
          ))}
          {history.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center" style={{ color: "var(--muted)" }}>
                No Silo activity yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function TransferFromSiloPanel({ faction, members }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-2 font-bold">Transfer from Silo</h2>
      <form action={transferFromSilo} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="factionId" value={faction.id} />
        <label className="field">
          <span className="field-label">To</span>
          <select name="toCharacterId" required defaultValue="">
            <option value="" disabled>
              Choose a member...
            </option>
            {members.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Amount</span>
          <input type="number" name="amount" min="1" max={faction.silo} required className="text-input" style={{ width: "6rem" }} />
        </label>
        <label className="field">
          <span className="field-label">Note</span>
          <input type="text" name="note" placeholder="optional" className="text-input" />
        </label>
        <button type="submit" className="btn">
          Transfer
        </button>
      </form>
    </section>
  );
}

export default async function FactionPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const [{ isGm: gm }, myCharacter, allFactions] = await Promise.all([
    getGmSession(),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      select: { id: true, factionId: true, resources: true },
    }),
    prisma.faction.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const params = await searchParams;
  const requestedFactionId = params?.factionId?.toString() || "";

  if (!gm) {
    if (!myCharacter?.factionId) {
      return (
        <div className="mx-auto max-w-2xl p-6 sm:p-8">
          <p style={{ color: "var(--muted)" }}>You aren&apos;t assigned to a faction yet.</p>
        </div>
      );
    }
    const [faction, { isLeader, isTreasurer, canManageSilo }] = await Promise.all([
      loadFaction(myCharacter.factionId),
      getMyFactionRole(session.discordUserId, myCharacter.factionId),
    ]);
    if (!faction) return null;
    const leader = faction.characters.find((c) => c.isLeader);
    const playerViewIsUnaffiliated = faction.name === "Unaffiliated";
    const siloHistory = canManageSilo && !playerViewIsUnaffiliated ? await loadSiloHistory(faction.id) : [];

    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{faction.name}</h1>

        <section className="panel p-4">
          <ul className="flex flex-col gap-1 text-sm">
            <li>Leader: {leader?.name ?? "None"}</li>
            {!playerViewIsUnaffiliated && <li>Faction Silo ⬢: {faction.silo}</li>}
            <li>Your Resources ⬢: {myCharacter.resources}</li>
          </ul>
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-bold">Members ({faction.characters.length})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Fate</th>
                {isLeader && !playerViewIsUnaffiliated && <th></th>}
              </tr>
            </thead>
            <tbody>
              {faction.characters.map((c) => {
                const treasurer = c.tags.length > 0;
                return (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      {c.isLeader ? " (Leader)" : ""}
                      {treasurer ? " (Treasurer)" : ""}
                    </td>
                    <td>{c.status}</td>
                    {isLeader && !playerViewIsUnaffiliated && (
                      <td>
                        <form action={setTreasurer}>
                          <input type="hidden" name="characterId" value={c.id} />
                          <input type="hidden" name="factionId" value={faction.id} />
                          <input type="hidden" name="grant" value={(!treasurer).toString()} />
                          <button type="submit" className="btn-quiet">
                            {treasurer ? "Revoke Treasurer" : "Assign Treasurer"}
                          </button>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {canManageSilo && !playerViewIsUnaffiliated && (
          <>
            <TransferFromSiloPanel
              faction={faction}
              members={faction.characters.filter((c) => c.status === "ALIVE")}
            />
            <SiloHistoryPanel history={siloHistory} />
          </>
        )}
      </div>
    );
  }

  // GM mode
  if (!requestedFactionId) {
    const factions = await prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: { characters: { select: { id: true, name: true, isLeader: true } } },
    });
    return <FactionOverview factions={factions} />;
  }

  const [faction, unassignedCharacters] = await Promise.all([
    loadFaction(requestedFactionId),
    prisma.character.findMany({
      where: { status: "ALIVE", factionId: { not: requestedFactionId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!faction) redirect("/faction");

  const isUnaffiliated = faction.name === "Unaffiliated";
  const siloHistory = !isUnaffiliated ? await loadSiloHistory(faction.id) : [];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <a href="/faction" className="btn-quiet">
        &larr; All Factions
      </a>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{faction.name}</h1>
        <form method="get" className="flex gap-2">
          <select name="factionId" defaultValue={faction.id}>
            {allFactions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            View
          </button>
        </form>
      </div>

      <section className="panel p-4">
        <ul className="flex flex-col gap-1 text-sm">
          <li>Leader: {faction.characters.find((c) => c.isLeader)?.name ?? "None"}</li>
          {!isUnaffiliated && <li>Faction Silo ⬢: {faction.silo}</li>}
        </ul>
      </section>

      <section className="panel p-4">
        <h2 className="mb-3 font-bold">Members ({faction.characters.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Fate</th>
              <th></th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {faction.characters.map((c) => {
              const treasurer = c.tags.length > 0;
              return (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    {c.isLeader ? " (Leader)" : ""}
                    {treasurer ? " (Treasurer)" : ""}
                  </td>
                  <td>{c.status}</td>
                  <td>
                    {!isUnaffiliated && !c.isLeader && (
                      <form action={setFactionLeader}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <input type="hidden" name="factionId" value={faction.id} />
                        <button type="submit" className="btn-quiet">
                          Make leader
                        </button>
                      </form>
                    )}
                  </td>
                  <td>
                    {!isUnaffiliated && (
                      <form action={setTreasurer}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <input type="hidden" name="factionId" value={faction.id} />
                        <input type="hidden" name="grant" value={(!treasurer).toString()} />
                        <button type="submit" className="btn-quiet">
                          {treasurer ? "Revoke Treasurer" : "Assign Treasurer"}
                        </button>
                      </form>
                    )}
                  </td>
                  <td>
                    {!isUnaffiliated && (
                      <form action={removeCharacterFromFaction}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <button type="submit" className="btn-quiet">
                          Remove
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {faction.characters.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center" style={{ color: "var(--muted)" }}>
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {!isUnaffiliated && (
        <>
          <TransferFromSiloPanel
            faction={faction}
            members={faction.characters.filter((c) => c.status === "ALIVE")}
          />
          <SiloHistoryPanel history={siloHistory} />
        </>
      )}

      <section className="panel p-4">
        <h2 className="mb-2 font-bold">Add Member</h2>
        <form action={addCharacterToFaction} className="flex gap-2">
          <input type="hidden" name="factionId" value={faction.id} />
          <select name="characterId" required defaultValue="">
            <option value="" disabled>
              Choose a character...
            </option>
            {unassignedCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn">
            Add
          </button>
        </form>
      </section>
    </div>
  );
}
