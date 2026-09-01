// The one gate on Labor (nothing grows in the depths) and the one tag ladder
// that sets its tier. There is no flavor left to route on — a player's
// laboring can be narrated as hunting, herding or anything else, but it is
// mechanically one activity now, so this file carries no per-field table.
//
// Same pure-rules / async-context split as db/lib/narrowcastAccess.js, and
// for a sharper reason here: db/lib/defaultMovePass.js resolves Labor for
// every character in one bulk pass, so the rules have to be callable against
// a context the caller already has in hand rather than each one costing its
// own round trip.
//
// Called by the Move modal (the `labor` checkbox,
// bot/src/events/interactionCreate.js#handleMoveSubmit) and
// db/lib/defaultMovePass.js (a Default Move with `labor: true`).
const { computeRate, rollRate } = require("./production");
const {
  EXHAUSTED_SLUG,
  LABORER_BASIC_SLUG,
  LABORER_SKILLED_SLUG,
  LABORER_FARMING_SLUG,
} = require("./constants");

// Butcher adds a flat +2 to both ends of a Labor roll on every tier but
// Farming. Local rather than in constants.js because this file is the only
// thing that has ever needed either value.
const BUTCHER_SLUG = "butcher";
const BUTCHER_LABOR_BONUS = 2;

// Loads the current zone and held tags for one character — the only inputs
// the rules and the tier ladder need.
async function buildLaborContext(prisma, characterId) {
  const [character, tags] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: { zone: { select: { slug: true, seatZone: { select: { slug: true } } } } },
    }),
    prisma.characterTag.findMany({
      where: { characterId },
      select: { tag: { select: { slug: true } } },
    }),
  ]);

  return {
    zoneSlug: character?.zone?.slug ?? null,
    seatZoneSlug: character?.zone?.seatZone?.slug ?? character?.zone?.slug ?? null,
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
  };
}

// { ok: true } or { ok: false, reason }. Two rules: nothing can be produced in
// the depths, and one Labor per day — the payout itself grants Exhausted
// (db/lib/moveEffects.js), which this gate reads back until the expiry sweep
// clears it a turn later. A null/unknown zone is allowed — the old "can't herd
// from nowhere" carve-out dies with herding, since there's no longer a field
// whose absence of a zone was ambiguous.
function computeLaborAccess(ctx) {
  if (ctx.tagSlugs.has(EXHAUSTED_SLUG)) {
    return { ok: false, reason: "You're still **Exhausted** from your last labor." };
  }
  if (ctx.seatZoneSlug === "caves") {
    return { ok: false, reason: "Nothing can be produced in the depths." };
  }
  return { ok: true };
}

// Farming (holds laborer-farming AND stands in Town) beats Skilled beats
// Basic beats base. The parentTag chain means a Skilled holder does NOT also
// hold laborer-basic — Fighting/Brewing work the same way — so the ladder
// below has to check Skilled on its own rung rather than assuming it implies
// Basic.
//
// A GM-granted Farming tag with no Skilled behind it re-runs the ladder
// without the farming rung, rather than defaulting straight to Farming's
// written prerequisite — so it resolves to whatever tag they actually hold
// (Basic, or base), never silently to Skilled's rate.
function resolveLaborTier(ctx) {
  if (ctx.tagSlugs.has(LABORER_FARMING_SLUG) && ctx.zoneSlug === "town" && ctx.tagSlugs.has(LABORER_SKILLED_SLUG)) {
    return "farming";
  }
  if (ctx.tagSlugs.has(LABORER_SKILLED_SLUG)) return "skilled";
  if (ctx.tagSlugs.has(LABORER_BASIC_SLUG)) return "basic";
  return "base";
}

// Pure half: context + coefficient -> the range this character would get.
// { ok: false, reason } | { ok: true, tier, min, max, expression }
function resolveLaborRateFrom(ctx, coefficient) {
  const access = computeLaborAccess(ctx);
  if (!access.ok) return access;

  const tier = resolveLaborTier(ctx);
  const rate = computeRate("labor", tier, coefficient);
  if (!rate) return { ok: false, reason: "Unknown activity." };

  // Butcher's +2, applied automatically rather than left as a line in the tag
  // description for a GM to remember. Not on Farming: the bonus is for taking
  // an animal apart, and Farming is the one tier that isn't hunting.
  //
  // Folded into min/max rather than annotated onto `expression`, deliberately:
  // the expression is a MACHINE format, parsed back by
  // db/lib/resourceDelta.js#rollResourceRange (`/^(\d+)-(\d+)$/`) at Move
  // confirm and in the Default Move pass. Anything appended to it — "(+2
  // Butcher)" — fails that regex, and a failed parse rolls null, which pays
  // the character nothing at all.
  //
  // It IS returned separately, though, so the two Labor DMs
  // (bot/src/lib/moveConfirm.js and db/lib/defaultMovePass.js) can say the
  // bonus out loud in a subtext line. Folded in silently, a Butcher had no way
  // to tell it had applied — which is exactly what got reported as a bug.
  const bonus = ctx.tagSlugs.has(BUTCHER_SLUG) && tier !== "farming" ? BUTCHER_LABOR_BONUS : 0;
  const min = rate.min + bonus;
  const max = rate.max + bonus;

  return { ok: true, tier, min, max, bonus, expression: `${min}-${max}` };
}

// The one wording for "your roll already includes Butcher", shared so the
// Move-confirm DM (bot/) and the Default Move DM (db/) can't drift apart.
// Discord `-#` subtext: it explains a number rather than competing with it.
// Returns null when there is no bonus, so a caller can spread it straight into
// a lines array.
function formatLaborBonusNote(bonus) {
  if (!bonus) return null;
  return `-# Includes +${bonus} ⬢ from Butcher.`;
}

// Async convenience for the one-character call sites (the Move modal),
// which have no context loaded yet.
async function resolveLaborRate(prisma, characterId) {
  const [ctx, config] = await Promise.all([
    buildLaborContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { productionCoefficient: true } }),
  ]);
  return resolveLaborRateFrom(ctx, config?.productionCoefficient ?? 1);
}

module.exports = {
  computeLaborAccess,
  formatLaborBonusNote,
  resolveLaborTier,
  resolveLaborRateFrom,
  resolveLaborRate,
  rollRate,
};
