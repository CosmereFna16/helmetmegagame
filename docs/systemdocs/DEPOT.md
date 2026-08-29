# The Depot

Everything the Merchant buys and sells, with its real price. Price a new ware
off these tables, not by feel. If you change a number here, change the tag's
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
| Zone | `caverns` — Customs. Reading the list works anywhere; trading needs him standing there. |
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
like anyone else; `/gm/dev` already does everything they would want here.

## 3. Buying

What the station charges him, per unit. Almost every ware is
`purchasable: false` — **for those, the Merchant is the only source in the
game**, which is the whole point of the seat.

Five are also creation picks, marked in the Notes column: `jewelry` (1 pt),
`instant-camera` (1), `surgical-equipment` (4), `poison-snooper` (4) and
`old-45-revolver` (6). All five are `purchasableAfterStart: false`, so there is
still no mid-game second source — you bought one on day one or you buy one off
him. The Poison Snooper is the deliberate addition of the five: knowing which
cup is poisoned, over and over, is worth a third of a starting budget, and its
⬢ price stays steep so buying one mid-game is still a real decision.

| Ware | ⬢ | Sells back | Notes |
|---|---|---|---|
| `tea` | 3 | 1 | Cures minor nerve effects — `afraid`, `panic`. Adjudicated, not automated. |
| `coffee` | 3 | 1 | Consumes into `caffeinated` (2t) |
| `firecracker` | 4 | 1 | |
| `alcohol` | 6 | 4 | He stocks the local brew too |
| `sweets` | 5 | 2 | Consumes into `ate-meal` |
| `honey` | 5 | 2 | Consumes into `ate-meal` |
| `sky-lantern` | 5 | 2 | |
| `sake` | 6 | 2 | Consumes into `tipsy` |
| `distilled-coca` | 12 | 10 | Also a Skilled brew, at 4 ⬢ — see §4 |
| `boombox` | 14 | 5 | |
| `whip` | 15 | 6 | Equippable |
| `censer` | 16 | 6 | |
| `jewelry` | 18 | 8 | Also a 1-pt creation pick |
| `black-body-bag` | 30 | 11 | |
| `poison-snooper` | 30 | 12 | **The exception:** also buyable at creation, 4 pt |
| `monkey` | 30 | 11 | |
| `instant-camera` | 35 | 14 | Also a 1-pt creation pick |
| `microscope` | 38 | 15 | |
| `phrygian-tears` | 40 | 20 | Also a Skilled brew, at 4 ⬢ — see §4 |
| `surgical-equipment` | 42 | 17 | Also a 4-pt creation pick |
| `light-infantry-armour` | 45 | 18 | Stops a bullet. Nothing forged here does. |
| `hound` | 50 | 20 | |
| `soporific` | 60 | 24 | Inflicts `asleep` (1t) |
| `amoeba-vial` | 70 | 28 | |
| `illusion-crystal` | 80 | 32 | |
| `homunculus` | 100 | 40 | |
| `antibiotics` | 110 | 44 | Cures every stage of infection |
| `steam-automobile` | 180 | 72 | Fast-travels like a Horse — see below |
| `old-45-revolver` | 180 | 72 | Neoclassic R&W10. Also a 6-pt creation pick. |
| `ml-23` | 200 | 80 | A 9mm pistol |
| `motorcycle` | 230 | 92 | Caving loot he also imports |
| `flamethrower` | 260 | 104 | Caving loot he also imports |

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

## 4. Selling

What the station pays him, per unit. This is the other half of the loop —
players make things, he buys them for whatever he can talk them down to, and
the difference between that and the column below is his margin. Nothing in code
sets what he pays a player; that is his negotiation.

Four bands, about 106 tags in total:

| Band | Priced at | Examples |
|---|---|---|
| Brews | build cost + margin; the batch recipes get a thinner one | `ravenheart-red` 14, `ambrosia` 40, `bliss` 3 |
| Smithed gear | its `SMITHING.md` §2 tier + ~1/3 | Dead Simple 4, Simple 9, Moderate 22, High Quality 30, Exceptional 42, Gunpowder 49 |
| Cave and bulk goods | unchanged from the Caves Update | `graga-sac` 8, `cave-fungus` 3, `saltpeter` 3 |
| Salvage and valuables | what portable wealth is worth | `jewelry` 8, `heirloom` 12, `old-coin` 1 |

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

The Company advances the Merchant up to **60 ⬢** against the business, tracked
on `Character.depotDebt` and drawn or repaid from the Credit panel.

There is no interest, no schedule, and no penalty. If he takes out 60 he owes
60. Drawing past the ceiling is refused; everything else is allowed, including
sitting on the whole balance for the length of the game.

The cap is enforced by a conditional `updateMany` — the write is the check,
the same pattern and the same reason as `moveResources`. Both the apply and
the Undo move the tab by a **delta**, never by an absolute value, so they
compose in any order; an absolute write here silently lost one of two
concurrent draws, and left the tab negative when a repaid draw was later
undone. `creditAvailable()` clamps at both ends for the same reason: a
negative debt must never read as headroom above the ceiling.

**Nothing in code punishes a standing debt.** That is deliberate. The line is an
asset for doing the job, not a trap, and the enforcement is social: every draw
and every repayment files a `DEPOT_CREDIT` request, so GMs can see what he took
and judge what he did with it. Spend it on the town and nobody minds. Spend it
on yourself and the licence is a thing that can be taken away — by a GM, in
fiction, which is the only place that rule lives.

Two things this is **not**:

- It is not a loan system. The loans that matter are the ones *he* writes to
  other players, and those are a conversation plus an ordinary
  `TRANSFER_RESOURCES`. Usury is his best business and it is entirely
  unmechanised, which is what makes it interesting.
- It is not the Company's Silo. `Faction.silo` is the faction's money and is
  untouched by any of this; the line is advanced to him personally.

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
