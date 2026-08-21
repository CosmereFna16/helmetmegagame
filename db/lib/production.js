// Canonical Farming/Fishing/Herding/Hunting production rates (base/Laborer/
// specialist tiers, see docs/roles.yaml's Laborer tree and
// docs/documents.yaml's "Producing Resources" doc). Single source of truth
// for both the labor commands (bot/src/lib/labor.js, computed live against
// GameConfig.productionCoefficient) and web/app/api/production-rates/route.js
// (which backs the {resource:field:tier} bubbles docs/documents.yaml's
// "Producing Resources" doc renders through) — change a rate here, not in
// either of those places.
//
// Every tier is a {min,max} range, even the three fields whose payout is a
// flat number (min === max). Hunting is the only one that actually varies,
// but giving it a table of its own is what used to make it a special case in
// five separate places — the API route's field loop, the three
// {resource:...} renderers, and labor.js's payout branch. One shape means
// `/herd` and `/hunt` run identical code and hunting rides the Laborer tier
// ladder and the production coefficient like everything else.
const PRODUCTION_RATES = {
  herding: { base: { min: 1, max: 1 }, laborer: { min: 5, max: 5 }, specialist: { min: 10, max: 10 } },
  farming: { base: { min: 3, max: 3 }, laborer: { min: 9, max: 9 }, specialist: { min: 18, max: 18 } },
  fishing: { base: { min: 2, max: 2 }, laborer: { min: 7, max: 7 }, specialist: { min: 14, max: 14 } },
  hunting: { base: { min: 0, max: 4 }, laborer: { min: 5, max: 12 }, specialist: { min: 10, max: 24 } },
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
