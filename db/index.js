const { PrismaClient } = require("@prisma/client");
const { rollWeather, buildTurnAnnouncement } = require("./weather");
const { HUNGERLESS_SLUG, NOBILITY_SLUG, TIPSY_SLUG } = require("./lib/constants");

const globalForPrisma = globalThis;

const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// A Nobility character who goes this many turns without a Fine (or Lavish)
// meal sours to Unhappy until they eat again — see resolveNeeds() below and
// ateMeal() in web/app/(app)/character/actions.js.
const NOBILITY_UNHAPPY_THRESHOLD_TURNS = 3;

// Below this, the turn announcement gets a vague public omen line (see
// advanceTurn() below) without ever naming the actual number — the Blood
// value itself stays visible only to Mortus-tagged characters and GMs
// (web/app/(app)/lifeweb/page.js).
const LIFEWEB_SPUTTER_THRESHOLD = 20;

// Applies per-turn Needs decay (resource consumption, hunger, mood expiry)
// to every ALIVE character for the turn being closed. Shared between the
// bot's cron-triggered advanceTurn() and the GM dashboard's manual
// close-turn override, so both paths behave identically instead of only
// the automated one actually resolving Needs.
async function resolveNeeds(turn, config) {
  const characters = await prisma.character.findMany({ where: { status: "ALIVE" } });
  const consumption = config?.resourceConsumptionPerTurn ?? 1;

  const [hungerlessTags, nobilityTags, tipsyTags] = await Promise.all([
    prisma.characterTag.findMany({
      where: { characterId: { in: characters.map((c) => c.id) }, tag: { slug: HUNGERLESS_SLUG } },
      select: { characterId: true },
    }),
    prisma.characterTag.findMany({
      where: { characterId: { in: characters.map((c) => c.id) }, tag: { slug: NOBILITY_SLUG } },
      select: { characterId: true },
    }),
    prisma.characterTag.findMany({
      where: { characterId: { in: characters.map((c) => c.id) }, tag: { slug: TIPSY_SLUG } },
      select: { characterId: true, expiresTurn: true },
    }),
  ]);
  const hungerlessIds = new Set(hungerlessTags.map((ct) => ct.characterId));
  const nobilityIds = new Set(nobilityTags.map((ct) => ct.characterId));
  const tipsyExpiryByCharacterId = new Map(tipsyTags.map((ct) => [ct.characterId, ct.expiresTurn]));

  await Promise.all(
    characters.map((character) => {
      const data = {};

      // A meal eaten this turn (see ateMeal()) exempts this turn's automatic
      // consumption — one-shot, cleared once spent.
      if (character.skipNextMealConsumption) {
        data.isHungry = false;
        data.skipNextMealConsumption = false;
      } else {
        const hadEnough = character.resources >= consumption;
        data.resources = hadEnough ? character.resources - consumption : character.resources;
        data.isHungry = hadEnough ? false : !hungerlessIds.has(character.id);
      }

      // Alcohol's Tipsy tag shields against Unhappy for its whole duration
      // (see drinkAlcohol() in web/app/(app)/character/actions.js) — still
      // "active" for this tick as long as it hasn't reached its expiry turn.
      const tipsyExpiresTurn = tipsyExpiryByCharacterId.get(character.id);
      const hasActiveTipsyShield = tipsyExpiresTurn != null && tipsyExpiresTurn > turn.number;

      // Nobility characters have a mood "baseline" driven by how long it's
      // been since their last Fine/Lavish meal: Unhappy once that gap hits
      // the threshold, Neutral otherwise (shielded to Neutral regardless
      // while a Tipsy tag is active). A temporary Happy (from a meal, a
      // drink, or a manual mood set) overlays this baseline and, once its
      // duration expires below, reveals whatever the baseline has become.
      let baseline = null;
      if (nobilityIds.has(character.id) && character.lastFineMealTurn != null) {
        const turnsSince = turn.number - character.lastFineMealTurn;
        const wouldBeUnhappy = turnsSince >= NOBILITY_UNHAPPY_THRESHOLD_TURNS;
        baseline = wouldBeUnhappy && !hasActiveTipsyShield ? "UNHAPPY" : "NEUTRAL";
      }

      if (character.moodExpiresTurn != null && character.moodExpiresTurn <= turn.number) {
        data.moodState = baseline ?? "NEUTRAL";
        data.moodNote = null;
        data.moodExpiresTurn = null;
      } else if (character.moodExpiresTurn == null && baseline != null && character.moodState !== baseline) {
        data.moodState = baseline;
        data.moodNote = null;
      }

      return prisma.character.update({ where: { id: character.id }, data });
    }),
  );

  // Sweep any turn-scoped tags (Ate Meal, Tipsy, Drained, ...) whose
  // expiresTurn has been reached — a single bulk delete rather than a
  // per-character check, since it's independent of everything computed above.
  await prisma.characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } });

  // The Lifeweb bleeds out a fixed amount every turn regardless of what fed
  // it last — see feedLifewebBlood()/feedLifewebCorpse() (web/app/(app)/character/actions.js,
  // web/app/(app)/lifeweb/actions.js) for the two ways it's topped back up.
  const newBlood = Math.max(0, (config?.lifewebBlood ?? 100) - (config?.lifewebDecayPerTurn ?? 10));
  await prisma.gameConfig.update({ where: { id: 1 }, data: { lifewebBlood: newBlood } });
  return newBlood;
}

async function getConfig() {
  return prisma.gameConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Resolves the currently OPEN turn (applying Needs decay) and opens the next
// one, alternating DAWN/DUSK. Shared by the bot's cron-triggered advance and
// any GM-triggered "End Turn" action so both apply identical turn logic —
// callers are responsible for anything Discord-specific (announcements),
// since the transport for that differs between the bot's gateway client and
// the web app's REST calls.
async function advanceTurn() {
  const config = await getConfig();
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });

  let lifewebBlood = config.lifewebBlood;
  if (openTurn) {
    lifewebBlood = await resolveNeeds(openTurn, config);
    await prisma.turn.update({
      where: { id: openTurn.id },
      data: { status: "RESOLVED", resolvedAt: new Date() },
    });
  }

  const lastTurn = openTurn ?? (await prisma.turn.findFirst({ orderBy: { number: "desc" } }));
  const phase = !lastTurn || lastTurn.phase === "DUSK" ? "DAWN" : "DUSK";
  // Weather only turns over on the DAWN turn (a fresh day, one Markov step
  // off yesterday's weather — see rollWeather() in weather.js); the DUSK
  // turn later that same day just inherits it unchanged, so a day reads as
  // one coherent condition instead of flipping mid-day. A GM's manual
  // override (config.nextWeather, set from the Dev Panel) always wins.
  const weather = config.nextWeather ?? (phase === "DUSK" ? lastTurn.weather : rollWeather(lastTurn?.weather));
  const lifewebFlavor = lifewebBlood <= LIFEWEB_SPUTTER_THRESHOLD ? "The Lifeweb sputters, failing." : null;
  const note = [lifewebFlavor, config.nextTurnNote].filter(Boolean).join("\n\n") || null;

  const newTurn = await prisma.turn.create({
    data: { number: (lastTurn?.number ?? 0) + 1, phase, weather, gameDate: new Date(), status: "OPEN" },
  });

  await prisma.gameConfig.update({
    where: { id: 1 },
    data: { nextWeather: null, nextTurnNote: null },
  });

  return { previousTurn: openTurn, newTurn, note };
}

module.exports = {
  prisma,
  resolveNeeds,
  advanceTurn,
  LIFEWEB_SPUTTER_THRESHOLD,
  ...require("./weather"),
  ...require("./lib/constants"),
  ...require("./lib/roleColor"),
};
