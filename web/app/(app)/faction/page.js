import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import {
  createFaction,
  setFactionLeader,
  addCharacterToFaction,
  removeCharacterFromFaction,
} from "./actions";

async function loadFaction(factionId) {
  return prisma.faction.findUnique({
    where: { id: factionId },
    include: {
      characters: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, status: true, isLeader: true },
      },
    },
  });
}

function FactionOverview({ factions }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Factions</h1>
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Members</th>
              <th>Leader</th>
              <th>Silo ⬢</th>
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
                  <td>{f.silo}</td>
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
    const faction = await loadFaction(myCharacter.factionId);
    if (!faction) return null;
    const leader = faction.characters.find((c) => c.isLeader);

    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{faction.name}</h1>

        <section className="panel p-4">
          <ul className="flex flex-col gap-1 text-sm">
            <li>Leader: {leader?.name ?? "None"}</li>
            <li>Faction Silo ⬢: {faction.silo}</li>
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
              </tr>
            </thead>
            <tbody>
              {faction.characters.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    {c.isLeader ? " (Leader)" : ""}
                  </td>
                  <td>{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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
          <li>Faction Silo ⬢: {faction.silo}</li>
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
            </tr>
          </thead>
          <tbody>
            {faction.characters.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  {c.isLeader ? " (Leader)" : ""}
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
                    <form action={removeCharacterFromFaction}>
                      <input type="hidden" name="characterId" value={c.id} />
                      <button type="submit" className="btn-quiet">
                        Remove
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {faction.characters.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center" style={{ color: "var(--muted)" }}>
                  No members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

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
