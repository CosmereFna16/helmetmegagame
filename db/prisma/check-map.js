// Reads docs/locations.yaml and reports anything that will read badly on the
// Map panel's plate: two roads crossing, or a road passing so close to an
// unrelated location that it looks like it connects to it.
//
// No database and no Discord — it's pure geometry over the YAML, so it runs
// anywhere and is the fast loop for retuning `map:` coordinates by hand.
//
//   npm run map:check
//
// Roads that touch a level of the Depths are drawn dashed on the plate, as
// tunnels passing under the surface. Those are allowed to cross and are
// reported separately rather than as failures — the Gatehouse stair down to
// the Caverns has to pass beneath the town band, and no arrangement of
// nodes avoids that: the Cathedral and the Sanctuary both bridge the Forest
// and the Square, so any line from the Fortress to the deep is crossed by
// one of them.
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { DEPTHS_SLUGS } = require("../lib/travelCost");

const YAML_PATH = path.join(__dirname, "..", "..", "docs", "locations.yaml");

// The plate is 4:3, so a percentage of width is not the same distance as a
// percentage of height. Everything below works in plate units.
const W = 1000;
const H = 750;
// A road passing closer than this to an unrelated node reads as touching it.
const CLEARANCE = 26;

const px = (p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H });

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentsCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function main() {
  const doc = yaml.load(fs.readFileSync(YAML_PATH, "utf8"));
  const points = new Map();
  const names = new Map();
  const missing = [];

  for (const entry of doc.locations) {
    names.set(entry.id, entry.name);
    if (!entry.map || typeof entry.map.x !== "number" || typeof entry.map.y !== "number") {
      missing.push(entry.id);
      continue;
    }
    points.set(entry.id, px(entry.map));
  }

  const roads = doc.locationConnections.filter(([a, b]) => points.has(a) && points.has(b));
  const isTunnel = ([a, b]) => DEPTHS_SLUGS.has(a) || DEPTHS_SLUGS.has(b);

  const crossings = [];
  const tunnelCrossings = [];
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const [a, b] = roads[i];
      const [c, d] = roads[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (!segmentsCross(points.get(a), points.get(b), points.get(c), points.get(d))) continue;
      const line = `${a}—${b}  ×  ${c}—${d}`;
      (isTunnel(roads[i]) || isTunnel(roads[j]) ? tunnelCrossings : crossings).push(line);
    }
  }

  const grazes = [];
  for (const [a, b] of roads) {
    for (const [id, p] of points) {
      if (id === a || id === b) continue;
      const gap = distanceToSegment(p, points.get(a), points.get(b));
      if (gap < CLEARANCE) grazes.push(`${a}—${b}  passes ${gap.toFixed(0)}u from ${id}`);
    }
  }

  const overlaps = [];
  const ids = [...points.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const gap = Math.hypot(
        points.get(ids[i]).x - points.get(ids[j]).x,
        points.get(ids[i]).y - points.get(ids[j]).y,
      );
      if (gap < 60) overlaps.push(`${ids[i]} and ${ids[j]} are ${gap.toFixed(0)}u apart`);
    }
  }

  const report = (label, list) => {
    if (list.length === 0) return;
    console.log(`\n${label} (${list.length}):`);
    for (const line of list) console.log(`  ${line}`);
  };

  console.log(`${points.size} placed, ${roads.length} roads.`);
  report("Missing map coordinates", missing);
  report("Crossing roads", crossings);
  report("Nodes too close together", overlaps);
  report("Roads grazing an unconnected location", grazes);
  report("Tunnel crossings (drawn dashed, passing under — allowed)", tunnelCrossings);

  const failed = missing.length + crossings.length + overlaps.length + grazes.length;
  if (failed === 0) console.log("\nClean.");
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
