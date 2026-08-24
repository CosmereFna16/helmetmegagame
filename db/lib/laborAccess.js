// Where each kind of food production is legal, what tag ladder sets its
// tier, and the one place a "/hunt"-style shorthand becomes a concrete range.
//
// Same pure-rules / async-context split as db/lib/narrowcastAccess.js, and
// for a sharper reason here: db/lib/defaultMovePass.js resolves shorthands
// for every character in one bulk pass, so the rules have to be callable
// against a context the caller already has in hand rather than each one
// costing its own round trip.
//
// Called by bot/src/lib/labor.js (the /hunt /fish /farm /herd commands),
// the Move modal (a shorthand typed into it) and
// db/lib/defaultMovePass.js (a shorthand standing as a Default Move).
const { computeRate, rollRate } = require("./production");
const {
  LABORER_SLUG,
  LABORER_FARMING_SLUG,
  LABORER_FISHING_SLUG,
  LABORER_HERDING_SLUG,
  LABORER_HUNTING_SLUG,
} = require("./constants");

const LABOR_FIELDS = ["hunt", "fish", "farm", "herd"];

// field -> { rateField (db/lib/production.js key), specialistSlug, verb }.
const FIELD_INFO = {
  hunt: { rateField: "hunting", specialistSlug: LABORER_HUNTING_SLUG, verb: "hunted", noun: "Hunting" },
  fish: { rateField: "fishing", specialistSlug: LABORER_FISHING_SLUG, verb: "fished", noun: "Fishing" },
  farm: { rateField: "farming", specialistSlug: LABORER_FARMING_SLUG, verb: "farmed", noun: "Farming" },
  herd: { rateField: "herding", specialistSlug: LABORER_HERDING_SLUG, verb: "herded", noun: "Herding" },
};

// Location matched by slug, Zone by name — narrowcastAccess.js's convention,
// since these rules are authored against docs/locations.yaml, where a
// Location has a stable `id` slug but a Zone is only matched by name.
//
// Nothing feeds anyone in the Caves: all four rules exclude that zone, which
// is the point rather than a coincidence of how they're written.
// `where` is a full adverbial phrase, not a bare place name, so it reads
// correctly after "happens" for the exclusion rule as well as the three
// inclusion ones ("happens only in Town" / "happens anywhere but the Caves").
const LABOR_RULES = {
  hunt: { where: "only in the Forest", test: (ctx) => ctx.locationSlug === "forest" },
  fish: {
    where: "only in the Fortress or Town",
    test: (ctx) => ctx.zoneName === "Fortress" || ctx.zoneName === "Town",
  },
  farm: { where: "only in Town", test: (ctx) => ctx.zoneName === "Town" },
  // Requires a *known* zone, so a character who is nowhere on the map can't
  // herd from nowhere — a bare `!== "Caves"` would let them.
  herd: { where: "anywhere but the Caves", test: (ctx) => ctx.zoneName != null && ctx.zoneName !== "Caves" },
};

// Loads the current Location/Zone and held tags for one character — the only
// inputs the rules and the tier ladder need.
async function buildLaborContext(prisma, characterId) {
  const [character, tags] = await Promise.all([
    prisma.character.findUnique({
      where: { id: characterId },
      select: { location: { select: { slug: true } }, zone: { select: { name: true } } },
    }),
    prisma.characterTag.findMany({
      where: { characterId },
      select: { tag: { select: { slug: true } } },
    }),
  ]);

  return {
    locationSlug: character?.location?.slug ?? null,
    zoneName: character?.zone?.name ?? null,
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
  };
}

// { ok: true } or { ok: false, reason } — reason is player-facing copy naming
// where the activity *is* possible, since "you can't do that here" without
// the alternative just sends them back to the docs.
function computeLaborAccess(ctx, field) {
  const rule = LABOR_RULES[field];
  if (!rule) return { ok: false, reason: "Unknown activity." };
  if (!rule.test(ctx)) {
    return { ok: false, reason: `You can't ${field} here — ${FIELD_INFO[field].noun} happens ${rule.where}.` };
  }
  return { ok: true };
}

// Specialist if they hold the field's own Laborer tag, Laborer if they hold
// the base one, else base. Hunting rides this ladder like the other three.
function resolveLaborTier(ctx, field) {
  const info = FIELD_INFO[field];
  if (ctx.tagSlugs.has(info.specialistSlug)) return "specialist";
  if (ctx.tagSlugs.has(LABORER_SLUG)) return "laborer";
  return "base";
}

// Pure half: context + coefficient -> the range this character would get.
// { ok: false, reason } | { ok: true, tier, min, max, expression }
function resolveLaborRateFrom(ctx, field, coefficient) {
  const access = computeLaborAccess(ctx, field);
  if (!access.ok) return access;

  const tier = resolveLaborTier(ctx, field);
  const rate = computeRate(FIELD_INFO[field].rateField, tier, coefficient);
  if (!rate) return { ok: false, reason: "Unknown activity." };

  return { ok: true, tier, min: rate.min, max: rate.max, expression: `${rate.min}-${rate.max}` };
}

// Async convenience for the one-character call sites (the slash commands and
// a shorthand typed into #turns), which have no context loaded yet.
async function resolveLaborRate(prisma, characterId, field) {
  const [ctx, config] = await Promise.all([
    buildLaborContext(prisma, characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { productionCoefficient: true } }),
  ]);
  return resolveLaborRateFrom(ctx, field, config?.productionCoefficient ?? 1);
}

module.exports = {
  LABOR_FIELDS,
  FIELD_INFO,
  LABOR_RULES,
  buildLaborContext,
  computeLaborAccess,
  resolveLaborTier,
  resolveLaborRateFrom,
  resolveLaborRate,
  rollRate,
};
