import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import DevSubNav from "../DevSubNav";
import FactionsTable from "./FactionsTable";

export default async function DevFactionsPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  if (!isSuperadmin(session.discordUserId)) redirect("/character");

  const factions = await prisma.faction.findMany({
    orderBy: { name: "asc" },
    include: { zone: { select: { name: true } } },
  });

  // Flat DTO for the client table — flat strings/numbers only.
  const rows = factions.map((f) => ({
    id: f.id,
    name: f.name,
    zoneName: f.zone?.name ?? "",
    parentFactionId: f.parentFactionId,
    deletable: f.name !== "Unaffiliated",
  }));

  return (
    <PageShell>
      <PageHeader title={`Factions (${factions.length})`} actions={<DevSubNav current="factions" />} />

      <FactionsTable rows={rows} />
    </PageShell>
  );
}
