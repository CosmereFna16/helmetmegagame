// Dependency-free fuzzy person-search. No fuzzy-match library exists in the
// repo; keep it that way — this is the one shared implementation, reused by
// the messages inbox and (per the plan) the bulk composer's recipient filter.
//
// The point is typo tolerance plus "found by anything about them": searching
// "Innkeeper" should surface the character holding the Innkeeper role, and
// "Bastad" should surface every member of the Bastards' Camp faction, not
// just literal name substrings.

// Field weights: name beats role beats faction beats username beats zone
// beats message preview. Higher wins when a query matches more than one
// field on the same row (matchedField reports the highest-weighted hit).
const FIELD_WEIGHTS = {
  name: 100,
  role: 80,
  faction: 70,
  username: 60,
  zone: 50,
  preview: 20,
};

// Tier bonuses, added on top of the field weight so an exact hit on a lower
// field can still lose to a substring hit on a higher one only when they're
// close — tune conservatively; ordering by field matters most.
const TIER_EXACT = 40;
const TIER_PREFIX = 30;
const TIER_SUBSTRING = 20;
const TIER_FUZZY = 10;

function normalize(str) {
  return String(str ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .trim();
}

function tokenize(str) {
  return normalize(str)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Bounded Levenshtein distance — returns Infinity as soon as it's certain the
// distance exceeds `max`, so a search over hundreds of rows stays cheap.
function boundedLevenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const alen = a.length;
  const blen = b.length;
  let prev = new Array(blen + 1);
  let curr = new Array(blen + 1);
  for (let j = 0; j <= blen; j++) prev[j] = j;

  for (let i = 1; i <= alen; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= blen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[blen];
}

function maxDistanceFor(tokenLength) {
  if (tokenLength >= 6) return 2;
  if (tokenLength >= 3) return 1;
  return 0;
}

// Scores one query token against one field's token list. Returns the best
// tier bonus found, or null if nothing matched within tolerance.
function scoreTokenAgainstField(qToken, fieldTokens, fieldWhole) {
  if (!qToken) return null;

  // Exact token match, or the field-as-a-whole equals the token (covers
  // single-word fields where "whole" and "token" coincide anyway, cheap).
  if (fieldTokens.includes(qToken) || fieldWhole === qToken) return TIER_EXACT;

  for (const ft of fieldTokens) {
    if (ft.startsWith(qToken)) return TIER_PREFIX;
  }
  if (fieldWhole.includes(qToken)) return TIER_SUBSTRING;

  const maxDist = maxDistanceFor(qToken.length);
  if (maxDist > 0) {
    for (const ft of fieldTokens) {
      if (boundedLevenshtein(qToken, ft, maxDist) <= maxDist) return TIER_FUZZY;
    }
  }
  return null;
}

// scoreMatch(query, fields) — `fields` is { name, role, faction, username,
// zone, preview }, any subset, string or null/undefined. Every query token
// must match SOME field (AND across tokens); the row's score is the sum of
// each token's best (field weight + tier) hit, and matchedField reports the
// highest-weighted field any token matched, for the match-reason subtext.
export function scoreMatch(query, fields) {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return null;

  const fieldEntries = Object.entries(FIELD_WEIGHTS)
    .filter(([key]) => fields[key] != null && fields[key] !== "")
    .map(([key, weight]) => ({
      key,
      weight,
      whole: normalize(fields[key]),
      tokens: tokenize(fields[key]),
    }));
  if (fieldEntries.length === 0) return null;

  let total = 0;
  let bestField = null;
  let bestFieldWeight = -1;

  for (const qToken of qTokens) {
    let tokenBest = null;
    let tokenBestField = null;
    for (const fe of fieldEntries) {
      const tier = scoreTokenAgainstField(qToken, fe.tokens, fe.whole);
      if (tier == null) continue;
      const score = fe.weight + tier;
      if (tokenBest == null || score > tokenBest) {
        tokenBest = score;
        tokenBestField = fe;
      }
    }
    if (tokenBest == null) return null; // AND across tokens: every token must hit
    total += tokenBest;
    if (tokenBestField.weight > bestFieldWeight) {
      bestFieldWeight = tokenBestField.weight;
      bestField = tokenBestField.key;
    }
  }

  return { score: total, matchedField: bestField };
}
