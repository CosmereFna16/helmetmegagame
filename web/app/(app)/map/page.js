import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import MapPanel from "./MapPanel";

// Tiers are resolved here rather than in the client component so the map can
// never offer a hop performTravel would then refuse: the same adjacency graph
// and the same already-acted check decide the colour of a region and the
// answer on submit.
//
// Four tiers, since the zone rework: `here`, `cost` (a legal hop that spends
// the Move — every hop does now), `spent` (a legal hop the character can't
// afford because they already acted this turn, greyed out up front rather
// than failing after the confirm), and `noroad`. There is no `free` tier any
// more; the one free arrival is a first placement, which is the `unplaced`
// case below and reads as `cost` with its own note.
function tierFor({ zone, hasCharacter, unplaced, currentId, adjacent, hasActed }) {
  if (!hasCharacter) return { tier: "noroad", note: "You have no living character." };
  if (unplaced) return { tier: "cost", note: "Your first arrival — it costs you nothing." };
  if (zone.id === currentId) return { tier: "here", note: "You are standing here." };
  if (!adjacent) return { tier: "noroad", note: "No road from here." };
  if (hasActed) return { tier: "spent", note: "Spends your Move — and you've already acted this turn." };
  return { tier: "cost", note: "Spends your Move for the turn." };
}

// mapPolygon is Json, so it arrives as whatever the sync wrote. Anything that
// isn't a list of two-number pairs draws nothing rather than throwing a NaN
// point list into the SVG.
function readPolygon(value) {
  if (!Array.isArray(value)) return null;
  const points = value.filter(
    (p) => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number",
  );
  return points.length >= 3 ? points.map(([x, y]) => [x, y]) : null;
}

export default async function MapPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, zoneId: true },
  });

  const [zones, openTurn] = await Promise.all([
    prisma.zone.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        kind: true,
        description: true,
        mapPolygon: true,
        mapLabelX: true,
        mapLabelY: true,
        connectsTo: { select: { id: true } },
      },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } }),
  ]);

  // A Move already filed this turn blocks a zone change, and vice versa (see
  // performTravel and the Move modal). Knowing it up here is what lets a hop
  // render as already-spent rather than failing on confirm.
  const hasActed =
    !!character &&
    !!openTurn &&
    !!(await prisma.action.findFirst({
      where: { characterId: character.id, turnId: openTurn.id },
      select: { id: true },
    }));

  // Only presence zones are standable and travelable. The CAVE_GROUP row is
  // a container: no polygon, just a label sitting over its levels.
  const presence = zones.filter((z) => z.kind !== "CAVE_GROUP");
  const current = character?.zoneId
    ? presence.find((z) => z.id === character.zoneId) ?? null
    : null;
  const unplaced = !!character && !current;
  const neighbourIds = new Set((current?.connectsTo ?? []).map((n) => n.id));

  const regions = presence.map((zone) => ({
    id: zone.id,
    slug: zone.slug,
    name: zone.name,
    description: zone.description,
    polygon: readPolygon(zone.mapPolygon),
    labelX: zone.mapLabelX,
    labelY: zone.mapLabelY,
    ...tierFor({
      zone,
      hasCharacter: !!character,
      unplaced,
      currentId: current?.id ?? null,
      adjacent: neighbourIds.has(zone.id),
      hasActed,
    }),
  }));

  // Group rows draw no region but still name their part of the plate.
  const groupLabels = zones
    .filter((z) => z.kind === "CAVE_GROUP" && typeof z.mapLabelX === "number")
    .map((z) => ({ id: z.id, name: z.name, labelX: z.mapLabelX, labelY: z.mapLabelY }));

  return (
    <PageShell width="wide">
      <PageHeader title="Map" />
      <MapPanel
        regions={regions}
        groupLabels={groupLabels}
        currentId={current?.id ?? null}
        hasCharacter={!!character}
        unplaced={unplaced}
        turnOpen={!!openTurn}
      />
    </PageShell>
  );
}
