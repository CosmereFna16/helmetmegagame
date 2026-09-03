# Laboring

How a character turns a day into ⬢. Replaces the old flat Labor checkbox: it
is now a kind of Move, it needs a skill, and **where you stand decides what
it pays**.

Read this before touching `db/lib/laborAccess.js`, `db/lib/production.js`,
`db/lib/laborYield.js`, `db/lib/autoLaborPass.js`, the `yield:` blocks in
`docs/zones.yaml`, or any `laborBonus:` in `docs/tags.yaml`.

## 1. The shape of it

Three things changed at once, and they only make sense together:

- **There is no Default Move.** `DefaultEffort` is gone. If you file nothing,
  you labor — automatically, if you can.
- **Labor is a third `MoveKind`**, alongside `ROUTINE` and `GAMBIT`. A turn
  buys one of the three, so filing a Routine or a Gambit *costs* you the day's
  labor. There is no checkbox any more.
- **Laboring is a skill, not a floor.** Hold no Laboring tag and you cannot
  labor at all. The old `base` tier is deleted.

## 2. The tag ladder

All five cost **7** (`TAGS.md` §4a: significant — it reliably changes how a
month goes). Ranges live in `PRODUCTION_RATES` in `db/lib/production.js`,
which is the single source for both the payout and the `{resource:labor:tier}`
bubbles the tag descriptions render through.

| slug | name | range | gate |
|---|---|---|---|
| `laborer-basic` | Laboring (Basic) | 0–2 | — |
| `laborer-skilled` | Laboring (Skilled) | 1–4 | `parentTag: laborer-basic` |
| `laborer-hunting` | Laboring (Hunting) | 0–18 | `requiredTag: laborer-skilled` |
| `laborer-farming` | Laboring (Farming) | 12–16 | `requiredTag: laborer-skilled` |
| `laborer-fishing` | Laboring (Fishing) | 7–14 | `requiredTag: laborer-skilled` |

The slugs still say `laborer-`; the display names say `Laboring`. That is
deliberate — the catalog matches on slug, and renaming one costs a prune.

The bottom two are general: they pay the same everywhere. The top three are
**side-grades, not rungs**. Holding several is fine and normal, and there is
nothing to switch between — §4 pays the best one you qualify for.

**Basic ignores `GameConfig.productionCoefficient`** (`UNSCALED_TIERS` in
`production.js`). It is the floor of the whole economy, and a GM turning the
dial down to rebalance specialists must not quietly delete subsistence too.
Everything else scales.

## 3. What a place is worth

Each Location carries up to three `LocationYield` rows, one per `LaborKind`.
**No row means that labor is impossible there** — that is what prints `×`, and
it is why no Location needs a "wilderness" or "water" flag anywhere in the
schema. The row is the gate.

`base` is authored in `docs/zones.yaml`; `current` is where the world has
drifted it, and `current` is the only number a payout or the Labor? button
ever reads.

```yaml
    forest-5:
      name: Forest 5
      description: >-
        …
      yield: { hunting: 0.7, farming: 0.3 }
```

`db:sync-zones` writes these. It always writes `base`. It does **not** write
`current` — that is live state, and a routine re-sync must not shove the whole
map back to its authored value mid-game. The exception is a `base` that
actually changed, which is Bascinet retuning the map: the row is reset and any
running event cleared, so the edit lands on the next turn rather than creeping
in over a week. A kind dropped from the YAML has its row deleted.

`collectYields` in `db/lib/syncZones.js` refuses a typo'd kind, a value outside
0–2, and an explicit `0` (omit the key instead) — a silent `hunitng: 0.5`
would disable hunting somewhere and the symptom is nearly invisible in play.

### 3a. The authored table

Anything not listed has no row and cannot be worked. Locations are addressed by
the **numeric suffix of the slug** (the hand-drawn map node number), which for
Forest is not the number in the display name: `forest-36` shows as "Forest 11".

**Farming** — Farms 1.0 · Manors 0.6 · `forest-4`/`8`/`9` 0.5 · every other
Forest tile 0.3 · Keep 0.2.

**Fishing** — `forest-1`/`3`/`4`/`6`/`10`/`36` 0.7 · `east-forests-27` 0.8 ·
`marshes-31`…`35` 1.0.

**Hunting** — Forest 0.5 except `forest-5` 0.7 · `marshes-31`…`35` 1.0 · East
Forests 0.8 except `east-forests-30` 1.1 and `east-forests-27` 1.3 ·
`caves-14`…`17` 0.4 · Depths 0.6 except `depths-19` 1.8 and `depths-23` 1.6.

Village and Factory have no hunting and no fishing — they are built up. Town
and Fortress have neither at all; their only yield is farming. Nothing farms or
fishes underground.

**The old blanket "nothing can be produced in the depths" is gone.** Hunting
down there is now most of the reason to go.

## 4. Resolving one labor

`resolveLaborRateFrom` in `db/lib/laborAccess.js`, in order:

1. **Gate.** Holding `exhausted` refuses. That is the whole gate now — one
   labor per day, granted by the payout itself (`db/lib/moveEffects.js`) and
   read back until the expiry sweep clears it a turn later.
2. **Build candidates.** The best general tier held (Skilled, else Basic), plus
   one per specialisation held that has a `LocationYield` row here. No general
   tier at all means no candidates and no labor.
3. **Scale.** `productionCoefficient` × the location's `current`, both ends,
   rounded. Basic skips both.
4. **Add tools** for that candidate's kind (§5). Bonuses sum.
5. **Pick the winner** — highest ceiling, tie-broken on the better floor.
6. **Soft Hands** halves both ends, floor. It lands *after* the tools, so it is
   literally "half of what you make".
7. **Lifeweb failure** (§6).

The returned `expression` is a **machine format** — `"min-max"`, matched by
`db/lib/resourceDelta.js#rollResourceRange` against `/^(\d+)-(\d+)$/`. Never
append anything to it. A failed parse pays the character nothing, silently.
The tool breakdown rides out as separate fields so the DM can name it in a
`-#` subtext line instead.

Picking the best automatically is the point: "I forgot to switch to Fishing" is
not a way to lose a day, and a specialisation that doesn't beat your general
tier never costs you anything.

## 5. Tools

Authored as a `laborBonus:` block on a tag, normalised and validated by
`db/lib/tagShapes.js`, stored as `Tag.laborBonus`:

```yaml
    laborBonus: { kind: hunting, amount: 3, equipped: true, requiresTag: horse }
```

`equipped` defaults **true**. The sync refuses a bonus that requires being
equipped on a tag that isn't `equippable`, and a `requiresTag` naming a tag
that doesn't exist.

| tag | kind | ⬢ | note |
|---|---|---|---|
| Sling | hunting | +1 | equipped |
| Shortbow | hunting | +2 | equipped |
| Longbow | hunting | +3 | equipped |
| Crossbow | hunting | +3 | equipped |
| Trapping Gear | hunting | +3 | equipped; new, craftable and depot stock |
| Butcher | hunting | +2 | **not** equipped — it's a skill |
| every firearm | hunting | +2 | equipped |
| Hatchet | farming | +1 | equipped |
| Plow | farming | +4 | not equipped; needs a `horse` |
| Fishing Rod | fishing | +1 | equipped; new |

Bonuses **sum**. `GameConfig.equipSlots` is what stops a hunter wearing every
weapon in the game at once, and the two that don't need equipping are the two
that aren't weapons.

**Butcher's bonus narrowed.** It used to be a hardcoded flat +2 on every tier
but farming. It is hunting-only now, and it moved out of code into the YAML.

## 6. When the Lifeweb fails

At or below `LIFEWEB_SPUTTER_THRESHOLD` (20, in `db/lib/lifeweb.js` — it moved
there from `db/index.js` so `db/lib/` modules can reach it):

- **Basic yields nothing at all.** Not scaled — stopped. 5% of "you can
  sometimes provide for yourself" is nothing with extra steps.
- Everything else keeps `Math.floor(x * 0.05)`.

In practice that zeroes almost the whole economy. Only the richest hunting in
the Depths still pays a single ⬢. That is the intent: this used to be flavor
text on a turn announcement and nothing else.

## 7. Drift — what the land does on its own

`db/lib/laborYield.js`. A mean-reverting random walk plus jump events, in the
same spirit as `db/weather.js`'s Markov table.

```
target  = in an event ? eventTarget : base
current = clamp(current + reversion * (target - current) + gaussian(sigma), 0, 2)
```

An event does **not** move `current` — it moves what `current` is pulled
toward. That is what makes a swing arrive over a couple of turns instead of as
a step change, and what makes it decay on its own: clearing `eventTarget` puts
`base` back in the target slot and the same reversion walks it home. There is
no separate recovery path.

| kind | reversion | sigma | daily wobble | event chance | length | magnitude |
|---|---|---|---|---|---|---|
| HUNTING | 0.30 | 0.12 | ≈ ±0.16 | 6% per location per turn | 2–8 turns | ×0.25 – ×2 |
| FISHING | 0.20 | 0.07 | ≈ ±0.11 | 2.5% per location per turn | 3–10 turns | ×0.5 – ×1.6 |
| FARMING | 0.12 | 0.025 | ≈ ±0.05 | 1.8% per turn, **once for the world** | 8–20 turns | ×1.5 (40%) or ×0.55 (60%) |

Farming's event is rolled once globally and applied to every farming row at
once — a blight or a golden harvest, not one field having a bad week. Rolled
per-location it would fire about a dozen times a month across the 14 farming
locations instead of the roughly once that was asked for.

Measured over 200 simulated 60-turn games: hunting drifts ±0.16 from base with
2.8 events per location, fishing ±0.10 with 1.3, farming ±0.06 with 0.9.
Nothing ever left `[0, 2]`.

Clamped hard at both ends. A row with `base` 0 cannot exist, so nothing ever
drifts up from disabled.

### 7a. Where it runs

`TURN_PASSES` in `db/index.js`, as `"laborYield"`, late — **after**
`"autoLabor"** so a day is paid at the coefficients that were live during it,
and what it writes is what the next turn is worth.

It is random and therefore **not idempotent**, which is exactly why it is a
named pass: `markDone` is what stops a resumed turn advance from drifting the
whole map twice.

## 8. The auto-labor pass

`db/lib/autoLaborPass.js`, `TURN_PASSES` slot `"autoLabor"`, still **before**
Hunger so income lands before upkeep.

Candidate set is every ALIVE character, not a saved panel. It files nothing and
sends nothing for anyone who:

- already has an Action this turn (a travel stub counts — crossing zones spends
  the day),
- holds an `INCAPACITATING_SLUGS` tag,
- holds **no Laboring tag**,
- is Exhausted, or is standing where none of their skills reach.

Everyone else gets a `LABOR` Action, `CONFIRMED` / `PASSED`, `gmNotes:
"auto:labor"`, effects applied and snapshotted onto `appliedEffects` (which is
what tells the staged push to skip the row), and one DM naming the place, the
kind that won, the roll and any tool that paid.

The old summary-post machinery (`shareInSummary` / `summaryMessage`) died with
`DefaultEffort`. The pass returns `dms` only.

## 9. The Labor? button

Fourth button on every Location anchor, between Secret rooms? and Converse
(`db/lib/locationAnchorRow.js`, prefix `loc:labor:`; handler
`handleLaborQuery` in `bot/src/events/interactionCreate.js`).

**Information only.** It files nothing, costs nothing, and anyone standing
there can press it whether or not they hold a Laboring tag — scouting is the
point, and a scout reporting back to a hunter is a conversation the game wants.

```
» *Forest 5.*
**Hunting**: Modest | **Farming**: Scarce | **Fishing**: ×
```

Words, never numbers. Working out that Bountiful beats Ample is the player's
job, and the numbers move anyway.

| `current` | word |
|---|---|
| no row, or 0 | `×` |
| < 0.30 | Barren |
| < 0.60 | Scarce |
| < 0.90 | Modest |
| < 1.20 | Sufficient |
| < 1.55 | Ample |
| ≥ 1.55 | Bountiful |

At base, only `depths-19` and `depths-23` wear Bountiful. This button is the
**only** surface that shows a coefficient — not `#summary`, not the anchor.

## 10. File map

| File | What it owns |
|---|---|
| `db/lib/production.js` | The five ranges, and which tiers the global dial can't touch |
| `db/lib/laborAccess.js` | The gate, the candidates, the tools, the winner |
| `db/lib/laborYield.js` | Drift math, the turn pass, the quality words |
| `db/lib/autoLaborPass.js` | Filing a day for everyone who filed nothing |
| `db/lib/syncZones.js` | `collectYields`, `syncLocationYields` |
| `db/lib/tagShapes.js` | `normalizeLaborBonus` / `validateLaborBonus` |
| `db/lib/locationAnchorRow.js` | The Labor? button |
| `docs/zones.yaml` | Every `yield:` block |
| `docs/tags.yaml` | The five Laboring tags and every `laborBonus:` |
