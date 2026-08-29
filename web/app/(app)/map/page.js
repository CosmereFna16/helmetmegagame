import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import MapPanel from "./MapPanel";

// Tiers are resolved here rather than in the client component so the map can
// never offer a hop performTravel would then refuse: the same adjacency graph
// and the same already-acted check decide the colour of a node and the
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

// Best-first, so one node standing for several zones (the Caves) can report
// the most useful thing any of them offers.
const TIER_RANK = { here: 0, cost: 1, spent: 2, noroad: 3 };
const better = (a, b) => (TIER_RANK[b.tier] < TIER_RANK[a.tier] ? b : a);

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
  // a container: it is a node on the plate, but never a destination.
  const presence = zones.filter((z) => z.kind !== "CAVE_GROUP");
  const current = character?.zoneId
    ? presence.find((z) => z.id === character.zoneId) ?? null
    : null;
  const unplaced = !!character && !current;
  const neighbourIds = new Set((current?.connectsTo ?? []).map((n) => n.id));

  const tiers = new Map(
    presence.map((zone) => [
      zone.id,
      tierFor({
        zone,
        hasCharacter: !!character,
        unplaced,
        currentId: current?.id ?? null,
        adjacent: neighbourIds.has(zone.id),
        hasActed,
      }),
    ]),
  );

  // What the destination list beneath the plate enumerates: every presence
  // zone, the three cave levels among them individually.
  const regions = presence.map((zone) => ({
    id: zone.id,
    slug: zone.slug,
    name: zone.name,
    description: zone.description,
    ...tiers.get(zone.id),
  }));

  // --- The nodes drawn on the plate -------------------------------------
  //
  // Four, not six: the three surface zones stand for themselves, and the
  // whole cave system is one node — the CAVE_GROUP row — because a player
  // reads "the Caves" as one place on the drawing. Which level you actually
  // want is picked from the depth strip under the plate.
  //
  // A node's anchor is the zone's map label point (`map.label` in
  // docs/zones.yaml → Zone.mapLabelX/Y): percentages of the plate, origin
  // top-left. The polygons that field used to caption are dormant data now.
  const group = zones.find((z) => z.kind === "CAVE_GROUP") ?? null;
  const caveLevels = presence.filter((z) => z.kind === "CAVE_LEVEL");
  const placed = (z) => typeof z.mapLabelX === "number" && typeof z.mapLabelY === "number";

  const nodes = presence.filter((z) => z.kind !== "CAVE_LEVEL" && placed(z)).map((zone) => ({
    id: zone.id,
    name: zone.name,
    x: zone.mapLabelX,
    y: zone.mapLabelY,
    zoneIds: [zone.id],
    levels: null,
    ...tiers.get(zone.id),
  }));

  if (group && placed(group) && caveLevels.length > 0) {
    const levels = caveLevels.map((zone) => ({
      id: zone.id,
      name: zone.name,
      ...tiers.get(zone.id),
    }));
    // The node wears the best of its three levels: from the Town only the
    // Caverns are adjacent, from the Fortress or the Windlands only the
    // Railroad — either way the node reads as reachable, and the strip says
    // which level that means.
    const best = levels.reduce(better);
    nodes.push({
      id: group.id,
      name: group.name,
      x: group.mapLabelX,
      y: group.mapLabelY,
      zoneIds: caveLevels.map((z) => z.id),
      levels,
      tier: best.tier,
      note: best.tier === "here" ? "You are down here." : `${best.name} — ${best.note}`,
    });
  }

  // One line per connected pair of NODES, folded down from the zone graph:
  // town–caverns, fortress–railroad and windlands–railroad all land on the
  // Caves node, and the links inside the cave system (caverns–railroad,
  // railroad–aberrant-pits) fold away entirely. A pair with no link at all
  // gets no line — which is why the Fortress and the Windlands are not
  // joined.
  //
  // A line is solid when the character is standing at one of its ends, and
  // that is resolved per level: connectsTo is symmetric, so an underlying
  // pair touching the current zone IS a hop the character could take.
  const nodeOf = new Map();
  for (const node of nodes) for (const zoneId of node.zoneIds) nodeOf.set(zoneId, node.id);

  const edges = new Map();
  for (const zone of presence) {
    const a = nodeOf.get(zone.id);
    if (!a) continue;
    for (const other of zone.connectsTo) {
      const b = nodeOf.get(other.id);
      if (!b || a === b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const adjacent = !!current && (zone.id === current.id || other.id === current.id);
      const prev = edges.get(key);
      if (prev) prev.adjacent = prev.adjacent || adjacent;
      else edges.set(key, { a: a < b ? a : b, b: a < b ? b : a, adjacent });
    }
  }

  return (
    <PageShell width="wide">
      <PageHeader title="Map" />
      <MapPanel
        regions={regions}
        nodes={nodes}
        edges={[...edges.values()]}
        currentId={current?.id ?? null}
        hasCharacter={!!character}
        unplaced={unplaced}
        turnOpen={!!openTurn}
      />
    </PageShell>
  );
}
