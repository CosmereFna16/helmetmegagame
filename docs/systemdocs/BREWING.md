# Brewing

Every recipe a brewer can make, with its real cost. Price a new brew off these
tables, not by feel. If you change a number here, also change the tag's
`requirement` block in `docs/tags.yaml` and the row in the **Alcohol & Drugs**
document in `docs/documents.yaml`.

**Brewing has no tier ladder.** Smithing prices a weapon by picking a tier
(`SMITHING.md`); brewing prices each recipe on its own, because the real cost
is usually the ingredient rather than the ⬢. So the tables below are the
ladder — there is nothing above them to derive a price from.

Every `requirement` block is a GM adjudication reference. **No code enforces
a recipe**: not the ⬢, not the turns, not the skill, and least of all the
ingredient. `addTagRequestImpl` accepts a brew because the tag is
`craftable: true`; a GM decides whether the brewer actually had what it took.

## 1. Skills

| Slug | Name | pt | Gate |
|---|---|---|---|
| `brewing-basic` | Brewing (Basic) | 2 | none |
| `brewing-skilled` | Brewing (Skilled) | 2 | `parentTag: brewing-basic` (cumulative, total 4) |

## 2. Brewing (Basic)

| Brew | ⬢ | Turns | Ingredient | Consumes into |
|---|---|---|---|---|
| `bliss` | 0 | 0 | cave fungus | `euphoric`, `high` (3t) |
| `feces` | 0 | 0 | feces | — |
| `alcohol` | 2 | 0 | — | `tipsy` |
| `miasma` | 2 | 0 | a corpse | — |
| `poppy` | 2 | 0 | — | `opium-high` |
| `molotov-cocktail` | 2 | 0 | alcohol | — |
| `nekker-pheromones` | 2 | 0 | a dead nekker | `pheromones` |
| `cleaning-powder` | 2 | 1 | — | — |
| `cat` | 3 | 0 | alcohol | `night-vision` (1t) |
| `nightshade` | 3 | 0 | a forest herb | — |

## 3. Brewing (Skilled)

| Brew | ⬢ | Turns | Ingredient | Consumes into |
|---|---|---|---|---|
| `pure-luck` | 0 | 0 | an Aberrant's heart | `aberrant-luck` |
| `graga-sweat` | 2 | 0 | a graga sac | `brutish-strength` |
| `white-honey` | 2 | 0 | a rainbow trout's heart | — |
| `deadeye-drops` | 2 | 0 | cave fungus | `increased-accuracy` |
| `mercy` | 2 | 0 | cave fungus | `increased-recovery` |
| `mindbreaker-toxin` | 2 | 0 | cave fungus | `hallucinating` |
| `invisibility-potion` | 2 | 0 | a graga sac | `invisible` |
| `succubus-draught` | 2 | 0 | a willing lover's blood | `mindreading` |
| `raven-draught` | 2 | 0 | a raven's eye | — |
| `ravenheart-red` | 4 | 0 | — | `tipsy` |
| `distilled-coca` | 4 | 0 | coca leaves | `stimulant-high` |
| `advanced-poppy` | 4 | 0 | poppy | `pain-immunity` |
| `phrygian-tears` | 4 | 2 | **Gambit** | — |
| `gunpowder-grenade` | 6 | 0 | saltpeter | — |
| `purifier` | 6 | 0 | cave fungus | — |
| `dreamers-draught` | 6 | 0 | **Gambit** | — |
| `forgiveness` | 8 | 0 | someone's tears | — |
| `flawless-skin` | 8 | 0 | a lock of Nobility hair | `otherworldly-beauty` |

## 3a. Bacchus recipe

Gated by the cult's own `brewing-ambrosia` tag (`requiredTag: brewing-basic`),
not by `brewing-skilled` — a Cultist doesn't need the ordinary Skilled rung to
make this one.

| Brew | ⬢ | Turns | Ingredient | Consumes into |
|---|---|---|---|---|
| `ambrosia` | 25 | 3 | `bliss` | `euphoric` |

An empty **Consumes into** cell is not an oversight. `consumable` with no
`consumesInto` is set where the brew is spent *by a Move* rather than by the
drinker — a poison you administer, a flask you throw, a powder worked into
someone else's wound — so the GM applies the result to whoever it happened to.

## 4. Ingredients

Five ingredients are real tags, so a GM can see whether the brewer holds one:

| Tag | Where it comes from |
|---|---|
| `cave-fungus` | foraged in the caves. 0 ⬢. Eaten raw it gives `high` (2t). |
| `graga-sac` | cut out of a dead Graga |
| `saltpeter` | mined in the caverns |
| `alcohol` | brewed, one tier down |
| `poppy` | brewed, one tier down |

The rest — a corpse, a raven's eye, a rainbow trout's heart, an Aberrant's
heart, a willing lover's blood, a lock of Nobility hair — are prose. Nothing
tracks them, and that is the point: getting hold of one is meant to be a scene
with another player rather than a purchase. If it is just flavor, the player
tells the GMs how they got it.

## 5. Yields

A few basic brews come out in a batch from a single Routine Move. The yield is
written into the tag's own description rather than the `requirement` block,
which has no field for it:

| Brew | Per Move |
|---|---|
| `alcohol` | 3 |
| `bliss` | 2 |
| `poppy` | 2 |
| `molotov-cocktail` | 2 |
| `cleaning-powder` | 2 (over its 1 turn) |
| `mercy` | 2 |

## 6. Where a player reads this

The **Alcohol & Drugs** document (`docs/documents.yaml`, key `alcoholdrugs`)
carries ⬢, turns and the ingredient, and nothing else. What a brew *does*
lives in the tag's own description and shows on hover — `TagChip.js` renders
the description plus a **Recipe** line built by
`formatTagRequirement` (`db/lib/formatTagRequirement.js`) from the same
`requirement` block these tables come from. Don't restate an effect in the
document; it is already two places.
