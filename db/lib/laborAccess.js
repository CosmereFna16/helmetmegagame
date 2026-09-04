// What a labor is worth: the gate, the tag ladder, the location's cut, and the
// tools. The single source for every surface that pays or previews a Labor —
// the Move modal's LABOR kind (bot/src/events/interactionCreate.js), the
// auto-labor pass (db/lib/autoLaborPass.js) and the Labor? button
// (db/lib/locationAnchorRow.js's handler).
//
// Two general tiers and three location-scaled specialisations. A character
// holding several of them does not choose — resolveLaborRateFrom scores every
// candidate they qualify for and pays the best one, so "I forgot to switch to
// Fishing" is not a way to lose a day. See docs/systemdocs/LABORING.md.
//
// Same pure-rules / async-context split as db/lib/narrowcastAccess.js, and for
// a sharper reason here: the auto-labor pass resolves a Labor for every idle
// character in one bulk pass, so the rules have to be callable against a
// context the caller already has in hand rather than each one costing its own
// round trip.
const { computeRate, SPECIALISATION_KINDS } = require("./production");
const { LIFEWEB_SPUTTER_THRESHOLD } = require("./lifeweb");
const { structuresAt } = require("./structures");
const {
  EXHAUSTED_SLUG,
  LABORING_BASIC_SLUG,
  LABORING_SKILLED_SLUG,
  LABORING_FARMING_SLUG,
  LABORING_HUNTING_SLUG,
  LABORING_FISHING_SLUG,
} = require("./constants");

// Soft Hands halves what you make, rounded down. It lands AFTER the tools, so
// it is literally "half the Resources you make": a Soft-Handed hunter with a
// Longbow takes 0-18 -> 3-21 -> 1-10. On Basic (0-2) it floors to 0-1, which
// is the intended sting.
const SOFT_HANDS_SLUG = "soft-hands";

// The tag group every weapon lives in. Weapon bonuses do NOT stack with
// each other — carrying a Longbow and a Crossbow means you hunt with one of
// them, not both — so only the best-paying weapon counts toward a kind.
// Everything outside this group (Trapping Gear, a Plow, a Fishing Rod, the
// Butcher skill) still sums on top.
const WEAPON_GROUP = "items-weapons";

// What the Lifeweb failing does to the day's work. Not flavor: below the
// sputter threshold the Tower is not holding the valley together any more, and
// Basic labor — bare subsistence — stops working at all rather than being
// scaled, because 5% of "you can sometimes provide for yourself" is nothing
// with extra steps.
const LIFEWEB_FAILURE_MULTIPLIER = 0.05;

// The two general tiers, best first. Unlike the old ladder there is no `base`
// rung underneath: hold neither tag and you cannot labor.
const GENERAL_TIERS = [
  { slug: LABORING_SKILLED_SLUG, tier: "skilled" },
  { slug: LABORING_BASIC_SLUG, tier: "basic" },
];

// The three side-grades. Each needs its own tag AND a LocationYield row of the
// matching kind where the character is standing — the row IS the gate, which
// is why no Location carries a "wilderness" or "water" flag anywhere.
const SPECIALISATIONS = [
  { slug: LABORING_HUNTING_SLUG, tier: "hunting" },
  { slug: LABORING_FARMING_SLUG, tier: "farming" },
  { slug: LABORING_FISHING_SLUG, tier: "fishing" },
];

// Loads everything the rules need for one character: the tags they hold, where
// they stand, what that place yields, and what stands built there.
async function buildLaborContext(prisma, characterId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      locationId: true,
      location: {
        select: { name: true, yields: { select: { kind: true, current: true } } },
      },
    },
  });
  const [tags, structures] = await Promise.all([
    prisma.characterTag.findMany({
      where: { characterId },
      select: {
        equipped: true,
        tag: { select: { slug: true, name: true, group: true, laborBonus: true } },
      },
    }),
    // COMPLETE only — the same reading equipmentReach.js uses: a half-built
    // or damaged weir catches nothing, which is what gives Damage teeth.
    structuresAt(prisma, character?.locationId, { statuses: ["COMPLETE"] }),
  ]);

  return {
    locationName: character?.location?.name ?? null,
    yields: yieldMap(character?.location?.yields ?? []),
    tagSlugs: new Set(tags.map((t) => t.tag.slug)),
    tools: [...toolsFrom(tags), ...structureTools(structures)],
  };
}

// LocationYield rows -> { HUNTING: 0.5, ... }. A kind absent from the map is a
// kind that cannot be worked here at all.
function yieldMap(rows) {
  const map = {};
  for (const row of rows) map[row.kind] = row.current;
  return map;
}

// Pulls the laborBonus entries out of a character's tag rows. Kept as a flat
// list rather than summed per kind, so the DM can name each tool that paid.
function toolsFrom(tagRows) {
  const tools = [];
  for (const row of tagRows) {
    const bonus = row.tag?.laborBonus;
    if (!bonus || !bonus.kind || !bonus.amount) continue;
    tools.push({
      name: row.tag.name ?? row.tag.slug,
      kind: String(bonus.kind).toLowerCase(),
      amount: Number(bonus.amount) || 0,
      // Default true: nearly every tool is something you carry in your hands,
      // and the two that aren't (Plow, Butcher) say so explicitly.
      needsEquipped: bonus.equipped !== false,
      requiresTag: bonus.requiresTag ?? null,
      equipped: row.equipped === true,
      isWeapon: row.tag?.group === WEAPON_GROUP,
    });
  }
  return tools;
}

// Structures paying into the labor of everyone standing at their Location, as
// synthetic tool entries beside toolsFrom's — a Fish Weir is a tool nobody
// carries. Never equipped (there is nothing to hold), never a weapon (sums on
// top of the best-weapon rule like every other non-weapon tool), and the DM
// names it through the same formatLaborBonusNote path for free.
//
// NON-STACKING: one bonus per kind, the best one. Two hunting structures on
// one ground pay like the better of the two — a location-wide bonus is a
// faucet times occupancy, and the plan's ceiling is enforced here rather
// than hoped about in catalog pricing. Ties keep the older structure, which
// is stable because structuresAt orders by (createdAt, id).
//
// `structures` is structuresAt output (rows carrying .placement), already
// filtered to COMPLETE by the caller.
function structureTools(structures) {
  const bestByKind = new Map();
  for (const s of structures ?? []) {
    const bonus = s.placement?.laborBonus;
    if (!bonus || !bonus.kind || !bonus.amount) continue;
    const kind = String(bonus.kind).toLowerCase();
    const amount = Number(bonus.amount) || 0;
    const best = bestByKind.get(kind);
    if (best && best.amount >= amount) continue;
    bestByKind.set(kind, {
      name: s.type?.name ?? s.typeName,
      kind,
      amount,
      needsEquipped: false,
      requiresTag: null,
      equipped: false,
      isWeapon: false,
    });
  }
  return [...bestByKind.values()];
}

// { ok: true } or { ok: false, reason }. One rule left: one Labor per day. The
// payout grants Exhausted (db/lib/moveEffects.js), which this reads back until
// the expiry sweep clears it a turn later.
//
// The old blanket "nothing can be produced in the depths" is gone — hunting
// underground is now most of the reason to go down there, and a location that
// genuinely yields nothing simply has no LocationYield rows.
function computeLaborAccess(ctx) {
  if (ctx.tagSlugs.has(EXHAUSTED_SLUG)) {
    return { ok: false, reason: "You're still **Exhausted** from your last labor." };
  }
  return { ok: true };
}

// Does this character hold any Laboring tag at all? The auto-labor pass asks
// before filing anything, and the Move modal asks before offering the kind.
function canLaborAtAll(ctx) {
  return GENERAL_TIERS.some((t) => ctx.tagSlugs.has(t.slug));
}

// Every tool that pays into one kind, honouring `equipped` and `requiresTag`.
// Non-weapons sum. Weapons don't: you hunt with one weapon in your hands, so
// only the best-paying one counts, and a second bow is dead weight rather than
// a second bonus. Ties keep the first, which is stable because the tag rows
// come back in a fixed order.
function toolsFor(ctx, tier) {
  const eligible = (ctx.tools ?? []).filter((tool) => {
    if (tool.kind !== tier) return false;
    if (tool.needsEquipped && !tool.equipped) return false;
    if (tool.requiresTag && !ctx.tagSlugs.has(tool.requiresTag)) return false;
    return true;
  });

  const bestWeapon = eligible
    .filter((tool) => tool.isWeapon)
    .reduce((best, tool) => (best && best.amount >= tool.amount ? best : tool), null);

  return eligible.filter((tool) => !tool.isWeapon || tool === bestWeapon);
}

// Scores one tier into a full candidate, or null if the character can't work
// it here. `locationCoefficient` is 1 for the general tiers, which is what
// makes them the same everywhere.
function scoreCandidate(ctx, tier, coefficient, locationCoefficient) {
  const rate = computeRate("labor", tier, coefficient, locationCoefficient);
  if (!rate) return null;
  const tools = toolsFor(ctx, tier);
  const bonus = tools.reduce((sum, tool) => sum + tool.amount, 0);
  return {
    tier,
    tools,
    bonus,
    min: rate.min + bonus,
    max: rate.max + bonus,
    locationCoefficient,
  };
}

// Pure half: context + the two dials -> the range this character would get.
// { ok: false, reason } | { ok: true, tier, min, max, expression, ... }
function resolveLaborRateFrom(ctx, coefficient, { lifewebFailing = false } = {}) {
  const access = computeLaborAccess(ctx);
  if (!access.ok) return access;

  const candidates = [];
  for (const { slug, tier } of GENERAL_TIERS) {
    if (!ctx.tagSlugs.has(slug)) continue;
    candidates.push(scoreCandidate(ctx, tier, coefficient, 1));
    // Only the best general tier competes. Skilled does not imply holding
    // Basic (the parentTag chain replaces it), but a GM-granted pair would
    // otherwise score both for nothing.
    break;
  }

  for (const { slug, tier } of SPECIALISATIONS) {
    if (!ctx.tagSlugs.has(slug)) continue;
    const kind = SPECIALISATION_KINDS[tier];
    const locationCoefficient = ctx.yields?.[kind];
    // No row, or a row that has bottomed out: there is nothing to work here.
    if (!locationCoefficient || locationCoefficient <= 0) continue;
    candidates.push(scoreCandidate(ctx, tier, coefficient, locationCoefficient));
  }

  const scored = candidates.filter(Boolean);
  if (scored.length === 0) {
    return {
      ok: false,
      reason: canLaborAtAll(ctx)
        ? "You have no Laboring skill that works where you're standing."
        : "You don't know how to labor.",
    };
  }

  // Best by ceiling, tie-broken on floor — a specialisation that beats your
  // general tier wins automatically, and one that doesn't never costs you.
  scored.sort((a, b) => b.max - a.max || b.min - a.min);
  const best = scored[0];

  let { min, max } = best;

  const halved = ctx.tagSlugs.has(SOFT_HANDS_SLUG);
  if (halved) {
    min = Math.floor(min / 2);
    max = Math.floor(max / 2);
  }

  if (lifewebFailing) {
    // Basic is not scaled, it stops. Everything else keeps a twentieth.
    if (best.tier === "basic") {
      min = 0;
      max = 0;
    } else {
      min = Math.floor(min * LIFEWEB_FAILURE_MULTIPLIER);
      max = Math.floor(max * LIFEWEB_FAILURE_MULTIPLIER);
    }
  }

  return {
    ok: true,
    tier: best.tier,
    min,
    max,
    bonus: best.bonus,
    tools: best.tools,
    halved,
    lifewebFailing,
    locationCoefficient: best.locationCoefficient,
    // A MACHINE format, parsed back by db/lib/resourceDelta.js#rollResourceRange
    // (`/^(\d+)-(\d+)$/`) when the Labor is paid. Anything appended to it —
    // "(+3 Longbow)" — fails that regex, and a failed parse pays the character
    // nothing at all. Say the bonus in the DM instead; never here.
    expression: `${min}-${max}`,
  };
}

// Prose for the tier that won, so a DM can say what the character actually did
// rather than just quoting a number.
const TIER_LABELS = {
  basic: "Laboring",
  skilled: "Laboring",
  hunting: "Hunting",
  farming: "Farming",
  fishing: "Fishing",
};

function laborTierLabel(tier) {
  return TIER_LABELS[tier] ?? "Laboring";
}

// The one wording for "here is why your roll is the size it is", shared so the
// Move-confirm DM (bot/) and the auto-labor DM (db/) can't drift apart.
// Discord `-#` subtext: it explains a number rather than competing with it.
// Returns null when there is nothing to explain, so a caller can spread it
// straight into a lines array.
function formatLaborBonusNote({ tools = [], halved = false, lifewebFailing = false } = {}) {
  const parts = [];
  for (const tool of tools) {
    if (tool.amount) parts.push(`+${tool.amount} ⬢ from ${tool.name}`);
  }
  if (halved) parts.push("halved by Soft Hands");
  if (lifewebFailing) parts.push("and the Lifeweb is failing, so almost nothing came of it");
  if (parts.length === 0) return null;
  const [first, ...rest] = parts;
  const sentence = `${first.charAt(0).toUpperCase()}${first.slice(1)}${rest.length ? `, ${rest.join(", ")}` : ""}`;
  return `-# Includes ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}. ‡`;
}

// Async convenience for the one-character call sites (the Move modal and the
// Labor? button), which have no context loaded yet.
async function resolveLaborRate(prisma, characterId) {
  const [ctx, config] = await Promise.all([
    buildLaborContext(prisma, characterId),
    prisma.gameConfig.findUnique({
      where: { id: 1 },
      select: { productionCoefficient: true, lifewebBlood: true },
    }),
  ]);
  return resolveLaborRateFrom(ctx, config?.productionCoefficient ?? 1, {
    lifewebFailing: (config?.lifewebBlood ?? 100) <= LIFEWEB_SPUTTER_THRESHOLD,
  });
}

module.exports = {
  LIFEWEB_FAILURE_MULTIPLIER,
  buildLaborContext,
  canLaborAtAll,
  computeLaborAccess,
  formatLaborBonusNote,
  laborTierLabel,
  resolveLaborRateFrom,
  resolveLaborRate,
  structureTools,
  toolsFrom,
  yieldMap,
};
