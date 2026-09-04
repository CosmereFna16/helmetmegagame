import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { isUnaffiliated } from "@lifeweb/db/lib/factionConstants";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import DevSubNav from "../DevSubNav";
import FactionsTable from "./FactionsTable";

export default async function DevFactionsPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const [factions, allRooms, characters, pending] = await Promise.all([
    prisma.faction.findMany({
      orderBy: { name: "asc" },
      include: {
        zone: { select: { name: true } },
        _count: { select: { characters: true } },
      },
    }),
    prisma.room.findMany({
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        accessTagSlugs: true,
        location: { select: { name: true, zone: { select: { name: true } } } },
      },
    }),
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: { id: true, name: true, factionId: true, isLeader: true, isTreasurer: true },
      take: 1000,
    }),
    prisma.factionApplication.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        note: true,
        factionId: true,
        faction: { select: { name: true } },
        character: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Flat DTOs for the client table — flat strings/numbers only.
  const rows = factions.map((f) => ({
    id: f.id,
    name: f.name,
    zoneName: f.zone?.name ?? "",
    parentFactionId: f.parentFactionId,
    siloRoomId: f.siloRoomId,
    memberCount: f._count.characters,
    foundedInPlay: Boolean(f.foundedById),
    deletable: !isUnaffiliated(f),
  }));
  const rooms = allRooms.map((r) => ({
    id: r.id,
    name: r.name,
    locationName: r.location.name,
    zoneName: r.location.zone?.name ?? "",
    locked: r.accessTagSlugs.length > 0,
  }));
  const members = characters.map((c) => ({
    id: c.id,
    name: c.name,
    isLeader: c.isLeader,
    isTreasurer: c.isTreasurer,
  }));
  const applications = pending.map((a) => ({
    id: a.id,
    kind: a.kind,
    note: a.note,
    factionName: a.faction.name,
    characterId: a.character.id,
    characterName: a.character.name,
  }));

  return (
    <PageShell>
      <PageHeader title={`Factions (${factions.length})`} actions={<DevSubNav current="factions" />} />

      <FactionsTable rows={rows} rooms={rooms} members={members} applications={applications} />
    </PageShell>
  );
}
