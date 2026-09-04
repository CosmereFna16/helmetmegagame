// The Depot singleton's live state: the account, the generator, the shuttle.
//
// Every mover here does its clamp inside ONE locked statement rather than a
// read-modify-write, exactly the way db/lib/lifeweb.js#bumpBlood does, and for
// the same reason: two people spending out of the same account at the same
// moment must not be able to stomp each other, and the returned `delta` has to
// be what the statement actually moved rather than what the caller asked for.
// Undo reads that delta off Request.effect (REQUESTS.md §2), so an order that
// only half-cleared must report half.
//
// Takes `tx` as a parameter rather than requiring db/index.js back, the same
// convention as db/lib/dm.js — requiring the barrel from inside db/lib/
// resolves to a partial exports object.

// The tag that opens the landing pad and cracks a sealed crate. Held by the
// Merchant and by every Docker; it is NOT what the turret reads, which is the
// trap the whole gun is built around (see depotTurret.js).
const DEPOT_KEYCARD_SLUG = "depot-keycard";

// The two things the generator will burn, best first. Fed to it from the
// Station tab; the amount each is worth is a Dev Panel tunable.
const COAL_SLUG = "coal";
const SALTPETER_SLUG = "saltpeter";

// The currency.
const OBOL_SLUG = "obol";

// The room the shuttle lands in. A PRIVATE thread gated on the keycard, so
// membership is handled entirely by db/lib/roomAccess.js and the channel
// doctor — there is no bespoke access code anywhere in this feature.
const LANDING_PAD_SLUG = "landing-pad";

// Nothing at the Depot works with the generator off: no ordering, no shuttle,
// no ATM, no turret. One predicate so the web actions, the turn passes and the
// Examine line cannot drift on what "off" means. Fuel at zero is off even if
// the switch says otherwise, which is the state a burn pass leaves behind.
function depotPowered(depot) {
  return Boolean(depot?.generatorOn) && (depot?.generatorFuel ?? 0) > 0;
}

// How many whole turns of running is left in the tank. What the cockpit gauge
// and the Examine line both report, so they cannot disagree.
function fuelTurnsLeft(depot) {
  const burn = depot?.fuelBurnPerTurn ?? 0;
  if (burn <= 0) return null;
  return Math.floor((depot?.generatorFuel ?? 0) / burn);
}

// How much room is left on the credit line.
//
// Clamped at BOTH ends, and the upper clamp is the load-bearing one — the same
// trap the retired ⬢ credit helper documented. A debt driven below zero by
// an Undo landing after a repayment would otherwise read as MORE headroom than
// the cap allows, minting credit out of nothing.
function creditAvailableObols(depot) {
  const cap = depot?.creditCapObols ?? 0;
  return Math.min(cap, Math.max(0, cap - (depot?.debtObols ?? 0)));
}

// The Depot row, created on first touch. Every reader goes through this so a
// fresh database never hands back null.
async function loadDepot(tx) {
  return tx.depot.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Who the turret spares. Written when a character is created on the Merchant
// role (web/app/(app)/character/createActions.js) so a new Merchant is not
// handed a gun he is forbidden to arm, and writable by a GM from /gm/dev after
// that. It is set ONCE and never follows the character: the turret reads a
// FACE, so a Merchant who later conceals himself presents an alias, misses
// this string and is shot by his own gun, which is the point.
//
// A blank name is ignored rather than stored. Clearing the face is a
// deliberate GM act through the Dev Panel, never a side effect of some caller
// having nothing to say.
async function setMerchantFace(tx, name) {
  const face = String(name ?? "").trim();
  if (!face) return null;
  await loadDepot(tx);
  return tx.depot.update({ where: { id: 1 }, data: { merchantFace: face } });
}

// The shared shape behind every mover below: lock the row, clamp inside the
// UPDATE, report what actually moved. `column` is interpolated as an
// identifier and so must never come from user input — the three callers below
// pass literals.
async function bumpColumn(tx, column, amount, { max = null } = {}) {
  await loadDepot(tx);

  if (!amount) {
    const depot = await tx.depot.findUnique({ where: { id: 1 } });
    const current = depot?.[column] ?? 0;
    return { before: current, after: current, delta: 0 };
  }

  // Prisma tags every ${} in a $queryRaw template as a bound parameter, which
  // is right for the numbers and wrong for the column name — an identifier
  // cannot be a parameter. $queryRawUnsafe with the numbers still bound keeps
  // the injection surface at zero while letting the identifier through.
  const ceiling = max === null ? "NULL" : "$2::int";
  const params = max === null ? [amount] : [amount, max];
  const rows = await tx.$queryRawUnsafe(
    `
    WITH prev AS (
      SELECT "${column}" AS before FROM "Depot" WHERE "id" = 1 FOR UPDATE
    )
    UPDATE "Depot" d
    SET "${column}" = GREATEST(0, LEAST(COALESCE(${ceiling}, prev.before + $1::int), prev.before + $1::int))
    FROM prev
    WHERE d."id" = 1
    RETURNING prev.before AS before, d."${column}" AS after
    `,
    ...params,
  );

  const before = rows[0]?.before ?? 0;
  const after = rows[0]?.after ?? before;
  return { before, after, delta: after - before };
}

// Obols into or out of the station's account. No ceiling — the Merchant can be
// as rich as he can get.
function bumpAccount(tx, amount) {
  return bumpColumn(tx, "accountObols", amount);
}

// Fuel, capped at the tank's size so shovelling coal into a full generator
// wastes it rather than banking it.
async function bumpFuel(tx, amount) {
  const depot = await loadDepot(tx);
  return bumpColumn(tx, "generatorFuel", amount, { max: depot.fuelMax ?? 100 });
}

// There is no ⬢-to-obol conversion, on purpose. One obol IS one ⬢.
//
// The catalog's depotPrice/sellablePrice stay denominated in ⬢ — they are what
// a thing is WORTH, and that has to keep meaning the same number whether the
// Merchant is buying it or a player is pricing it in conversation. An obol is
// simply that same value made physical: a stackable tag you can carry, trade,
// stash and have stolen, which a number on a character sheet never was.
//
// A rate above 1 used to sit here, and it broke the bottom of the price table
// — a 3 ⬢ cup of tea cost a whole 5 ⬢ coin to buy and paid nothing to sell.
// At parity every price in the catalog is already a whole number of obols, so
// nothing anywhere rounds and there is no margin for rounding to hide in.

module.exports = {
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  depotPowered,
  fuelTurnsLeft,
  creditAvailableObols,
  loadDepot,
  setMerchantFace,
  bumpAccount,
  bumpFuel,
};
