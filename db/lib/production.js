// Canonical Labor tiers (base/Basic/Skilled/Farming, see docs/roles.yaml's
// Laborer tree and docs/documents.yaml's "Producing Resources" doc). Single
// source of truth for both the Labor checkbox (db/lib/laborAccess.js,
// computed live against GameConfig.productionCoefficient) and
// web/lib/referenceData.js's getProductionRates (which backs the
// {resource:field:tier} bubbles docs/documents.yaml's "Producing Resources"
// doc renders through) — change a rate here, not in either of those places.
//
// One flavor, one field: `labor` is the only key. The old table kept a row
// per production flavor (hunting/fishing/farming/herding) purely so the
// {resource:field:tier} renderers stayed field-agnostic; now there is only
// one field and the same two-level {field: {tier}} shape carries no dead
// weight, it's just the generic shape `{resource:labor:tier}` bubbles need.
const PRODUCTION_RATES = {
  labor: {
    base: { min: 0, max: 2 },
    basic: { min: 2, max: 5 },
    skilled: { min: 7, max: 9 },
    farming: { min: 18, max: 26 },
  },
};

// Both ends scale independently. No min>max guard on purpose: Math.round is
// monotonic and the coefficient is never negative, so min <= max survives the
// scaling by construction — a clamp here would only hide a coefficient that
// had gone genuinely wrong. A small coefficient collapsing 0-4 to 0-0 is
// correct, not a bug.
function computeRate(field, tier, coefficient) {
  const rate = PRODUCTION_RATES[field]?.[tier];
  if (rate == null) return null;
  const c = coefficient ?? 1;
  return { min: Math.round(rate.min * c), max: Math.round(rate.max * c) };
}

// Display form for a rate — "3" when it can't vary, "0–4" (en dash) when it
// can. The one place that dash is written; the API serves the result so no
// client component has to reimplement it.
function formatRate(rate) {
  if (!rate) return null;
  return rate.min === rate.max ? String(rate.min) : `${rate.min}–${rate.max}`;
}

function rollRate(rate) {
  if (!rate) return null;
  return rate.min + Math.floor(Math.random() * (rate.max - rate.min + 1));
}

module.exports = { PRODUCTION_RATES, computeRate, formatRate, rollRate };
