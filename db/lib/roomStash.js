// A Room's stash — the ⬢ and tag stacks lying in it (docs/systemdocs/CARRY.md).
// Pure helpers plus the one lookup the overflow drop needs. Takes `prisma`
// (or a tx) as a parameter, same reason as db/lib/dm.js, and stays off the
// @lifeweb/db barrel; require it by path.

// findMany + a JS pick rather than ORDER BY random(): Prisma would need raw
// SQL for that, and a Location has a handful of rooms at most. Every PUBLIC
// room is a valid destination, provisioned or not — an unprovisioned one
// simply gets no announcement.
// A room that eats what is put into it (Room.destroysContents — the Godard
// Factory's Spillway) is NEVER eligible. The overflow drop is not a choice
// anybody made: a refining shift makes 160 lb of Squeeze against a 120 lb cap,
// so the carry pass fires on the intended loop, every day, and a one-in-three
// roll would delete a day's work nobody threw away. Tipping something into the
// trough has to stay a thing you do on purpose (docs/systemdocs/FACTORY.md §9).
async function pickRandomPublicRoom(db, locationId) {
  if (!locationId) return null;
  const rooms = await db.room.findMany({
    where: { locationId, kind: "PUBLIC", destroysContents: false },
    select: { id: true, name: true, discordThreadId: true, locationId: true },
  });
  if (rooms.length === 0) return null;
  return rooms[Math.floor(Math.random() * rooms.length)];
}

// "Graga Sac ×3" / "Lantern".
function formatStack(name, quantity) {
  return (quantity ?? 1) > 1 ? `${name} ×${quantity}` : name;
}

// "a, b and c" — no Oxford comma, matching the whisper poll's joiner.
function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The goods in a transfer or a drop as one phrase: "Graga Sac ×3, Lantern
// and 12 ⬢". `tags` is [{ tagName | name, quantity }].
function formatManifest(tags = [], resources = 0) {
  const parts = tags.map((t) => formatStack(t.tagName ?? t.name, t.quantity));
  if (resources > 0) parts.push(`${resources} ⬢`);
  return joinList(parts);
}

// The Storage button's reply, in Bascinet's own format. `room` carries
// `resources` and `tags: [{ quantity, tag: { name } }]`.
function formatStashLine(room) {
  const tags = (room.tags ?? []).filter((rt) => rt.quantity > 0);
  if (tags.length === 0 && !(room.resources > 0)) return "-# Nothing is stored here. ‡";
  const names = tags.map((rt) => formatStack(rt.tag.name, rt.quantity)).join(", ");
  return `-# ${room.resources ?? 0} ⬢ | **Tags**: ${names || "none ‡"}`;
}

module.exports = { pickRandomPublicRoom, formatStack, joinList, formatManifest, formatStashLine };
