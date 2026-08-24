# Food production (`/hunt`, `/fish`, `/farm`, `/herd`)

The four ways a character turns a Routine Move into Resources. One payout
table, one location gate, one parser.

## 1. Payouts

`db/lib/production.js` is the sole source. **Every tier is a `{min,max}`
range**, even though only Hunting actually varies:

| Field | Base | Laborer | Specialist |
|---|---|---|---|
| Herding | 1 | 5 | 10 |
| Farming | 3 | 9 | 18 |
| Fishing | 2 | 7 | 14 |
| Hunting | 0–4 | 5–12 | 10–24 |

The uniform shape is load-bearing. Hunting used to have its own `HUNTING_DICE`
table, which made it a special case in five separate places and meant it
silently escaped `GameConfig.productionCoefficient` entirely. One shape means
`/herd` and `/hunt` run identical code.

- `computeRate` scales both ends by the coefficient and returns `{min,max}`.
- `formatRate` is the **only** place the en dash in `"0–4"` is written.
- `rollRate` picks the value.

**Tier is the same ladder for all four**: `laborer-<field>` → specialist,
`laborer` → laborer, else base.

## 2. The location gate

`db/lib/laborAccess.js`, mirroring `db/lib/narrowcastAccess.js`'s
pure-rules/async-context split. **Location matched by `slug`, Zone by `name`**,
for the same reason: the rules are authored against `docs/locations.yaml`'s
fixed identifiers.

| Field | Requires |
|---|---|
| Hunting | The `forest` Location |
| Fishing | The Fortress or Town Zone |
| Farming | Town |
| Herding | Any zone **but** Caves, and a *known* zone — an off-map character can't herd from nowhere |

**Nothing feeds anyone in the Caves.** That's the point of the four rules taken
together, not a coincidence of how each was written separately.

A refusal always returns **before** `action.create`, so being in the wrong
place never costs the player their turn.

## 3. Commands

**One `/labor <type>` command**, its choices built in
`bot/src/lib/commands.js` from `LABOR_FIELDS` so the list still can't drift.

This reverses an earlier decision. There used to be four commands — `/hunt`,
`/fish`, `/farm`, `/herd` — specifically so that the slash command and the
text shorthand were spelled identically. Four near-identical entries crowded
the command picker, and the picker got busier still when `/move`, `/location`
and `/message` joined it, so the four collapsed back into one.

**The text shorthand did not change.** A Move body and a Default Move still
take `/hunt`, not `/labor hunt` — §4 parses it, and rewriting the grammar
would break every stored `DefaultEffort` row. So the two are no longer spelled
identically, and that is the accepted cost.

## 4. The shorthand parser

**A `/hunt`-style shorthand is resolved at submission, never at confirm.**

`db/lib/resourceDelta.js#parseResourceExpression` stays pure and synchronous —
it's called once per character from `runDefaultMovePass`, so a version doing its
own lookups would turn one turn advance into N round trips. It returns a
`{kind: "shorthand"}` marker that the caller collapses into a concrete range
before storing.

Two consequences follow:

- The gate can run **before** the `Action` row exists, which is what makes
  "your turn isn't spent" possible.
- Only one grammar — a plain range — ever reaches the database.

`defaultMovePass` resolves shorthands from three bulk reads, not per character.
A gated Default Move still files (they did spend the day trying) but pays
nothing, and carries a `gateNote` into the player's DM.

## 5. Notation

`parseResourceDelta` handles `+N` / `plus N`. A range like `5-12` is the roll
form; it is whitespace-bounded on both sides for the same reason the `+N` regex
is, so `Sector-9` isn't misread.

**Dice notation is gone** from both `#turns` and Default Moves. The known,
accepted cost of the range form is that a bare `5-12` is also ordinary English
— matching once rather than globally bounds it, the `#turns` confirm DM shows
the parsed roll before anything lands, and the Default Move tooltip says
outright that a bare range reads as a roll.

`Action.resourceRollExpression`/`resourceRollValue` carry `@map` to their
original SQL column names. A leftover `"1d4*3"` row returns `null` from
`rollResourceRange` and confirms on its flat delta rather than throwing.

## 6. Where the code lives

`db/lib/production.js` (rates), `db/lib/laborAccess.js` (the gate),
`db/lib/resourceDelta.js` (parsing), `bot/src/lib/labor.js` (`performLabor`),
`bot/src/lib/commands.js` (the `/labor` command).
