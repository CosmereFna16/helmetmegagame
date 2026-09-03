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
| `alcohol` | 2 | 1 | — | `tipsy` |
| `miasma` | 2 | 1 | a corpse | — |
| `poppy` | 2 | 1 | — | `opium-high` |
| `molotov-cocktail` | 2 | 0 | alcohol | — |
| `nekker-pheromones` | 2 | 1 | a dead nekker | `pheromones` |
| `cleaning-powder` | 2 | 1 | — | — |
| `cat` | 3 | 1 | alcohol | `night-vision` (1t) |
| `nightshade` | 3 | 1 | a forest herb | — |

## 3. Brewing (Skilled)

| Brew | ⬢ | Turns | Ingredient | Consumes into |
|---|---|---|---|---|
| `pure-luck` | 0 | 1 | an Aberrant's heart | `aberrant-luck` |
| `graga-sweat` | 2 | 1 | a graga sac | `brutish-strength` |
| `white-honey` | 2 | 1 | a rainbow trout's heart | — |
| `deadeye-drops` | 2 | 1 | cave fungus | `increased-accuracy` |
| `mercy` | 2 | 1 | cave fungus | `increased-recovery` |
| `mindbreaker-toxin` | 2 | 1 | cave fungus | `hallucinating` |
| `invisibility-potion` | 2 | 1 | a graga sac | `invisible` |
| `succubus-draught` | 2 | 1 | a willing lover's blood | `mindreading` |
| `raven-draught` | 2 | 1 | a raven's eye | — |
| `ravenheart-red` | 4 | 1 | — | `tipsy` |
| `distilled-coca` | 4 | 1 | coca leaves | `stimulant-high` |
| `advanced-poppy` | 4 | 1 | poppy | `pain-immunity` |
| `phrygian-tears` | 4 | 2 | **Gambit** | — |
| `gunpowder-grenade` | 6 | 1 | saltpeter | — |
| `purifier` | 6 | 1 | cave fungus | — |
| `dreamers-draught` | 6 | 1 | a skinless brain, **Gambit** | — |
| `forgiveness` | 8 | 1 | someone's tears | — |
| `flawless-skin` | 8 | 1 | a lock of Nobility hair | `otherworldly-beauty` |

An empty **Consumes into** cell is not an oversight. `consumable` with no
`consumesInto` is set where the brew is spent *by a Move* rather than by the
drinker — a poison you administer, a flask you throw, a powder worked into
someone else's wound — so the GM applies the result to whoever it happened to.

## 4. Ingredients

Six ingredients are real tags, so a GM can see whether the brewer holds one:

| Tag | Where it comes from |
|---|---|
| `cave-fungus` | foraged in the caves. 0 ⬢. Eaten raw it gives `high` (2t). |
| `graga-sac` | cut out of a dead Graga |
| `skinless-brain` | cut out of a dead Skinless |
| `saltpeter` | mined in the caverns |
| `alcohol` | brewed, one tier down |
| `poppy` | brewed, one tier down |

`skinless-brain` is the one ingredient that is also a moral problem. A Graga is
a beast; the Skinless used to be people and, per the Caves brief, can be talked
down. Making the second-most-expensive Skilled brew now means someone decided
not to. That is the recipe, not an oversight — but it is worth a GM knowing it
is there before a player finds it.

The rest — a corpse, a raven's eye, a rainbow trout's heart, an Aberrant's
heart, a willing lover's blood, a lock of Nobility hair — are prose. Nothing
tracks them, and that is the point: getting hold of one is meant to be a scene
with another player rather than a purchase. If it is just flavor, the player
tells the GMs how they got it.

## 5. Yields

A few brews come out in a batch. The `requirement` block has no field for a
yield, so the number is written into the **Alcohol & Drugs** document's Turns
column instead, phrased the same way every time — "yields up to N per turn":

| Brew | Per turn |
|---|---|
| `alcohol` | 3 |
| `bliss` | 2 |
| `poppy` | 2 |
| `molotov-cocktail` | 2 |
| `cleaning-powder` | 2 |
| `mercy` | 2 |

**The ⬢ cost is per unit, and it multiplies.** Three alcohols in one turn cost
6 ⬢, not 2. Every yield row in the document carries an `{info:…}` tooltip
saying so, since the table itself has no room to.

## 6. Where a player reads this

The **Alcohol & Drugs** document (`docs/documents.yaml`, key `alcoholdrugs`)
carries ⬢, turns, the batch yield and the ingredient, and nothing else. A
yield row also carries an `{info:…}` token — a `?` glyph whose payload is its
own tooltip sentence, rendered by `DocumentMarkdown.js`. What a brew *does*
lives in the tag's own description and shows on hover — `TagChip.js` renders
the description plus a **Recipe** line built by
`formatTagRequirement` (`db/lib/formatTagRequirement.js`) from the same
`requirement` block these tables come from. Don't restate an effect in the
document; it is already two places.
