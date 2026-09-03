import SubmitButton from "@/app/components/SubmitButton";
import Select from "@/app/components/Select";
import ZoneChip from "@/app/components/ZoneChip";
import EmptyState, { EmptyRow } from "@/app/components/EmptyState";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import { redirect } from "next/navigation";
import Link from "next/link";
import FactionLink from "@/app/components/FactionLink";
import CharacterLink from "@/app/components/CharacterLink";
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyFactionRole } from "@/lib/factionPermissions";
import {
  setFactionLeader,
  setTreasurer,
  addCharacterToFaction,
  removeCharacterFromFaction,
} from "./actions";
import PageShell, { PageHeader } from "@/app/components/PageShell";

const MEMBER_COL_COUNT = 7;

async function loadFaction(factionId) {
  return prisma.faction.findUnique({
    where: { id: factionId },
    include: {
      parentFaction: { select: { id: true, name: true } },
      zone: { select: { name: true } },
      characters: {
        orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
        select: {
          id: true,
          name: true,
          status: true,
          isLeader: true,
          isTreasurer: true,
          roleTitle: true,
          // Only ever rendered behind the officer gate (viewCanSeeResources
          // below, or the GM branch) — a plain member never sees the column.
          resources: true,
          // Just the AFK marker, not the sheet: rows only when the member
          // holds the catatonic tag, so `tags.length > 0` is the whole read.
          tags: {
            where: { tag: { slug: CATATONIC_SLUG } },
            select: { id: true },
          },
        },
      },
    },
  });
}

// Breadth-first over parentFactionId so the GM overview's indentation covers
// the whole subtree, not just direct children — the hierarchy is one level
// deep today but this holds up if that changes.
async function getDescendantFactions(rootId) {
  const result = [];
  const seen = new Set([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.faction.findMany({
      where: { parentFactionId: { in: frontier } },
      orderBy: { name: "asc" },
      // `name` is load-bearing: FactionTable renders the leader for every
      // subject faction, and without it `leader?.name ?? "-"` always fell
      // through to the dash — the Leader column has never shown anyone.
      include: { characters: { select: { id: true, name: true, isLeader: true } } },
    });
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      frontier.push(child.id);
    }
  }
  return result;
}

// isGm defaults to false because this table renders on the player branch
// too, and CharacterLink targets /gm/dev/characters/… — a member name must
// stay plain text for a player.
function FactionTable({ factions, isGm = false }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Leader</th>
          </tr>
        </thead>
        <tbody>
          {factions.map((f) => {
            const leader = f.characters.find((c) => c.isLeader);
            return (
              <tr key={f.id}>
                {/* The name IS the link — the old trailing "View" column
                    pointed at exactly this href. */}
                <td>
                  <FactionLink factionId={f.id} name={f.name} />
                </td>
                <td>{f.characters.length}</td>
                <td>
                  <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm={isGm} />
                </td>
              </tr>
            );
          })}
          {factions.length === 0 && <EmptyRow cols={3}>None.</EmptyRow>}
        </tbody>
      </table>
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
      select: { id: true, factionId: true, resources: true, zoneId: true },
    }),
    prisma.faction.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const params = await searchParams;
  const requestedFactionId = params?.factionId?.toString() || "";

  if (!gm) {
    if (!myCharacter?.factionId) {
      return (
        <PageShell width="narrow">
          <EmptyState>You aren&apos;t assigned to a faction yet.</EmptyState>
        </PageShell>
      );
    }

    const ownRole = await getMyFactionRole(session.discordUserId, myCharacter.factionId);

    const faction = await loadFaction(myCharacter.factionId);
    if (!faction) return null;

    // Unaffiliated is the DB's placeholder home for characters with no real
    // faction — players should experience it identically to having none at
    // all: no title, no member roster.
    if (faction.name === "Unaffiliated") {
      return (
        <PageShell width="narrow">
          <EmptyState>You aren&apos;t assigned to a faction yet.</EmptyState>
        </PageShell>
      );
    }

    const leader = faction.characters.find((c) => c.isLeader);

    // A faction's Leader or Treasurer is who sees what each member carries —
    // isOfficer covers both.
    const canSeeResources = ownRole.isOfficer;

    const canManageMembers = ownRole.isLeader;

    return (
      <PageShell width="narrow">
        <PageHeader
          title={faction.name}
          subtitle={<ZoneChip zoneName={faction.zone?.name ?? ""} />}
        />

        <section className="panel p-4">
          <ul className="flex flex-col gap-1 text-sm">
            <li>
              Leader: <CharacterLink characterId={leader?.id} name={leader?.name ?? "None"} isGm={gm} />
            </li>
            <li>Your Resources: {myCharacter.resources} ⬢</li>
          </ul>
        </section>

        <section className="panel overflow-x-auto p-4">
          <h2 className="panel-header">Members ({faction.characters.length})</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                {/* Role is same-faction knowledge — this whole roster is
                    already scoped to your faction, so it renders
                    unconditionally, unlike Resources below. */}
                <th>Role</th>
                {/* Leader/Treasurer are exactly who may see what each member
                    is holding. */}
                {canSeeResources && <th>Resources</th>}
                {canManageMembers && <th></th>}
              </tr>
            </thead>
            <tbody>
              {/* Death is deliberately not surfaced on the player roster.
                  A dead member reads as a normal row here — no Fate pill, no
                  "Deceased" chip — so someone finding out is a matter of the
                  fiction (a DEATH archive entry, an in-character message)
                  rather than a broadcast every faction member reads on
                  login. GMs still see the Fate column on the GM branch
                  below, and the corpse's owner already knows.

                  Catatonic is the deliberate exception: it's a visible tag
                  whose whole purpose is telling the rest of the faction this
                  player is AFK, so the chip renders for everyone. */}
              {faction.characters.map((c) => {
                const treasurer = c.isTreasurer;
                return (
                  <tr key={c.id}>
                    <td>
                      <CharacterLink characterId={c.id} name={c.name} isGm={gm} />
                      {c.isLeader ? " (Leader)" : ""}
                      {treasurer ? " (Treasurer)" : ""}
                      {c.tags.length > 0 && (
                        <span className="chip text-xs text-muted ml-2">Catatonic</span>
                      )}
                    </td>
                    <td>{c.roleTitle ?? "—"}</td>
                    {canSeeResources && <td>{c.resources} ⬢</td>}
                    {canManageMembers && (
                      <td>
                        <form action={setTreasurer}>
                          <input type="hidden" name="characterId" value={c.id} />
                          <input type="hidden" name="factionId" value={faction.id} />
                          <input type="hidden" name="grant" value={(!treasurer).toString()} />
                          <SubmitButton className="btn-quiet">
                            {treasurer ? "Revoke Treasurer" : "Assign Treasurer"}
                          </SubmitButton>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </PageShell>
    );
  }

  // GM mode. The all-factions overview is the Factions tab of the Players
  // panel now — one table, one place. Only the per-faction detail view below
  // still lives here, and it is what a faction name links to for either role.
  if (!requestedFactionId) redirect("/gm/players?tab=factions");

  const [faction, unassignedCharacters] = await Promise.all([
    loadFaction(requestedFactionId),
    prisma.character.findMany({
      where: { status: "ALIVE", factionId: { not: requestedFactionId } },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: { id: true, name: true },
    }),
  ]);
  if (!faction) redirect("/gm/players?tab=factions");

  const isUnaffiliated = faction.name === "Unaffiliated";
  const subjectFactions = await getDescendantFactions(faction.id);

  return (
    <PageShell width="narrow">
      <Link href="/gm/players?tab=factions" className="btn-quiet">
        &larr; All Factions
      </Link>

      <PageHeader
        title={faction.name}
        subtitle={
          <span className="flex items-center gap-2">
            <ZoneChip zoneName={faction.zone?.name ?? ""} />
            {faction.parentFaction ? <span>Subject of {faction.parentFaction.name}</span> : null}
          </span>
        }
        actions={
          <form method="get" className="flex items-end gap-2">
            {/* Wrapped in .field: a bare select falls back to unstyled native
                browser chrome and visibly breaks the theme. */}
            <label className="field">
              <span className="field-label">Faction</span>
              <Select name="factionId" defaultValue={faction.id} style={{ maxWidth: "100%" }}>
                {allFactions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </label>
            <button type="submit" className="btn">
              View
            </button>
          </form>
        }
      />

      <section className="panel p-4">
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            Leader:{" "}
            <CharacterLink
              characterId={faction.characters.find((c) => c.isLeader)?.id}
              name={faction.characters.find((c) => c.isLeader)?.name ?? "None"}
              isGm
            />
          </li>
        </ul>
      </section>

      <section className="panel overflow-x-auto p-4">
        <h2 className="panel-header">Members ({faction.characters.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Fate</th>
              <th>Role</th>
              <th>Resources</th>
              <th></th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {faction.characters.map((c) => {
              const treasurer = c.isTreasurer;
              return (
                <tr key={c.id}>
                  <td>
                    <CharacterLink characterId={c.id} name={c.name} isGm />
                    {c.isLeader ? " (Leader)" : ""}
                    {treasurer ? " (Treasurer)" : ""}
                    {c.tags.length > 0 && (
                      <span className="chip text-xs text-muted ml-2">Catatonic</span>
                    )}
                  </td>
                  <td>
                      <EnumPill map={CHARACTER_STATUS} value={c.status} />
                    </td>
                  <td>{c.roleTitle ?? "—"}</td>
                  <td>{c.resources} ⬢</td>
                  <td>
                    {!isUnaffiliated && !c.isLeader && (
                      <form action={setFactionLeader}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <input type="hidden" name="factionId" value={faction.id} />
                        <SubmitButton className="btn-quiet">
                          Make Leader
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                  <td>
                    {!isUnaffiliated && (
                      <form action={setTreasurer}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <input type="hidden" name="factionId" value={faction.id} />
                        <input type="hidden" name="grant" value={(!treasurer).toString()} />
                        <SubmitButton className="btn-quiet">
                          {treasurer ? "Revoke Treasurer" : "Assign Treasurer"}
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                  <td>
                    {!isUnaffiliated && (
                      <form action={removeCharacterFromFaction}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <SubmitButton className="btn-quiet">
                          Remove
                        </SubmitButton>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {faction.characters.length === 0 && (
              <EmptyRow cols={MEMBER_COL_COUNT}>No members yet.</EmptyRow>
            )}
          </tbody>
        </table>
      </section>

      {subjectFactions.length > 0 && (
        <div>
          <h2 className="panel-header">Subject Factions</h2>
          <FactionTable factions={subjectFactions} isGm />
        </div>
      )}

      <section className="panel p-4">
        <h2 className="panel-header">Add Member</h2>
        <form action={addCharacterToFaction} className="flex gap-2">
          <input type="hidden" name="factionId" value={faction.id} />
          <Select name="characterId" required defaultValue="" className="min-w-0">
            <option value="" disabled>
              Choose a character…
            </option>
            {unassignedCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <SubmitButton>Add</SubmitButton>
        </form>
      </section>
    </PageShell>
  );
}
