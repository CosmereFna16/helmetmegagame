// Canonical Farming/Fishing/Herding production rates (base/Laborer/specialist
// tiers, see docs/roles.yaml's Laborer tree and docs/documents.yaml's
// "Producing Resources" doc) and the Hunting dice expressions. Single source
// of truth for both /labor (bot/src/lib/labor.js, computed live against
// GameConfig.productionCoefficient) and the doc generator
// (db/prisma/sync-production-doc.js) — change a rate here, not in either of
// those places.
const PRODUCTION_RATES = {
  herding: { base: 3, laborer: 8, specialist: 13 },
  farming: { base: 4, laborer: 12, specialist: 21 },
  fishing: { base: 3, laborer: 11, specialist: 19 },
};

// Hunting isn't part of the Laborer tree (no Laborer (Hunting) tag) and
// isn't scaled by productionCoefficient — it stays on its own Hunter-tag
// track, matching how it was excluded from the Laborer surplus modeling.
const HUNTING_DICE = {
  base: "1d4",
  specialist: "1d4*3",
};

function computeRate(field, tier, coefficient) {
  const rate = PRODUCTION_RATES[field]?.[tier];
  if (rate == null) return null;
  return Math.round(rate * (coefficient ?? 1));
}

module.exports = { PRODUCTION_RATES, HUNTING_DICE, computeRate };
