# The Godard Factory

Ravenheart's only real export, and the four verbs that make it: **Extract**,
refine, **Package**, sell. Read this before touching `db/lib/godflesh.js`,
`db/lib/refinery.js`, `db/lib/babble.js`, `db/lib/visionDecayPass.js`, the
`refinery:` / `godflesh:` Location attributes, or the two `EXTRACT_GODFLESH` /
`PACKAGE_ITEMS` request types.

Related: `LABORING.md` (everything a labor normally does), `CARRY.md` (crates
and the wagon), `DEPOT.md` (what a cube is worth), `REQUESTS.md` §3 (the two
new types).

## 1. Why it exists

The town's labor feeds Ravenheart and produces no surplus. Before this, nothing
in the game did. The Keep's warchest, the Merchant's business and every obol in
circulation now trace back to one wooden warehouse standing in a shallow lake
in the Marshes, staffed by people nobody counts.

That is the design as much as the economics: the money comes from the one place
on the map with no political weight at all.

## 2. The chain

```
marsh tile  --Extract-->  Godflesh  --labor at the Factory-->  8 Squeeze
                                     --Package-->  a crate at half weight
                                     --cart-->  the Depot  -->  obols
```

Every step is somebody's whole turn. A refugee alternates Extract and refine,
so about half their days are producing days — which is where the
"2.5 producing turns in 5" in §6 comes from.

## 3. Extract

`db/lib/godflesh.js` — pure, Prisma-free, modelled on `db/lib/depotTurret.js`.
The server action is `extractGodfleshRequest` in
`web/app/(app)/character/requestActions.js`.

- **Where.** Any Location carrying the `godflesh: true` attribute: the five
  open Marshes and the marsh Village. The attribute is the match, so no tile is named by
  slug anywhere in code (`db/lib/locationAttributes.js`).
- **What it costs.** The turn's Routine, filed through `fileAutoRoutine` like
  Craft, Bury and Engrave. Once per turn falls out of
  `@@unique([characterId, turnId])` rather than a counter.
- **What you need.** A `hatchet`, `battle-axe` or `chainsaw` **equipped**. A
  blade in a sack cuts nothing, the same rule armour follows at the turret.
- **The roll.** 1d6, DM'd whatever it says. Yield is 1, or **2** with a
  Chainsaw. A **6** adds one more on top of whatever you were getting.
- **The 1.** Rolls again on the injury table, and Armored Gloves decide which
  column — the whole distribution moves, not one step:

  | column | outcome |
  |---|---|
  | no gloves | Missing Fingers 0.45 · Mangled Hand 0.40 · Missing Arm 0.15 |
  | gloves | Minor Wound 0.75 · Deep Wound 0.25 |
  | gloves + body armour | Minor Wound 0.90 · Deep Wound 0.10 |

Gloves cost 3 ⬢ to craft and all three Factory roles start with a pair, so a
lost hand is nearly always somebody who took them off. That is the intended
reading, and it is why the DM says which column you were in.

Extract also refuses while Bound, Dying, Paralyzed or Catatonic — or mid
Seizure, which is the one it exists for. `requireFreeMove` checks only the turn
and the one-Action rule, so without that gate a man on the floor could wade
into the marsh with an axe.

The button **hides** off a marsh tile rather than greying. That is not a breach
of the metagaming rule in `web/app/components/actionRegistry.js` — that rule
forbids leaking who is standing near you, and where *you* are standing is
already yours. A permanently dead Extract icon in the Fortress would just be
furniture.

## 4. Refining — the one labor that pays in goods

`db/lib/refinery.js`, entered from `db/lib/laborAccess.js#resolveLaborRateFrom`.

Everywhere else a Labor resolves to a `"min-max"` range of ⬢ and a Location
with no `LocationYield` row cannot be worked at all (`LABORING.md` §3). The
Godard Factory has **no `yield:` block** and is worked anyway: `refinery: true`
is a second gate beside the yield rows, and the branch returns `tier:
"refining"` with a real `0-0` expression — real, because everything downstream
assumes an expression and `rollResourceRange` pays nothing on a failed parse,
silently.

- **The input** is one Godflesh, in the worker's hands **or** in any Room stash
  at the Location they can get into. `hasEquipmentInReach`'s predicate, so the
  Logistics Room serves the whole floor and nobody hauls a 28 lb lump around
  all day to prove they own it.
- **The output** is 8 Squeeze, and the Godflesh is consumed.
- No Laboring tag, no shift. It is work.
- No `laborBonus` applies. A refinery is not a coefficient.

**Auto-labor picks this up for free.** A refugee who files nothing refines,
which is what "nonstop production" means, and `db/lib/autoLaborPass.js` pays two
extra bulk queries for it — only when somebody is actually standing on a Factory
floor.

**Losing the race is not silent.** Three refugees and one lump in the Logistics
Room is the NORMAL case whenever the stash runs thin — the auto-labor pass
resolves everyone against a single bulk snapshot, so all three pass the gate and
only the first `dropRoomTag` wins. `applyRefinery` returns `{ empty: true }`
rather than null for exactly this, so the other two get "nothing to refine — no
Godflesh here" on their sheet and a `-#` line telling them why, instead of an
Exhausted tag and silence.

**Why it lives in `MOVE_EFFECTS` and not in the pass.** `read` can only see the
Action row, and whether a Labor was a *refining* one depends on where the
character stood. So `refined.apply` decides, and returns 0 at every other
Location. That is what lets it work from a bare row, which the hand-filed path
(`db/lib/stagedPush.js`, at turn close, nothing in memory) needs. Returning
`null` there would have been a real bug: `applyMoveEffects` falls back to the
`read` value when `apply` reports nothing, so every ordinary Labor in the game
would have been stamped `refined: 1`.

**Where you stood, not where you are.** It reads `Action.locationId`, stamped at
filing time, and only falls back to the live location for rows filed before that
column existed. `Action.zoneId` was not enough: a free zone move costs no Action
(`CARRY.md` §2a) and a Labor pays at turn close, so a character could file on the
Factory floor and walk out — or file in the marsh and walk in — and collect the
wrong thing either way.

## 5. Package

`packageItemsRequest`, gated on Packaging Equipment in reach. There are two in
the world — the Logistics Room floor and the Merchant's Cargo Bay — and it is
not craftable.

Up to **150 lb** of held goods, plus a line the packer types, become one runtime
`Tag`: `custom: true` and a `custom-` slug, exactly the shape
`db/lib/depotCrates.js` mints, so `db:prune-tags` skips it and no
`docs/tags.yaml` sync can upsert over it.

**The crate weighs half what went in**, rounded up, floor of 1. Depot shipments
now use the same arithmetic — `CRATE_WEIGHT_LBS = 15` is gone, and a crate of
obols no longer outweighs the obols.

**Unpacking needed no new code.** The crate is an ordinary `consumable` whose
`consumesInto` lists its contents, repeated per unit, so the Consume button
already on the sheet opens it. That matters: the Depot's own `openCrate` lives
on `/depot`, which a Banneret in the Marshes cannot reach.

A crate cannot go inside a crate. Halving twice is a free carry exploit, and it
would nest a `consumesInto` chain arbitrarily deep. Refused on both faces.

**The line on the side is not checked.** `[CONTAINS]: whatever they typed`. That
is the feature — it is how you smuggle something past a Cerberus, and the GM
desk says so out loud on the request row.

There is a second cap, on **count** rather than weight: `PACKAGE_MAX_UNITS`.
The weight cap does not bound the weightless, and a crate's `consumesInto`
repeats a slug per unit, so a crate of obols (0 lb, stackable, no ceiling) would
otherwise write an array as long as the pile.

**Undo goes to whoever is holding the crate**, not to the packer, and refuses
outright if the crate has already been opened. Both matter: the crate is
cargo — it gets handed over, carted and stolen — so returning the contents to
the packer would be a way to rob the person you sold it to, and restoring them
alongside an already-unpacked crate would mint 150 lb of goods out of nothing.

**Packaging Equipment is `tradeable: false`.** `removable: false` only blocks
the Destroy menu; while it was tradeable, anyone with a Factory Key could carry
the bench off or tip it into the Spillway, and there are exactly two in the
world with no recipe to make a third.

## 6. The numbers, and where they come from

**A cube weighs 20 lb; a crated cube weighs 10.** Working back from the target:
5 turns of production is ~2.5 producing turns, 3 refugees × 8 cubes × 2.5 = 60
cubes, and a Banneret with Horse + Cart carries 120 × (1 + 4) = 600 lb. 600/60
is 10 crated, 20 raw.

It checks out through the crate cap too: 150 lb packs 7 cubes into a 70 lb
crate, and 600/70 ≈ 8.5 crates ≈ 60 cubes. **One full wagon every five turns.**

A refugee's 8-cube day is 160 lb against a 120 lb cap, so they *cannot walk
their own output anywhere*. They stash it in the Logistics Room and the carry
pass handles the overflow. The cart and the silo are the business; that is
deliberate, not an oversight.

**A cube sells for 4 ⬢.** Farming at coefficient 1.0 with
`productionCoefficient` 0.93 pays 11–15 ⬢, midpoint 13; a factory day at the
authored 2.2× is ~28.6 ⬢ for 8 cubes, so 3.6 each, rounded to 4. A full wagon is
240 ⬢ — and since obols went 1:1 in 9/2026, 240 ¢.

Squeeze has no `depotPrice`. The station sells nobody a cube.

## 7. What a cube does to you

Both Godflesh and Squeeze are `consumable`, because somebody was always going
to try.

- **Godflesh** → Vomiting. It is dead meat from a marsh.
- **Squeeze** → **Seizure** (1 turn), which `expiresInto` **Stupid**.

`seizure` is in `INCAPACITATING_SLUGS` (`db/lib/incapacitation.js`), which in
one line gives it movement blocking, lootability and draggability. It is
deliberately **not** in `FINISHABLE_SLUGS` — nobody asked for executing the man
on the floor.

**Stupid is permanent and incurable.** No `requirement:` block at all, which is
what makes the Heal menu refuse to offer it. Its `desires.locks` shuts every
Desire in the game except the `alcohol` and `stupidity` families, which is why
the `stupidity` family exists at all: a character with nothing reachable has
been benched rather than changed, and there has to be *something* left. What is
left is Moonshine and going to look at the statues.

It also garbles everything they say. `db/lib/babble.js` composes into
`bot/src/lib/proxy.js` where `textCorrection.js` already sits, and preserves
length while destroying content — a long anguished paragraph produces a long
anguished noise. Deliberately **not** a cipher: there used to be one for
letters (`db/lib/gribble.js`, since deleted — paper replaced it,
`PAPERWORK.md`), and it was reversible by anyone holding the right tag, which
was right for a letter and wrong for this. There is nothing to decode here.

Worth knowing before you touch that path: `proxy.js` had no per-character tag
check at all before this, only the global `tupperAutocorrectEnabled` flag.

## 8. Moonshine, and going blind

`brewing-basic`, **0 ⬢**, and `requirement.items: [godflesh]` — the marsh gives
you the ingredient. Holding the Godflesh is the check and it is not consumed,
the same as every other enforced recipe (`BREWING.md` §1). That is safe here:
Moonshine sells for 3 ⬢ against farming's 11–15, so it is not an income tap, and
the Routine it costs is the throttle.

Drinking it grants Tipsy, **Blind Drunk** (2 turns, blocks Examine with no
corrective) and one **Damaged Vision**, which is permanent and stacks.

**At five, `db/lib/visionDecayPass.js` takes the whole stack and grants Blind.**
That tag already existed — −8, tier-7 cure, `removesInto: [night-blind]` — and
is reused rather than re-slugged. The pass is its own thing because nothing else
in the engine reads a stack *count* as a threshold: `expiresInto` fires off a
clock and knows nothing about quantities.

**Blind now actually closes doors**, which it did not before:

| door | file |
|---|---|
| the Look at button | `db/lib/examineVision.js` |
| the 🔍 reaction | `bot/src/events/messageReactionAdd.js` |
| working the Bird | `db/lib/bird.js#canReadLetters` |
| reading anything written | `db/lib/reading.js#readBlock` |

The last two are the interesting ones. Literacy and the eyes are asked as **one
question** so no caller can check half of it — and `readBlock` is the fuller
form, since it also catches Blind Drunk itself, Nearsighted with the spectacles
in a sack, and Sun Sensitivity outdoors at Dawn.

A blind recipient gets exactly what an illiterate one gets: the real letter, on
their sheet, as an object they can carry to somebody who reads
(`PAPERWORK.md`). **So Moonshine has a second cost now.** Five drinks and you
cannot read your own mail, your own orders, or the noticeboard in the Square —
and the game will not tell anybody watching whether it was the drink or the
letters you never had.

## 9. The Spillway

The Godard Factory's fifth room, and the only room in the game with
`Room.destroysContents`. Authored as `destroys: true` in `docs/zones.yaml`.

The seam is deliberately **`web/lib/requestEffects.js#giveTagTo` and
`db/lib/resourceTransfer.js#moveParty`** — the two choke points for putting
anything into a Room — rather than a branch in `transferRequest`. Nothing is
written, so nothing can be fished back out.

**There is a third writer into rooms, and it is excluded rather than routed
through the same seam:** `db/lib/roomStash.js#pickRandomPublicRoom`, which the
carry pass and corpse placement use to shed overflow. A destroying room is never
eligible. That is not a nicety — a refining shift makes 160 lb of Squeeze
against a 120 lb cap, so the overflow drop fires on the *intended* loop every
day, and one of the Factory's three public rooms is the trough. Tipping
something in has to stay a thing you do on purpose.

**Undo is the part that needed care.** A destroyed line records `destroyed:
true` on the effect, and both undos skip their receiving half: the Spillway
holds nothing, so the ordinary path would throw *"That room no longer holds
that"* (or fail the conditional balance write) and wedge the whole Undo. The
sender's end is still reversed, so a GM can hand the goods back — which is the
honest inverse, since the only thing that really happened was that somebody lost
something.

The room announces it as scenery like any other room event, through
`db/lib/roomAnnounce.js`, but with its own line: "leaves it here" would be a lie
about a trough.

## 10. Where the code lives

| Concern | File |
|---|---|
| The die, the yield, the injury table | `db/lib/godflesh.js` |
| Refining: reach, apply, revert | `db/lib/refinery.js` |
| The labor branch | `db/lib/laborAccess.js`, `db/lib/autoLaborPass.js` |
| The snapshot | `db/lib/moveEffects.js` (`refined`) |
| Both server actions | `web/app/(app)/character/requestActions.js` |
| Undo | `web/lib/requestEffects.js` |
| GM rows | `web/app/(desk)/gm/turns/RequestSections.js`, `web/lib/requestLabels.js` |
| Buttons | `web/app/components/actionRegistry.js`, `RequestActionsProvider.js` |
| Gates | `web/app/(app)/character/page.js` |
| Location attributes | `db/lib/locationAttributes.js` (`godflesh`, `refinery`) |
| Crates, both kinds | `db/lib/depotCrates.js#crateWeight` |
| Stupid's garble | `db/lib/babble.js`, `bot/src/lib/proxy.js` |
| Damaged Vision → Blind | `db/lib/visionDecayPass.js` |
| Spillway | `db/lib/parties.js`, `resourceTransfer.js`, `web/lib/requestEffects.js` |
| Constants | `PACKAGING_EQUIPMENT_SLUG`, `PACKAGE_MAX_LBS`, `PACKAGE_LABEL_MAX` in `db/lib/constants.js` |
| Geography, roles, papers | `docs/zones.yaml`, `docs/roles.yaml`, `docs/documents.yaml` |
