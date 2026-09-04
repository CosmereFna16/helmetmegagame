# The Depot

The Merchant's station: a hangar door in the roof of the caves, a shuttle that
comes through it, a generator that has to be fed, a turret in the ceiling, and
a bank. This file is the source of truth for all of it.

Everything the Depot buys and sells has a real price. Price a new ware off the
tables below, not by feel. If you change a number here, change the tag's
`depotPrice` or `sellablePrice` in `docs/tags.yaml` in the same commit — this
file and that one are the same numbers written twice, and nothing checks that
they agree.

**The Depot has no tier ladder.** Smithing prices a weapon by picking a tier
(`SMITHING.md`); the Depot prices each ware on its own, because what a thing
costs is a fact about a civilisation Ravenheart cannot see. The tables below
are the ladder — there is nothing above them to derive a price from.

Unlike a brewing recipe, these numbers **are** enforced. `depotPrice` and
`sellablePrice` are read off the catalog row server-side by
`web/app/(app)/depot/actions.js` — never taken from the client — and a GM does
not adjudicate a purchase. The price is then snapshotted into `Request.effect`,
so re-tuning a number here never changes what an Undo of an older trade
reverses.

## 0. The rework, and what it changed

The Depot used to be a shop: two panels, a table, and ⬢ moving on and off the
Merchant's own sheet. It worked and nobody wanted to open it twice. The rework
turned it into a machine somebody operates, and five things are now true that
were not before.

- **The money is obols (¢), not ⬢.** One obol is worth `Depot.obolRate` ⬢
  (5 by default) and only at this counter. They are a weightless stackable tag,
  so a fortune fits in a pocket — which is the point, because ⬢ do not.
  **The catalog still prices in ⬢.** `depotPrice` and `sellablePrice` are what
  a thing is *worth*, and that has to keep meaning the same number whether the
  Merchant is buying it or a player is haggling over it. The conversion happens
  at the counter and only there — on the **total**, never per unit, because
  per-unit rounding makes anything under one obol either free or unsellable.
  You pay the ceiling (`obolsToPay`) and you are paid the floor
  (`obolsEarned`); the station rounds in its own favour both ways.
- **The money belongs to the station, not the Merchant.** It lives on
  `Depot.accountObols`. The licence is tradeable, so handing it over hands over
  the balance too, and that is what makes the card worth stealing.
- **Goods arrive physically.** An order is paid for now and delivered later, as
  crates on a landing pad that anyone with a keycard can walk into.
- **The lights can go out.** A generator burns fuel every turn and takes the
  whole Depot down with it when the tank empties.
- **The room can kill you.** A turret, off by default, that reads faces.

Everything below describes the reworked system. `Character.depotDebt` is gone;
the line lives on `Depot.debtObols`.

## 0a. The moving parts

| Piece | Where it lives | Notes |
|---|---|---|
| Station state and tuning | `Depot` singleton, `id = 1` | `db/lib/depotState.js` — every mover is a locked clamp, per `lifeweb.js#bumpBlood` |
| The turret | `db/lib/depotTurret.js` | Weighted severity table, one column per armour tier |
| Crates | `db/lib/depotCrates.js` | Runtime `Tag` rows with `custom: true` |
| Per-turn upkeep | `db/lib/depotPass.js` | Fuel burn, shuttle clock, turret sweep |
| The console | `web/app/(app)/depot/`, `web/app/components/Depot*.js` | Cockpit strip + six tabs |
| GM tuning | `/gm/dev?s=depot` | `updateDepot` in `web/app/(app)/gm/dev/actions.js` |

## 0b. Who may do what

Three doors, deliberately different:

| Holder | Can |
|---|---|
| **Merchant's Licence** | Everything: order, call and send the shuttle, the ATM, the credit line, the generator, the turret. Must be standing at the Depot, and (except for the power switch) the generator must be running. |
| **Depot Keycard** | Read the console. Enter the landing pad. Open crates, including sealed ones. Operates nothing. |
| **Superadmin** | Read the console. |
| Anyone else | Bounced off `/depot`. |

The licence is checked, never the Merchant **role** — the licence is tradeable
and a role check would quietly break that.

## 0c. The generator

`Depot.generatorFuel` burns `fuelBurnPerTurn` every turn it runs and switches
itself off at zero. With it off, **nothing at the Depot works** — no ordering,
no shuttle, no ATM, no turret. The one exception is the power switch itself,
for the obvious reason.

Coal is the proper fuel (`coalFuel`, 50 by default); saltpeter is the fallback
and deliberately worse (`saltpeterFuel`, 15). At the shipped defaults a full
tank is five turns and one coal is two and a half, so the Merchant refuels
roughly every five turns and has to stay profitable to afford it. Overfilling
wastes the surplus rather than banking it.

`depotPowered(depot)` is the single predicate for "on". Fuel at zero is off
even if the switch says otherwise.

## 0d. The shuttle and the landing pad

The landing pad is a **real room** — a PRIVATE thread under the Depot's channel
gated on `depot-keycard`, authored in `docs/zones.yaml`. Membership is handled
entirely by `db/lib/roomAccess.js` and reconciled by the channel doctor; the
feature adds no access code of its own.

The cycle:

1. **Order** into a manifest. Obols leave the account now; the goods do not
   exist yet. That gap is the risk of the business.
2. **Call it down.** The manifest becomes crates in the landing pad's stash,
   and the shuttle is `DOCKED`. An empty manifest still brings it — he needs it
   down to load anything going up.
3. **Load and send it back.** The goods on the pad go up and come back as
   obols at their `sellablePrice`, converted once and floored. An **unopened
   crate is worth what is inside it**, priced off the live catalog — otherwise
   returning a shipment would silently annihilate it. Loose ⬢ in the stash
   stay where they are: the ⬢ Counter (§0g) is marginless and always open, and
   two rates for the same thing was a bug waiting to happen.
4. Or **it leaves on its own** after `shuttleMaxTurns` (6). A timed departure
   takes nothing with it — the crates stay on the pad. Selling is a deliberate
   act and an unattended shuttle should not empty the room.

`shuttleCooldown` is the gap between landing and being able to send it back —
a *departure* gate, not an arrival one. (`ShuttleState.INBOUND` is declared and
never written; calling it down lands it immediately.)

`shuttleTurn` is **never null**. It used to be set from `getOpenTurn()`, which
is legitimately null between advances, and a null clock made both timers read
"landed this turn" forever: send-up stayed inside its cooldown, the automatic
departure never fired, and re-calling was refused because the state was not
`AWAY`. Only SQL could free it. It floors to 0 instead.

## 0e. Crates

A shipment does not arrive as a tidy pile of tags. It arrives packed, in a
random number of crates, and somebody has to open them. That makes unloading a
job worth paying a Docker for, puts a delay between buying a pistol and holding
one, and means a crate left on the pad can be stolen.

**A crate is a `Tag` row created at runtime** with `custom: true`, so
`db:prune-tags` skips it (`db/lib/pruneTags.js`). Being a tag means crates get
carry weight (15 lb), transfers, room stashes and theft for free. The row is
deleted once nothing references it.

The manifest is printed on the crate, in exactly this format:

```
[SHIPMENT ID RV-4471-K]: Coal x 4 | Bandage x 6 | ML-23
```

Unless something in it ships sealed, in which case the whole crate reads:

```
[SHIPMENT ID RV-4471-K]: SEALED
```

...and only a Depot Keycard opens it. **One sealed line item seals the crate it
lands in**, so nobody knows *which* crate the dangerous thing is in — only that
one of them is worse news than the others.

**A non-stackable ware can only be ordered one at a time.** `CharacterTag` is
unique on character+tag, so a crate reading `ML-23 x 2` could only ever hand
over one pistol; the order is refused rather than silently clamped. Opening a
crate also records what actually landed, not what the crate claimed — a
non-stackable ware you already hold is reported as skipped rather than granted.

A ware ships sealed by setting `sealedShipping: true` in `docs/tags.yaml`. The
sync refuses it on a tag with no `depotPrice`, since the station cannot ship
what it does not stock. Currently sealed: the two firearms, the flamethrower,
Light Infantry Armour, Soporific, Phrygian Tears, the Amoeba Vial, the
Homunculus and the Illusion Crystal.

## 0f. The turret

The first automated harm mechanic in Bascinet. Nothing else in this codebase
rolls damage — injuries have always been GM-adjudicated (`HARM_CHARACTER`) or a
narrative Gambit outcome — so there was no armour model to extend. What it
borrows instead is the *shape* of `db/lib/cavingLoot.js`: a weighted draw whose
columns must sum to 1.

**It reads faces, not papers.** The turret spares exactly one thing: a
character whose **presented** name matches `Depot.merchantFace`. Not the
licence, not the keycard, not the role. So:

- A concealed Merchant is shot by his own gun.
- A Docker who steals the card is still shot.
- Anyone who comes back wearing the Merchant's name walks past it.
- With no face on file it fires on **everyone**, so **arming it is refused
  until a GM sets the face**. That was a one-click suicide with a GM-only cure:
  disarming needs you standing in the Depot, and walking in rolls the gun on
  you first.

It fires **on entry** (`db/lib/locationMove.js`, before the Discord guard —
being shot is a database fact) and **again at the end of every turn**
(`db/lib/depotPass.js`), the way Caving rolls do. It only fires when the
generator is running.

**Armour picks a column, not a step.** A vest does not downgrade one wound by
one rung; it moves the whole distribution. Best-equipped-armour-first, and only
`equipped` armour counts.

| Tier | graze | minor | deep | grievous | dying | dead |
|---|---|---|---|---|---|---|
| No armour | 10% | 25% | 30% | 20% | 10% | 5% |
| Padded | 25% | 30% | 25% | 13% | 5% | 2% |
| Mail | 30% | 30% | 23% | 11% | 4% | 2% |
| Plate | 38% | 30% | 19% | 9% | 3% | 1% |
| Salvage Plate | 45% | 29% | 16% | 7% | 2% | 1% |
| Light Infantry | 55% | 28% | 12% | 4% | 1% | 0% |
| Energy Shield | 85% | 10% | 4% | 1% | 0% | 0% |

Light Infantry Armour being the best column is the catalog's own claim about
it — "nothing forged in Ravenheart stops a bullet". The turret is where that
line finally means something mechanical.

A GM retunes any column from `/gm/dev?s=depot`. **The save is refused** if a
column does not sum to 1 — a broken die is a typo, not a preference, and
silently normalising it would hide the mistake behind subtly wrong odds for a
month. A column that somehow reaches the database invalid (a hand-edited row, a
restored backup) is ignored at roll time in favour of the shipped one.

A `dead` result goes through `db/lib/characterDeath.js#applyDeathToRow`, so it
gets a corpse, an archive line and the Discord role owed back like any other
death.

## 0g. The bank

The Merchant is the only faucet of currency in the game.

- **The ATM** moves obols between `Depot.accountObols` and physical `obol`
  tags. It is the only door coins enter and leave the world through, which is
  what makes lending something only he can do.
- **The Company's line** (`Depot.debtObols`, capped at `creditCapObols`, 60)
  is drawn and repaid in obols. Drawing puts money in the account. The cap is
  **refused** rather than clamped, so he is told he hit the ceiling. Nothing in
  code punishes a standing balance — the Company is not code.
- **The ⬢ Counter** converts his own Resources to obols and back, **at one flat
  rate with no spread**. He does not charge himself a margin to use his own
  till. Denominated in whole obols so it is exact: N ¢ is always N × `obolRate`
  ⬢ in both directions, and there is no rounding for a margin to hide in.
  This replaced an earlier rule that ⬢ could only become obols by riding the
  shuttle up — one counter, one rate.

Starting obols are granted through `docs/roles.yaml` using a `Name xN` suffix
(`Obol x5`), parsed by `db/lib/startingTags.js`. Baron 5, Hand 2, Esculap 2,
Baroness / Heir / Meister 1 each, Merchant 20.

## 0h. The console

`/depot`. A cockpit strip that never scrolls away — greeting, balance,
generator gauge, shuttle state, turret lamp — over six tabs: **Order**,
**Price List**, **Hold**, **Bank**, **Station**, **Ledger**.

The strip is pinned because all four of those facts matter whichever job you
are doing; hiding the generator behind a tab is how you order three hundred
obols of coal onto a dead one.

The **Ledger** reads existing `Request` rows of the eight `DEPOT_*` types
rather than a ledger table of its own — those rows already snapshot what moved,
already appear on the GM desk, and already undo.

`DEPOT_SHIP` and `DEPOT_CRATE_OPEN` have **no undo handler**, deliberately.
A shuttle that went up cannot be recalled and its cargo no longer exists; an
opened crate has scattered its contents into an inventory that has moved on.
The rows stay visible and a GM corrects by hand.

## 1. What it is

A shuttle parked at Customs, in the Caves, tethered to an orbital station the
Merchant's sponsors own. It is the only route in or out of Ravenheart for
anything manufactured, and it is not a public shop: **only the Merchant trades
with it.** He buys imports into his own inventory at the station's price, then
sells them on to Ravenheart at whatever he can get.

Stock is infinite. Price is the only limiter, and it is meant to be
prohibitive — a working person saves for a Boombox and never sees a pistol.

| | |
|---|---|
| Page | `/depot` (`web/app/(app)/depot/page.js`) |
| Location | `depot` — its own room in the Caves since the Bascinet 2 map, where it used to be a paragraph inside the Customs description and the gate was the whole Caverns zone. Reading the list works anywhere; trading needs him standing in that one room. |
| Gate | the `merchants-license` tag, **not** the Merchant role |
| Requests | `DEPOT_BUY`, `DEPOT_SELL`, `DEPOT_CREDIT` — auto-applied, GM-reviewed, undoable |
| Constants | `db/lib/depot.js` |

## 2. The Licence

`merchants-license` is the whole permission model. Holding it opens `/depot`,
puts the Depot on the nav rail, and is re-checked inside every server action.
The Merchant starts with it.

It is `tradeable: true` on purpose. Handing it over really does hand over the
Depot — and, per its own text, the escape route and the turret's goodwill. That
is a decision worth being able to make, and it is why the gate is the tag and
never the role: a role check would quietly break the trade.

There is no GM half to this page. A GM with no licensed character is redirected
like anyone else; `/gm/dev` already does everything they would want here. The
one exception is a **superadmin**: they get the page read-only — the live
price lists, no held counts, no credit line, every control disabled — and the
Depot rail item so they can reach it. Every trade action still re-checks the
licence server-side, so the view grants nothing.

## 3. Buying

What the station charges him, per unit. Almost every ware is
`purchasable: false` — **for those, the Merchant is the only source in the
game**, which is the whole point of the seat.

Six are also creation picks, marked in the Notes column: `jewelry` (2 pt),
`instant-camera` (2), `sword-cane` (7), `surgical-equipment` (9),
`poison-snooper` (9) and `neoclassic-rw10` (14). All six are
`purchasableAfterStart: false`, so there is still no mid-game second source —
you bought one on day one or you buy one off him. The Poison Snooper is the
deliberate addition of the six: knowing which cup is poisoned, over and over,
is worth three-quarters of a starting budget, and its ⬢ price stays steep so
buying one mid-game is still a real decision.

| Ware | ⬢ | Sells back | Notes |
|---|---|---|---|
| `tea` | 3 | 1 | Cures minor nerve effects — `afraid`, `panic`. Adjudicated, not automated. |
| `coffee` | 3 | 1 | Consumes into `caffeinated` (2t) |
| `firecracker` | 4 | 1 | |
| `alcohol` | 5 | 4 | He stocks the local brew too |
| `sweets` | 5 | 2 | Consumes into `ate-meal` |
| `honey` | 5 | 2 | Consumes into `ate-meal` |
| `sky-lantern` | 5 | 2 | |
| `distilled-coca` | 11 | 10 | Also a Skilled brew, at 4 ⬢ — see §4 |
| `boombox` | 13 | 5 | |
| `sake` | 14 | 2 | Consumes into `tipsy`. Priced level with `ravenheart-red`'s 14 — its only price, since it has no `depotPrice` of its own |
| `whip` | 14 | 6 | Equippable |
| `censer` | 15 | 6 | |
| `jewelry` | 16 | 8 | Also a 2-pt creation pick |
| `black-body-bag` | 27 | 11 | |
| `poison-snooper` | 27 | 12 | **The exception:** also buyable at creation, 9 pt |
| `monkey` | 27 | 11 | |
| `sword-cane` | 28 | 12 | Also a 7-pt creation pick |
| `instant-camera` | 32 | 14 | Also a 2-pt creation pick |
| `microscope` | 35 | 15 | |
| `phrygian-tears` | 36 | 20 | Also a Skilled brew, at 4 ⬢ — see §4 |
| `surgical-equipment` | 38 | 17 | Also a 9-pt creation pick |
| `light-infantry-armour` | 41 | 18 | Stops a bullet. Nothing forged here does. |
| `hound` | 46 | 20 | |
| `soporific` | 55 | 24 | Inflicts `asleep` (1t) |
| `amoeba-vial` | 64 | 28 | |
| `illusion-crystal` | 73 | 32 | |
| `homunculus` | 91 | 40 | |
| `antibiotics` | 100 | 44 | Cures every stage of infection |
| `steam-automobile` | 164 | 72 | Fast-travels like a Horse — see below |
| `neoclassic-rw10` | 164 | 72 | Neoclassic R&W10. Also a 14-pt creation pick. |
| `ml-23` | 182 | 80 | A 9mm pistol |
| `motorcycle` | 209 | 92 | Caving loot he also imports |
| `flamethrower` | 237 | 104 | Caving loot he also imports |

Three of these need code, not just catalog data:

- **`steam-automobile`** is in `FAST_TRAVEL_SLUGS`
  (`web/lib/tagRequests.js`) alongside the two horses. Same request and the
  same once-a-day limit, which `fastTravelRequestImpl` really does enforce
  along with adjacency. "Easily visible" and "not through the caves" are
  **adjudicated, not enforced** — exactly as they already are for the two
  horses, whose catalog text says the same thing. Worth knowing, since he buys
  the thing standing in the Caves.
- **`coffee`** consumes into `caffeinated`, a status tag that exists only for
  it. **`soporific`** does *not* consume into `asleep`, and that is on purpose:
  you administer it to somebody else, so a self-targeting grant would put the
  drinker to sleep instead of the victim. It is spent by a Move and a GM
  applies `asleep` to whoever it happened to — the same "empty **Consumes
  into**" convention `BREWING.md` documents for a thrown flask or a poison.
  Nothing else in the catalog grants `asleep`.

The rest of the caving loot table stays found-only. The Motorcycle and the
Flamethrower are the only two artifacts the station will sell, on the reasoning
that it has no trouble getting either — it is Ravenheart that has trouble
hauling one up out of the Caves.

**Almost nothing here is `craftable`.** That is the point: if Ravenheart could
make it, importing it would be pointless. The three exceptions are all brews —
`alcohol`, `distilled-coca` and `phrygian-tears` — which he stocks for a
Merchant who would rather not wait on a brewer. Each is priced well above what
brewing one costs, and that gap is the market a brewer sells into (§4).

### Laboring tools

Two of the tools in `LABORING.md` §5 are Merchant stock rather than smith work:
`fishing-rod` at 12 and `trapping-gear` at 26. Both are craftable too, so the
depot price is the impatience premium, not a monopoly. The Plow is deliberately
**not** stocked — it is smith work, and the horse it needs is the real cost.

## 4. Selling

What the station pays him, per unit. This is the other half of the loop —
players make things, he buys them for whatever he can talk them down to, and
the difference between that and the column below is his margin. Nothing in code
sets what he pays a player; that is his negotiation.

Four bands, about 106 tags in total:

| Band | Priced at | Examples |
|---|---|---|
| Brews | build cost + margin; the batch recipes get a thinner one | `ravenheart-red` 14, `forgiveness` 18, `bliss` 3, `dreamers-draught` **60** |
| Smithed gear | its own `resourceCost` + a turn-scaled markup — see below | Dead Simple 4, Simple 9, Moderate 22, High Quality 42, Exceptional 61, Gunpowder 59 (Bore Pistol 45) |
| Cave and bulk goods | unchanged from the Caves Update | `graga-sac` 8, `cave-fungus` 3, `saltpeter` 3, `skinless-brain` **40** |
| Salvage and valuables | what portable wealth is worth | `jewelry` 8, `heirloom` 12, `old-coin` 1, `painting` **48** |

**Three numbers moved in the Butchering change** (`CORPSES.md`), and they are
off the bands above on purpose. `skinless-brain` went 10 → **40**: the old
price read the Skinless as a slightly harder Graga, and they are not — they are
the only ingredient in the catalog that has to be talked out of being a person
first, and the number says so. `dreamers-draught` went 16 → **60**, staying
above its own ingredient, because the point of that recipe is that the brain is
the cheap part. `painting` went 60 → **48**, a flat 20% nerf; over its 4 turns
that is 12 ⬢/turn, still the best rate a craftable pays.

**`human-flesh` is deliberately not sellable at all.** Butchering is free and
every death mints a corpse, so a price on it would be a code-enforced ⬢ faucet
hanging off a free action. It stays `tradeable`, so the market for it is other
players.

**Smithed gear's markup is `resourceCost + round(rate(skill) × turnsCost^1.3)`, per item —
not a flat multiplier of the tier.** A flat "+1/3 of the tier" markup used to make
Exceptional (3 turns, `smithing-skilled`) pay out *worse* per turn than Moderate or High
Quality (1–2 turns, the same skill gate), and made Dead Simple's turn-free 4-a-turn cap
look like a strictly better business than ever touching the higher rungs. Two things now
have to be paid for on purpose, not by accident: the skill it took to unlock the tier, and
the turns sunk into one item once you're there.

`rate(skill)` scales with the cumulative point cost of the skill chain a tier is gated
behind:

| Skill gate | Cumulative pt | Rate | Why |
|---|---|---|---|
| `crafting` / `smithing` | 5 | 2 ⬢/turn | Dead Simple and Simple both sit here |
| `smithing-skilled` | 10 | 5 ⬢/turn | Moderate, High Quality, Exceptional |
| `smithing-gunpowder` | 19 | 9 ⬢/turn | Gunpowder — nearly double the skill investment, so nearly double the rate |

The `turnsCost^1.3` exponent is what makes rate-per-turn climb *inside* a skill bracket
too, not just jump between brackets — a deliberate, mild superlinear curve so tying up
more turns in one item is rewarded a little more than proportionally, not just
proportionally. Within `smithing-skilled` alone: Moderate (1 turn) nets 5 ⬢/turn, High
Quality (2 turns) nets 6, Exceptional (3 turns) nets 7 — strictly increasing, never flat
and never falling, the way the old linear version let Exceptional under-pay Moderate.
Across the whole ladder the curve reads 2 → 5 → 6 → 7 → 11 ⬢/turn, so every rung —
whether the jump is more skill or more turns — pays strictly better than the one before
it. 1.3 is a judgment call, not a derived constant: high enough to feel like a real
reward for committing turns, low enough that Exceptional (21 ⬢ profit) doesn't dwarf
Moderate (5 ⬢ profit) the way a steeper exponent would. Re-tune it here first if a tier
ever needs adjusting, rather than hand-editing one item's `sellablePrice`.

**Dead Simple is the one exception, kept outside the formula on purpose.** It costs 0
turns, so `rate × 0^1.3` would price it at raw material cost with no margin at all.
Instead it keeps a flat token markup (+1 ⬢), and its rationing stays the 4-unit/turn cap
(`SMITHING.md` §2) rather than a turn cost — it was never meant to compete turn-for-turn
with the ladder above it, so it does not need to clear the same per-turn bar.

Two items break from their tier's baseline `resourceCost` and price accordingly: Bore
Pistol (20 ⬢ to make, cheaper than Musketoon/Bomb's 31) still prices to 45, not 59 —
same relative gap as the tier. A materials-cost rebalance dropped the Gunpowder tier's
`resourceCost` ~15% (37→31, 23→20) without re-deriving `sellablePrice` off the formula,
so both sit a little above what a fresh `resourceCost + rate × turnsCost^1.3` run would
give today — a slightly wider margin for the smith, on purpose, not drift.

`ravenheart-red` is the top of the ordinary brews on purpose. It costs 4 ⬢ and
needs no ingredient at all, so a Skilled brewer with nothing else going on can
make 10 ⬢ a turn off it — and it is the one thing on this planet an offworlder
actually wants. The tag's own description has called it "Ravenheart's only
export" since long before any of this was wired up.

**Two brews are on both tables.** `phrygian-tears` and `distilled-coca` cost 4 ⬢
to brew and 40 and 12 to import. That is not an error and it is not a loophole:
the import price is what you pay for having no brewer, and the gap is exactly
the market a brewer sells into.

A buy price at or below a sell price would let anyone with a licence print ⬢ in
a loop. `db/lib/syncTags.js` warns on every sync if that ever inverts.

### The open hole in this, and it is a real one

That warning guards the *Depot's own* two prices. It does not guard the other
loop, which runs through crafting:

> **Nothing in code charges a recipe.** `BREWING.md` says so outright — not the
> ⬢, not the turns, not the skill, least of all the ingredient. `ADD_TAG` takes
> `resourcesSpent` **from the client**, and there is no per-turn cap on filing
> one.

So a Merchant who also takes Brewing (Skilled) can file `ADD_TAG` for
`ravenheart-red` declaring 0 ⬢ spent, sell it here for a code-enforced 14 ⬢,
and repeat — unbounded within a single turn. 71 craftable tags are sellable,
topping out at 49 ⬢ for the Gunpowder rung.

Until the Merchant Update the sell side was inert data, so an uncharged recipe
only ever produced a *tag* a GM could look at. Pricing the output in code is
what turned it into a faucet. The only thing standing in front of it today is
a GM reading the `ADD_TAG` queue, which is the same backstop crafting has
always had — but it is now guarding money rather than goods.

Two ways to close it, neither taken yet: charge the recipe's ⬢ in code inside
`addTagRequestImpl`, or cap `DEPOT_SELL` per turn. The first is the real fix
and the larger change.

## 5. The credit line

**Superseded by §0g.** The line is now denominated in obols and lives on
`Depot.debtObols`, capped by `Depot.creditCapObols`. `Character.depotDebt` was
dropped in the rework — the licence is tradeable, so the debt travels with the
station rather than with whoever is holding the card.

Everything else about it is unchanged: draw puts money in the account, repay
takes it back out, the cap is refused rather than clamped, and nothing in code
punishes a standing balance. It is visible to GMs, and that is the enforcement.

## 6. Retail

Selling to a player is **not** on this page. It is the existing `TRANSFER_TAG`
and `TRANSFER_RESOURCES` pair on `/character`, which requires both parties in
the same zone (`FACTIONS.md` §3b).

That friction is the design. He sits at Customs at the bottom of the Caves, so
either the buyer comes down to him or a Docker carries the goods up — which is
the entire reason the Docker seat exists. If it ever proves too much in play,
the fix is a courier request, not loosening reach.

## 7. Where a player reads this

The **Merchant** document (`docs/documents.yaml`, key `merchant`) carries the
price bands and how the counter works, and goes to the Merchant and his Dockers.
The role charter in `docs/roles.yaml` carries the pitch. What a ware *does*
lives in the tag's own description and shows on hover, the same way a brew's
effect does — don't restate it in the document, it is already two places.
