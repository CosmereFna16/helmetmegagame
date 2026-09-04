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
// trap db/lib/depot.js#creditAvailable documents. A debt driven below zero by
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

// The credit line. Positive draws, negative repays. The cap is enforced by the
// caller (which must refuse rather than silently clamp, so the Merchant is
// told he hit the ceiling) — this only stops it going below zero.
function bumpDebt(tx, amount) {
  return bumpColumn(tx, "debtObols", amount);
}

// Fuel, capped at the tank's size so shovelling coal into a full generator
// wastes it rather than banking it.
async function bumpFuel(tx, amount) {
  const depot = await loadDepot(tx);
  return bumpColumn(tx, "generatorFuel", amount, { max: depot.fuelMax ?? 100 });
}

// ⬢ to obols, and the direction matters.
//
// The catalog's depotPrice/sellablePrice stay denominated in ⬢ — they are what
// a thing is WORTH, and that has to keep meaning the same number whether the
// Merchant is buying it or a player is pricing it in conversation. Obols are a
// compression of ⬢, not a replacement, so the conversion happens at the
// counter and only there.
//
// Always on the TOTAL, never per unit. Per-unit rounding would make anything
// under one obol either free or unsellable — a lump of coal at 3 ⬢ floors to
// zero — and ten of them would still be worth nothing. On the total, ten coal
// is 30 ⬢ is 6 ¢, which is the answer a person would give.
//
// The station rounds in its own favour both ways, which is what a station
// does: you pay the ceiling and you are paid the floor.
function obolsToPay(resourceTotal, rate) {
  const r = Math.max(1, rate ?? 5);
  return Math.ceil(Math.max(0, resourceTotal) / r);
}

function obolsEarned(resourceTotal, rate) {
  const r = Math.max(1, rate ?? 5);
  return Math.floor(Math.max(0, resourceTotal) / r);
}

module.exports = {
  obolsToPay,
  obolsEarned,
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  depotPowered,
  fuelTurnsLeft,
  creditAvailableObols,
  loadDepot,
  bumpAccount,
  bumpDebt,
  bumpFuel,
};
