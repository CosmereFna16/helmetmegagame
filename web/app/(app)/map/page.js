import { redirect } from "next/navigation";
import { prisma, isTravelFree, DEPTHS_SLUGS } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import MapPanel from "./MapPanel";

// The whole point of resolving tiers here rather than in the client component
// is that the same isTravelFree the server action will consult on submit is
// the one that colours the node — so the map can never offer a free hop that
// then spends someone's Move, or grey out somewhere they could actually walk.
function tierFor({ location, current, adjacent, hasActed }) {
  if (!current) return { tier: "noroad", note: "You aren't anywhere yet." };
  if (location.id === current.id) return { tier: "here", note: "You are standing here." };
  if (!adjacent) return { tier: "noroad", note: "No road from here." };

  const free = isTravelFree({
    fromSlug: current.slug,
    fromZoneId: current.zoneId,
    toSlug: location.slug,
    toZoneId: location.zoneId,
  });
  if (free) return { tier: "free", note: "A short walk. Costs you nothing." };
  if (hasActed) return { tier: "spent", note: "Spends your Move — and you've already acted this turn." };
  return { tier: "cost", note: "Spends your Move for the turn." };
}

export default async function MapPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true, zoneId: true },
  });

  const [locations, openTurn] = await Promise.all([
    prisma.location.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        mapX: true,
        mapY: true,
        zoneId: true,
        zone: { select: { name: true } },
        connectsTo: { select: { id: true } },
      },
    }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } }),
  ]);

  // A Move already filed this turn blocks a zone change, and vice versa (see
  // performTravel and the Move modal). Knowing it up here is what lets a
  // costing hop render as already-spent rather than failing on confirm.
  const hasActed =
    !!character &&
    !!openTurn &&
    !!(await prisma.action.findFirst({
      where: { characterId: character.id, turnId: openTurn.id },
      select: { id: true },
    }));

  const current = character?.locationId
    ? locations.find((l) => l.id === character.locationId) ?? null
    : null;
  const neighbourIds = new Set((current?.connectsTo ?? []).map((n) => n.id));

  const nodes = locations.map((location) => ({
    id: location.id,
    slug: location.slug,
    name: location.name,
    description: location.description,
    zoneName: location.zone?.name ?? null,
    x: location.mapX,
    y: location.mapY,
    deep: DEPTHS_SLUGS.has(location.slug),
    ...tierFor({ location, current, adjacent: neighbourIds.has(location.id), hasActed }),
  }));

  // One entry per undirected pair. connectsTo is symmetric, so keeping only
  // the half where the first id sorts lower drops the duplicate.
  const roads = [];
  for (const location of locations) {
    for (const other of location.connectsTo) {
      if (location.id >= other.id) continue;
      const target = locations.find((l) => l.id === other.id);
      if (!target) continue;
      roads.push({
        a: location.id,
        b: other.id,
        // Anything touching a level of the Depths is drawn dashed, as a
        // tunnel running under the surface. The Gatehouse stair down to the
        // Caverns genuinely does pass beneath the town band, and no
        // arrangement of the nodes avoids that — the Cathedral and the
        // Sanctuary both bridge the Forest and the Square.
        tunnel: DEPTHS_SLUGS.has(location.slug) || DEPTHS_SLUGS.has(target.slug),
      });
    }
  }

  return (
    <PageShell width="wide">
      <PageHeader
        title="Map"
      />
      <MapPanel
        nodes={nodes}
        roads={roads}
        currentId={current?.id ?? null}
        hasCharacter={!!character}
        turnOpen={!!openTurn}
      />
    </PageShell>
  );
}
