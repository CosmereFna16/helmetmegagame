// Crates: what a shipment actually looks like when the shuttle sets it down.
//
// The goods do not arrive as a tidy pile of tags. They arrive packed, in a
// random number of crates, and somebody has to open them. That does three
// things at once — it makes unloading a job worth paying a Docker for, it puts
// a delay between "I bought a pistol" and "I am holding a pistol", and it
// means a crate left on the landing pad is a crate anyone who gets in there
// can crack.
//
// A crate is a TAG, created at runtime with custom: true. That sounds heavier
// than it is: db/lib/pruneTags.js already skips custom rows, so db:prune-tags
// will not eat them, and being a tag means crates get carry weight, transfers,
// room stashes and theft for free rather than needing a parallel inventory.
// The cost is one Tag row per crate, swept once the last instance is gone.
//
// The manifest is printed on the crate, in the format Bascinet specified:
//
//   [SHIPMENT ID RV-4471-K]: Coal x 4 | Bandage x 6 | ML-23
//
// ...unless something in it ships sealed, in which case the whole crate reads
//
//   [SHIPMENT ID RV-4471-K]: SEALED
//
// and only a Depot Keycard opens it. One sealed line item seals the crate it
// lands in, which means nobody knows WHICH crate the dangerous thing is in —
// only that one of them is heavier news than the others.

const { DEPOT_KEYCARD_SLUG } = require("./depotState");

// Moderate. You can carry a couple; clearing a real shipment is several trips
// or several people. See docs/systemdocs/CARRY.md for the ladder this sits on.
// A crate weighs HALF what is in it. It used to be a flat 15 lb, which made a
// crate of obols heavier than the obols and a crate of armor lighter than one
// piece of it. Halving is what packaging is FOR — it is the same rule the
// player-facing Package button applies (docs/systemdocs/FACTORY.md), so a
// Depot shipment and a Banneret's wagon load obey one arithmetic.
//
// Rounded UP, and never below 1: an empty-ish crate of weightless things is
// still a wooden box.
function crateWeight(contents, weightByTagId) {
  const inner = (contents ?? []).reduce(
    (sum, line) => sum + (weightByTagId?.get?.(line.tagId) ?? 0) * (line.quantity ?? 1),
    0,
  );
  return Math.max(1, Math.ceil(inner / 2));
}

// How many units of goods go in one crate, before the random split. Small
// enough that a big order arrives as a genuine pallet of work.
const CRATE_MIN_UNITS = 3;
const CRATE_MAX_UNITS = 8;

// A shipment never becomes more crates than this, however large the order —
// otherwise a Merchant with 200 obols could bury the landing pad in tag rows.
const MAX_CRATES = 12;

const SHIPMENT_LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ";

// Something that reads like a real waybill number rather than a cuid. Two
// letters for the run, four digits, a check letter. Collisions do not matter
// mechanically — the crate's slug carries a uniquifier — so this is purely
// for the look of the thing on the crate.
function shipmentId(rng = Math.random) {
  const digits = String(Math.floor(rng() * 9000) + 1000);
  const check = SHIPMENT_LETTERS[Math.floor(rng() * SHIPMENT_LETTERS.length)];
  return `RV-${digits}-${check}`;
}

// Fisher-Yates on a copy. In its own function because getting this subtly
// wrong biases every shipment in the game and nobody would ever notice.
function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Manifest line items -> crates.
//
// `items` are `{ tagId, name, quantity, sealed }`. Every unit is expanded and
// shuffled, so a crate holds a random handful rather than one tidy line item,
// and a crate holding any sealed unit becomes a sealed crate.
//
// Returns `[{ sealed, contents: [{ tagId, name, quantity }] }]`. Total units
// out always equals total units in — the split loses nothing, which matters
// because the Merchant has already paid for all of it.
function splitIntoCrates(items = [], rng = Math.random) {
  const units = [];
  for (const item of items) {
    const n = Math.max(0, Math.floor(item?.quantity ?? 0));
    for (let i = 0; i < n; i++) {
      units.push({ tagId: item.tagId, name: item.name, sealed: Boolean(item.sealed) });
    }
  }
  if (!units.length) return [];

  const shuffled = shuffle(units, rng);

  // Aim for a crate size in the band, but never exceed MAX_CRATES — a huge
  // order just means fuller crates.
  const perCrate = Math.max(
    CRATE_MIN_UNITS,
    Math.ceil(shuffled.length / MAX_CRATES),
  );

  const crates = [];
  let i = 0;
  while (i < shuffled.length) {
    const remaining = shuffled.length - i;
    const span = Math.min(
      remaining,
      perCrate + Math.floor(rng() * Math.max(1, CRATE_MAX_UNITS - perCrate + 1)),
    );
    const slice = shuffled.slice(i, i + span);
    i += span;

    // Re-aggregate the units back into countable line items, preserving the
    // order they came out of the shuffle so the printed manifest looks packed
    // rather than sorted.
    const byTag = new Map();
    for (const unit of slice) {
      const row = byTag.get(unit.tagId);
      if (row) row.quantity += 1;
      else byTag.set(unit.tagId, { tagId: unit.tagId, name: unit.name, quantity: 1 });
    }

    crates.push({
      sealed: slice.some((u) => u.sealed),
      contents: [...byTag.values()],
    });
  }

  return crates;
}

// The line printed on the crate. Bascinet's format exactly: a bare name for a
// single, "Name x N" for more than one, pipe-separated.
function crateDescription(shipment, crate) {
  if (crate?.sealed) return `[SHIPMENT ID ${shipment}]: SEALED`;
  const parts = (crate?.contents ?? []).map((c) =>
    c.quantity > 1 ? `${c.name} x ${c.quantity}` : c.name,
  );
  return `[SHIPMENT ID ${shipment}]: ${parts.join(" | ")}`;
}

// Who may open this crate. A sealed one needs the keycard; an open one needs
// nothing, because its manifest is printed on the side and there is no lock to
// pick. Takes the held slugs as a Set, the shape roomAccess.js already builds.
function canOpenCrate(crateTag, heldSlugs) {
  if (!crateTag?.sealedShipping) return true;
  return Boolean(heldSlugs?.has?.(DEPOT_KEYCARD_SLUG));
}

// A crate's tag slug. Server-generated with the "custom-" prefix every
// runtime tag uses (see the Tag.custom comment in schema.prisma), so it can
// never collide with a docs/tags.yaml slug and get upserted over by a sync.
function crateSlug(shipment, index) {
  return `custom-crate-${shipment.toLowerCase()}-${index + 1}`;
}

function crateName(shipment, index) {
  return `Crate ${shipment}·${index + 1}`;
}

// The Tag rows for one shipment. `contents` is stashed on the tag itself so
// opening it needs no shipment lookup — the crate is self-describing, which is
// also what lets one be carried off, traded, and opened somewhere else
// entirely. groupId is the caller's, since db/lib/ must not read the catalog.
function crateTagData(shipment, crates, { groupId = null, weightByTagId = new Map() } = {}) {
  return crates.map((crate, index) => ({
    slug: crateSlug(shipment, index),
    name: crateName(shipment, index),
    description: crateDescription(shipment, crate),
    custom: true,
    // Game state, not catalog — a Restart Game sweeps it up. See TAGS.md §5d.
    ephemeral: true,
    category: "items",
    groupId,
    pointCost: 0,
    tradeable: true,
    stackable: false,
    weightLbs: crateWeight(crate.contents, weightByTagId),
    removable: true,
    sealedShipping: crate.sealed,
    // What falls out when it is opened. Read by the crate-open action; nothing
    // else looks at it.
    crateContents: crate.contents,
  }));
}

module.exports = {
  shipmentId,
  splitIntoCrates,
  crateTagData,
  crateWeight,
  canOpenCrate,
};
