import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma, CATATONIC_SLUG } from "@lifeweb/db";
import { roomAccessKeys, accessibleRooms } from "@lifeweb/db/lib/roomAccess";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyFactionRole } from "@/lib/factionPermissions";
import { isUnaffiliated } from "@lifeweb/db/lib/factionConstants";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import Select from "@/app/components/Select";
import SubmitButton from "@/app/components/SubmitButton";
import ZoneChip from "@/app/components/ZoneChip";
import EmptyState, { EmptyRow } from "@/app/components/EmptyState";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import FactionLink from "@/app/components/FactionLink";
import CharacterLink from "@/app/components/CharacterLink";
import FactionConsole from "@/app/components/FactionConsole";
import {
  setFactionLeader,
  setTreasurer,
  addCharacterToFaction,
  removeCharacterFromFaction,
} from "./actions";

const MEMBER_COL_COUNT = 7;

async function loadFaction(factionId) {
  return prisma.faction.findUnique({
    where: { id: factionId },
    include: {
      parentFaction: { select: { id: true, name: true } },
      subjectFactions: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      zone: { select: { name: true } },
      siloRoom: {
        select: {
          id: true,
          name: true,
          kind: true,
          resources: true,
          accessTagSlugs: true,
          location: { select: { name: true, zoneId: true, zone: { select: { name: true } } } },
          tags: { select: { id: true, quantity: true, tag: { select: { name: true } } } },
        },
      },
      characters: {
        // ALIVE only. A corpse in the roster inflated the member count the
        // directory shows (which always counted the living), so a faction
        // advertised as "4 members" became 9 the moment you joined it — and
        // the dead carried live Remove and Treasurer buttons.
        where: { status: "ALIVE" },
        orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
        select: {
          id: true,
          name: true,
          status: true,
          isLeader: true,
          isTreasurer: true,
          roleTitle: true,
          // Only ever rendered behind the officer gate — a plain member never
          // sees the column.
          resources: true,
          // Just the AFK marker, not the sheet: rows only when the member
          // holds the catatonic tag, so `tags.length > 0` is the whole read.
          tags: { where: { tag: { slug: CATATONIC_SLUG } }, select: { id: true } },
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

// Everything the console needs, shaped for the client. Kept here rather than
// in the component so no prisma row crosses the boundary — the console gets
// plain data and never a model.
async function buildPlayerProps(session, me) {
  const pendingForMe = await prisma.factionApplication.findMany({
    where: { characterId: me.id, status: "PENDING" },
    select: { id: true, kind: true, note: true, factionId: true, faction: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  const myApplications = pendingForMe.map((a) => ({
    id: a.id,
    kind: a.kind,
    note: a.note,
    factionId: a.factionId,
    factionName: a.faction.name,
  }));

  const faction = me.factionId ? await loadFaction(me.factionId) : null;

  // No faction, or the placeholder one: the directory, not the console. The
  // every-faction-with-every-member query lives INSIDE this branch: a player
  // who is in a faction was paying for a full character scan they never saw.
  if (!faction || isUnaffiliated(faction)) {
    const allFactions = await prisma.faction.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        characters: { select: { id: true, name: true, isLeader: true, status: true } },
      },
    });
    return {
      faction: null,
      myApplications,
      directory: allFactions
        .filter((f) => !isUnaffiliated(f))
        .map((f) => ({
          id: f.id,
          name: f.name,
          leaderName: f.characters.find((c) => c.isLeader)?.name ?? null,
          memberCount: f.characters.filter((c) => c.status === "ALIVE").length,
        })),
    };
  }

  const ownRole = await getMyFactionRole(session.discordUserId, faction.id);
  const isOfficer = ownRole.isOfficer;

  // The silo, and the two facts that decide what the tab may say: are you in
  // its zone (deposits), and does its door open for you (everything else).
  let silo = null;
  if (faction.siloRoom) {
    const room = faction.siloRoom;
    const keys = await roomAccessKeys(prisma, me.id);
    const canOpen =
      accessibleRooms(
        [{ id: room.id, kind: room.kind, accessTagSlugs: room.accessTagSlugs }],
        keys.heldSlugs,
        keys.guestRoomIds,
      ).length === 1;
    silo = {
      id: room.id,
      name: room.name,
      locationName: room.location.name,
      zoneName: room.location.zone?.name ?? "",
      inZone: Boolean(me.zoneId) && me.zoneId === room.location.zoneId,
      canOpen,
      // Both withheld when the door is shut. The balance leaked before, so a
      // member without the Cathedral Key could watch the Church's treasury
      // rise and fall directly above a banner promising they could not see
      // inside (FACTIONS.md §4a).
      resources: canOpen ? room.resources : null,
      tags: canOpen
        ? room.tags
            .filter((rt) => rt.quantity > 0)
            .map((rt) => ({ id: rt.id, name: rt.tag.name, quantity: rt.quantity }))
        : [],
    };
  }

  const officerExtras = isOfficer
    ? await (async () => {
        const [rows, candidates, rooms] = await Promise.all([
          prisma.factionApplication.findMany({
            where: { factionId: faction.id, status: "PENDING" },
            select: {
              id: true,
              kind: true,
              note: true,
              characterId: true,
              character: { select: { name: true } },
            },
            orderBy: { createdAt: "asc" },
          }),
          prisma.character.findMany({
            where: { status: "ALIVE", factionId: { not: faction.id } },
            orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
            select: { id: true, name: true, faction: { select: { name: true, slug: true } } },
            take: 500,
          }),
          // Only the faction's own zone. A silo anywhere else could never be
          // deposited into — deposits are zone-scoped — so offering the whole
          // map was offering rooms that could not work. setSiloRoom re-checks.
          prisma.room.findMany({
            where: faction.zoneId ? { location: { zoneId: faction.zoneId } } : undefined,
            orderBy: { name: "asc" },
            select: {
              id: true,
              name: true,
              accessTagSlugs: true,
              location: { select: { name: true, zone: { select: { name: true } } } },
            },
          }),
        ]);
        const shaped = rows.map((a) => ({
          id: a.id,
          kind: a.kind,
          note: a.note,
          characterId: a.characterId,
          characterName: a.character.name,
        }));
        return {
          applications: shaped.filter((a) => a.kind === "APPLICATION"),
          invites: shaped.filter((a) => a.kind === "INVITE"),
          candidates: candidates.map((c) => ({
            id: c.id,
            name: c.name,
            factionName: c.faction && !isUnaffiliated(c.faction) ? c.faction.name : null,
          })),
          rooms: rooms.map((r) => ({
            id: r.id,
            name: r.name,
            locationName: r.location.name,
            zoneName: r.location.zone?.name ?? "",
            locked: r.accessTagSlugs.length > 0,
          })),
        };
      })()
    : { applications: [], invites: [], candidates: [], rooms: [] };

  // The keys to the faction's own silo — the only tags Accept may hand out.
  const siloKeySlugs = faction.siloRoom?.accessTagSlugs ?? [];
  const siloKeys = siloKeySlugs.length
    ? (
        await prisma.tag.findMany({
          where: { slug: { in: siloKeySlugs } },
          select: { slug: true, name: true },
        })
      ).map((t) => ({ slug: t.slug, name: t.name }))
    : [];

  return {
    meId: me.id,
    isOfficer,
    isLeader: ownRole.isLeader,
    silo,
    siloKeys,
    myApplications,
    ...officerExtras,
    faction: {
      id: faction.id,
      name: faction.name,
      siloRoomId: faction.siloRoomId,
      zoneName: faction.zone?.name ?? "",
      parentName: faction.parentFaction?.name ?? null,
      subjectNames: faction.subjectFactions.map((f) => f.name),
      leaderName: faction.characters.find((c) => c.isLeader)?.name ?? null,
      members: faction.characters.map((c) => ({
        id: c.id,
        name: c.name,
        roleTitle: c.roleTitle,
        isLeader: c.isLeader,
        isTreasurer: c.isTreasurer,
        resources: c.resources,
        catatonic: c.tags.length > 0,
      })),
    },
  };
}

export default async function FactionPage({ searchParams }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const [{ isGm: gm }, myCharacter] = await Promise.all([
    getGmSession(),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      select: { id: true, factionId: true, zoneId: true },
    }),
  ]);

  const params = await searchParams;
  const requestedFactionId = params?.factionId?.toString() || "";

  if (!gm) {
    if (!myCharacter) {
      return (
        <PageShell width="narrow">
          <EmptyState>You don&apos;t have a living character. ‡</EmptyState>
        </PageShell>
      );
    }
    const props = await buildPlayerProps(session, myCharacter);
    return (
      <PageShell width="default">
        <PageHeader
          title={props.faction?.name ?? "Factions"}
          subtitle={
            props.faction ? (
              <ZoneChip zoneName={props.faction.zoneName} />
            ) : (
              "You answer to nobody. Ask to join somebody, or start something. ‡"
            )
          }
        />
        <FactionConsole {...props} />
      </PageShell>
    );
  }

  // GM mode. The all-factions overview is the Factions tab of the Players
  // panel now — one table, one place. Only the per-faction detail view below
  // still lives here, and it is what a faction name links to for either role.
  if (!requestedFactionId) redirect("/gm/players?tab=factions");

  // Only the GM branch's picker reads this, so it is fetched only here.
  const allFactions = await prisma.faction.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const [faction, unassignedCharacters] = await Promise.all([
    loadFaction(requestedFactionId),
    prisma.character.findMany({
      where: { status: "ALIVE", factionId: { not: requestedFactionId } },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: { id: true, name: true },
    }),
  ]);
  if (!faction) redirect("/gm/players?tab=factions");

  const unaffiliated = isUnaffiliated(faction);
  const subjectFactions = await getDescendantFactions(faction.id);
  const pending = await prisma.factionApplication.findMany({
    where: { factionId: faction.id, status: "PENDING" },
    select: { id: true, kind: true, note: true, character: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

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
          <li>
            Silo:{" "}
            {faction.siloRoom
              ? `${faction.siloRoom.name} · ${faction.siloRoom.location.name} · ${faction.siloRoom.resources} ⬢`
              : "None"}
          </li>
          <li>Slug: <span className="mono">{faction.slug}</span></li>
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
                    {!unaffiliated && !c.isLeader && (
                      <form action={setFactionLeader}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <input type="hidden" name="factionId" value={faction.id} />
                        <SubmitButton className="btn-quiet">Make Leader</SubmitButton>
                      </form>
                    )}
                  </td>
                  <td>
                    {!unaffiliated && (
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
                    {!unaffiliated && (
                      <form action={removeCharacterFromFaction}>
                        <input type="hidden" name="characterId" value={c.id} />
                        <SubmitButton className="btn-quiet">Remove</SubmitButton>
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

      {/* Read-only on purpose. A GM answering an application for a faction
          would be answering for its officers; the toolkit a GM actually needs
          — move anyone anywhere, set either seat — is the Members table
          above. */}
      <section className="panel overflow-x-auto p-4">
        <h2 className="panel-header">Pending applications ({pending.length})</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Direction</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((a) => (
              <tr key={a.id}>
                <td>
                  <CharacterLink characterId={a.character.id} name={a.character.name} isGm />
                </td>
                <td>{a.kind === "INVITE" ? "Invited by the faction" : "Asked to join"}</td>
                <td className="text-muted">{a.note || "—"}</td>
              </tr>
            ))}
            {pending.length === 0 && <EmptyRow cols={3}>None.</EmptyRow>}
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
