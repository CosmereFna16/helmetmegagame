import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import DevSubNav from "../DevSubNav";
import CharactersTable from "./CharactersTable";

export default async function DevCharactersPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const characters = await prisma.character.findMany({
    orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
    include: { faction: true, zone: true },
    // Safety net against unbounded growth, not a real limit — far above any
    // realistic roster size for this game (100+ players).
    take: 1000,
  });

  // Flat DTO for the client table — no Date objects across the boundary, so
  // updatedAt travels as the epoch CharacterAvatar's `version` prop wants.
  const rows = characters.map((c) => ({
    id: c.id,
    name: c.name,
    avatarVersion: c.updatedAt.getTime(),
    factionId: c.factionId,
    factionName: c.faction?.name ?? "-",
    zoneName: c.zone?.name ?? "-",
    status: c.status,
    resources: c.resources,
  }));

  return (
    <PageShell>
      <PageHeader title={`Characters (${characters.length})`} actions={<DevSubNav current="characters" />} />

      <CharactersTable rows={rows} />
    </PageShell>
  );
}
