// One formatter for every price the Depot prints, so the ⬢/¢ toggle in the
// cockpit cannot drift between the Order table, the Price List and the Hold.
//
// The catalog is denominated in ⬢ and stays that way — see
// db/lib/depotState.js for why a thing's WORTH has to keep meaning the same
// number whichever side of the counter you are on. This is display only.
//
// Obol mode prints the EXACT figure, decimals and all: an 8 ⬢ ware reads
// 1.6 ¢. Rounding a row to a whole obol would be a lie about a cart of ten of
// them, because the station converts on the total and not line by line. The
// settlement figures — the order total, the Hold payout, the balance — are
// whole obols and are never routed through here.

const RES = "⬢";
const OBOL = "¢";

// Two decimals is enough for every rate a GM would set; trailing zeros go, so
// 10 ⬢ at rate 5 reads "2 ¢" rather than "2.00 ¢".
function trim(n) {
  return String(Math.round(n * 100) / 100);
}

export function formatMoney(resources, rate, unit, { sign = false } = {}) {
  if (resources == null) return null;
  const value = unit === "obol" ? resources / Math.max(1, rate || 5) : resources;
  const glyph = unit === "obol" ? OBOL : RES;
  const plus = sign && value > 0 ? "+" : "";
  return `${plus}${trim(value)} ${glyph}`;
}

// The word for the unit, for a sentence rather than a cell.
export function unitName(unit) {
  return unit === "obol" ? "obols" : RES;
}
