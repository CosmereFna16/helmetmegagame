// Party-size thresholds for the Cult of Bacchus's party goals, shared by the
// /api/party-sizes route (which feeds the {partysize:N} inline token in
// docs/documents.yaml) and by anything else that needs to know how many
// bodies a party needs — so the number a Cultist reads in their brief and the
// number a GM adjudicates against can't drift.
//
// Same shape and posture as db/lib/roleCapacity.js's weight math: a base
// value expressed as "per 100 players", scaled live by GameConfig.playerCount
// so raising the dial mid-signup widens every goal proportionally without
// touching any prose. Pure rules, no prisma — same posture as travelCost.js
// and laborAccess.js.
//
// Two deliberate departures from roleCapacity(), which sits right next door
// and does neither:
//
//   Math.floor, not Math.round. A party threshold is a bar you clear, not a
//     seat count: rounding up would make a 50-player game's first goal 3
//     rather than the 2 that "4 per 100, rounded down" means.
//   The Math.max(1, ...) clamp is kept, for roleCapacity's own reason. A tier
//     needing 0 people would unlock itself the moment it was authored, which
//     is what floor() gives you below 25 players.
//
// Tiers are 1-INDEXED at the boundary — {partysize:1} is the first goal — and
// the table below is a plain 0-indexed array. That offset is the one thing a
// reader gets wrong; every caller passes the token's number verbatim.
const PARTY_SIZES_PER_HUNDRED = [4, 8, 12, 16];

function partySize(tier, playerCount) {
  const perHundred = PARTY_SIZES_PER_HUNDRED[tier - 1];
  if (perHundred == null) return null;
  return Math.max(1, Math.floor((perHundred * playerCount) / 100));
}

// The display half lives beside the math for the same reason formatRate and
// formatCapacity do: the string form has one implementation. A party size is
// a headcount, so it deliberately carries no ⬢ — that glyph is Resources
// only (see the Resources glyph section of CLAUDE.md).
function formatPartySize(value) {
  return value == null ? null : String(value);
}

// The tier numbers a caller may ask for, so a route enumerating them never
// re-declares the length of the table.
const PARTY_SIZE_TIERS = PARTY_SIZES_PER_HUNDRED.map((_, i) => i + 1);

module.exports = { PARTY_SIZES_PER_HUNDRED, PARTY_SIZE_TIERS, partySize, formatPartySize };
