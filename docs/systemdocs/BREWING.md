# Brewing

Every recipe a brewer can make, with its real cost. Price a new brew off these
tables, not by feel. If you change a number here, also change the tag's
`requirement` block in `docs/tags.yaml` and the row in the **Alcohol & Drugs**
document in `docs/documents.yaml`.

**Brewing has no tier ladder.** Smithing prices a weapon by picking a tier
(`SMITHING.md`); brewing prices each recipe on its own, because the real cost
is usually the ingredient rather than the ⬢. So the tables below are the
ladder — there is nothing above them to derive a price from.

**This paragraph used to say no code enforced any of it. That is no longer
true of anything in it.** The Craft flow charges the ⬢, spends the Move and
checks the skills; and **three recipes now have a real, enforced ingredient** —
`miasma` needs a corpse, `dreamers-draught` needs a Skinless Brain, and
`moonshine` needs Godflesh (`Tag.requirementItems`, `CORPSES.md` §8,
`FACTORY.md` §8). Holding it is the check: **nothing is consumed**, so you keep
the corpse you bottled the Miasma over. Everything else in the Ingredient column
below is still prose that a GM adjudicates.

Moonshine is the only recipe in the game that costs **0 ⬢** and still has a
real ingredient, and that is deliberate rather than an oversight: the marsh
hands you the Godflesh, the throttle is the Routine, and at 3 ⬢ a bottle it
undercuts a farming day badly enough to be nobody's living. What it costs is
the drinker's eyes, a notch at a time (`FACTORY.md` §8).

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
| `alcohol` | 2 | 1 | — | `tipsy` (and up the ladder — §5a) |
| `moonshine` | **0** | 1 | **Godflesh** (enforced, kept) | `tipsy` (ladder, §5a), `blind-drunk` (2t), `damaged-vision` |
| `miasma` | 2 | 1 | **a corpse** (enforced, kept) | — |
| `poppy` | 2 | 1 | — | `opium-high` |
| `molotov-cocktail` | 2 | 0 | alcohol | — |
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
| `ravenheart-red` | 4 | 1 | — | `tipsy` (and up the ladder — §5a) |
| `distilled-coca` | 4 | 1 | coca leaves | `stimulant-high` |
| `advanced-poppy` | 4 | 1 | poppy | `pain-immunity` |
| `phrygian-tears` | 4 | 2 | — | — |
| `gunpowder-grenade` | 6 | 1 | saltpeter | — |
| `purifier` | 6 | 1 | cave fungus | — |
| `dreamers-draught` | 6 | 1 | **a skinless brain** (enforced, kept) | — |
| `forgiveness` | 8 | 1 | someone's tears | — |
| `flawless-skin` | 8 | 1 | a lock of Nobility hair | `otherworldly-beauty` |

An empty **Consumes into** cell is not an oversight. `consumable` with no
`consumesInto` is set where the brew is spent *by a Move* rather than by the
drinker — a poison you administer, a flask you throw, a powder worked into
someone else's wound — so the GM applies the result to whoever it happened to.

## 4. Ingredients

Six ingredients are real tags, so a GM can see whether the brewer holds one:

| Tag | Where it comes from | Enforced? |
|---|---|---|
| `cave-fungus` | foraged in the caves. 0 ⬢. Eaten raw it gives `high` (2t). | no |
| `graga-sac` | **butchered** out of a {Graga Corpse} | no |
| `skinless-brain` | **butchered** out of a {Skinless Corpse} | **yes** — `dreamers-draught` |
| `saltpeter` | mined in the caverns | no |
| `alcohol` | brewed, one tier down | no |
| `poppy` | brewed, one tier down | no |

"A corpse", for `miasma`, is enforced too, and is the one entry that matches a
whole tag GROUP rather than a slug — any corpse will do, including the one a
dead player leaves behind. See `CORPSES.md` §8.

**`nekker-pheromones` is no longer brewed at all.** It is butchered out of a
Nekker Corpse; it lost its `craftable` flag and its row in §2.

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

## 5a. The drinking ladder

Every drink still consumes into `tipsy` and none of them names anything else.
The escalation lives on the status tags themselves, as `Tag.escalatesInto`
(`docs/tags.yaml`, `db/prisma/schema.prisma`), so a new brew gets the ladder
for free by consuming into `tipsy` like the rest.

| You are | You drink | You become |
|---|---|---|
| sober | anything alcoholic | **Tipsy** (1t) |
| **Tipsy** | again | **Wasted** — the Tipsy comes off |
| **Wasted** | again | **Unconscious** |
| **Unconscious** | — | nothing; you cannot act |
| **Hangover** | again | **Tipsy**, and round it goes |

**Wasted** and **Unconscious** both expire into **Hangover** (1t) through the
ordinary `expiresInto` machinery — the same road `seizure` takes to `stupid`,
with no new turn pass.

**Unconscious is in `INCAPACITATING_SLUGS`** (`db/lib/incapacitation.js`): out
cold is out cold, so you can be looted, dragged and tied up where you fell. It
is deliberately **not** in `FINISHABLE_SLUGS` — passing out in a tavern is not
a death sentence anyone can carry out without a GM.

Three things that are easy to get wrong:

- **Only the consume path climbs.** `db/lib/tagWrites.js#grantTagSlugs` is
  shared with `removesInto`, Undo and every GM grant, and it stays deliberately
  ignorant of the ladder. A GM handing somebody Tipsy twice from the Dev Panel
  does nothing the second time, which is correct — that is not a drink.
- **The walk starts from the rung you occupy, not the one being granted.**
  Somebody already Wasted does not hold Tipsy, so a naive "do they hold what
  I'm granting?" test would pour them a fresh Tipsy instead of putting them on
  the floor. `web/lib/consumeGrants.js#climbLadder` owns this.
- **The top rung is a no-op, not a fall.** Drinking while Unconscious clears
  nothing and grants nothing. Clearing a rung without granting its successor
  would make one more drink *sober you up*.

The Fighting penalties on all three tags are **prose, not code** — nothing in
the repo reads `tipsy`. They are numbers a GM weighs while adjudicating, which
is how Tipsy has always worked.

Brewing files its Routine through the Craft button, same as any other
craftable tag — `phrygian-tears` and `dreamers-draught` no longer carry
`gambit: true`, since crafting is never a Gambit (`CRAFTING.md`).

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
