# Weight, the free zone move, room stashes, and Transfer

What a character can hold, where they put the rest, and how it moves. This
doc owns `db/lib/carry.js`, `db/lib/carryPass.js`, `db/lib/roomStash.js`,
`db/lib/roomAnnounce.js`, `db/lib/mounts.js`, `db/lib/indoors.js`, the free
zone move in `db/lib/locationTravel.js`, the `room:` party kind, the merged
Transfer dialog and the Storage button. Related: `REQUESTS.md` (the two transfer request
types), `CHANNELS.md` §4 (Rooms), `MAP.md` §3 (the travel gate),
`TURN-ENGINE.md` (the carry pass), `TAGS.md` §5 (`carryMultiplier`).

## 1. The caps

A character carries two loads against two caps, both live on `/gm/dev`:

| Load | Counts | Base cap |
|---|---|---|
| Weight | `Tag.weightLbs` × quantity, over every `tradeable` tag. Three things weigh nothing: **Assets** (a horse carries itself, a house does not move), **untradeable** items (the Quickened Nerve Braid grafted into your neck), and everything that was never cargo — skills, injuries, statuses, beliefs. | `GameConfig.carryWeightLbs`, default 120 |
| ⬢ | `Character.resources` | `GameConfig.carryResourceCap`, default 25 |

Both caps are multiplied by every **active** `Tag.carryMultiplier`,
multiplicatively: Strong ×1.1, Pack Mule ×1.5, Cart ×5. Results are floored.
Neither stacks, so the product is per row.

**Active means equipped, for anything equippable.** A Cart you are not pulling
hauls nothing, so its multiplier only counts while `CharacterTag.equipped`
(§3). Strong and Pack Mule are bodies rather than vehicles, are not
`equippable` at all, and so always count. `multiplierApplies()` tests
`Tag.equippable` rather than listing slugs, which keeps the rule in the catalog
where the rest of a tag's behaviour lives.

`db/lib/carry.js` holds the math — `carryMultiplier`, `carryWeight`,
`carryCaps`, `carryHardCaps`, `carryAdmits`, `carryStatus` — with no prisma and
no I/O, so `/character` can render "84 / 120 lb" without dragging the barrel
into the client bundle. The cap on that row carries a `title=` breakdown: the
base, then a line per active multiplier.

## 1a. The weight bands

**Price an item off this table, not by feel** — the same discipline the point
scale gets in [`TAGS.md`](TAGS.md) §4a. `db/lib/syncTags.js` throws if a
tradeable `items` tag omits `weight:`, so new gear cannot arrive weighing
nothing.

| Band | lb | Examples |
|---|---|---|
| Trivial | 0.5 | ring, letter, vial, coin, key |
| Light | 2 | knife, meal, tonic, flask, hand tool |
| Medium | 5 | sword, helm, lantern, fishing rod |
| Heavy | 12 | crossbow, shield, greatsword, trap |
| Very Heavy | 28 | mail shirt, breastplate, pavise |
| Massive | 55 | plate armor, a creature's corpse |
| Immense | 100 | workshop equipment, a motorcycle |

At the default 120 lb a full harness (55) plus sword, dagger and shield (17.5)
plus meals and kit leaves perhaps forty pounds spare. That is the intended
shape: you can do the knight thing, and not much else.

**`{carry:slug}` in a tag description** renders the sentence Bascinet wrote,
computed from the live caps: "You can carry 5 more item tags, and 12 ⬢." Pack
Mule and Cart both end with it. `getCarryReference` in `web/lib/referenceData.js`
pre-formats one line per multiplier tag, streamed from the root layout into
`CarryProvider.js`; `RichText.js` and `ChipText.js` render it as plain text.
The multiplier lives once, in `docs/tags.yaml`, and the description only names
its own slug.

## 2. Over the cap, and the ceiling past it

There are two lines, not one.

| Load | What happens |
|---|---|
| ≤ cap | fine |
| cap → 1.5× cap | it lands; `overburdened` is granted |
| > 1.5× cap | **it cannot be yours at all** |

`HARD_CAP_RATIO` in `db/lib/carry.js` is that 1.5, derived from the cap rather
than stored, so a GM raising the base moves both lines together.

**The ceiling bites in two different places**, because things arrive in two
different ways:

- **Deliberately** — a hand-over through Transfer. `carryAdmits()` refuses it
  before it lands, with a sentence the caller hands straight to the player.
  It has to: otherwise handing someone 300 lb would land, and then shed a
  random slice of what they were *already* carrying onto a public floor where
  anyone could take it. The other deliberate routes (Craft, `/store`, a Depot
  buy, Loot, a stash pull) do **not** call it yet — those are self-inflicted
  rather than a griefing vector, so today they land and shed. Wiring them is
  owed work.
- **Involuntarily** — a Labor payout (which is ⬢: `LABORING.md`), Caving loot,
  a GM grant, a `consumesInto` chain. It lands, and then `settleCarry` sets the
  excess down in a random public Room where they stand. This is the farmer who
  reaps more than they can carry: past the cap they are Overburdened, past the
  ceiling the rest is simply on the ground.

### What Overburdened costs

Being over the cap **zeroes your free zone moves** (§2a). It is no longer a
refusal: an overloaded character can still cross into another zone, they just
pay their Move to do it, and cannot then act. Only the mover is affected — the
dragged are corpses and the helpless — and `MOVE_CHARACTER` is not gated at
all.

The tag itself (`docs/tags.yaml`, `OVERBURDENED_SLUG` in
`db/lib/constants.js`) is granted the moment you are over either cap and
cleared the moment you are back under, never by a player and never on a clock.

## 2a. The free zone move

Crossing a zone used to always spend your Move, with a mount buying one extra
crossing per *day*. Now:

- Everyone gets `GameConfig.freeZoneMovesPerTurn` crossings a turn, default 1.
- An **equipped** mount adds one, and it refreshes every turn — a horse carries
  you at Dawn and again at Dusk.
- Overburdened sets the allowance to **0**.
- Past the allowance, a crossing files the `MOVE` Action as it always did.
  Once you have acted, you cannot cross.

So a peasant walks Town → Forest for nothing, spends their Move to reach the
Fortress, and the way back waits for the next turn. That is the whole model.

`Character.zoneMovesTurnId` + `zoneMovesUsed` track it, claimed by a
conditional `updateMany` whose WHERE is the check, so two tabs cannot both
spend the last one. A differing turn id resets the counter in the same
statement, so nothing ever sweeps the field. `freeZoneMoves()` and
`freeMovesLeft()` live in `db/lib/locationTravel.js`; the sheet shows the
number and Discord's Travel confirm says what the hop will cost before you take
it.

## 3. Mounts, carts, and indoors

`horse`, `steam-automobile` and `cart` are **equippable**, and give nothing
while stowed — no carry multiplier, no extra zone move, no passenger seats.
They compete for the same six `GameConfig.equipSlots` as armour and weapons,
which is the point: a cart should cost you something to keep out.

A **connection** can keep a mount out too — `on_foot: true`, which refuses a
mounted character rather than parking them on arrival (`MAP.md` §2c). The two
are complements: `indoors` covers a place, `on_foot` covers a way in.

A Location marked `indoors: true` in `docs/zones.yaml` — the Cathedral, the
Sanctuary, the Inn, the Keep, the Undercroft, the Factory — is a place you walk
into, and you do not bring a horse into a chapel. On arrival
`db/lib/indoors.js#parkMountsIndoors` unequips them and DMs the character;
`toggleEquip` refuses to put them back on while they stand there. The anchor
message says so in its own `-#` line, written by `syncZones` and hashed with
the rest of the body, so it appears once and never again.

The parking happens **before** the settle, so the reduced cap is what the
settle sees, and Overburdened goes on in the same pass. Nothing is dropped for
it — see §4.

## 4. Settlement: pull-based, post-commit

`settleCarry(prisma, characterId)` is the one function that makes a sheet agree
with its caps. It is **pull-based** — it recomputes from the current row
rather than being told what changed — for the same reason
`roomAccess.js#syncCharacterRoomAccess` is: the writers that change what a
character holds are many and scattered, ten of them bypass
`tagWrites.js#dropCharacterTag` with a raw `deleteMany`, and the ⬢ half moves
through a wholly different set. A push from any one of them would miss the
rest. And it is **post-commit**, never inside a caller's transaction, because
an overflow drop has to talk to Discord.

It runs, in this order, at:

- **Every web writer that touches tags or ⬢**, through
  `web/lib/afterInventoryChange.js`: settle → re-read the row → narrowcast
  sync → room-access sync → `deliverCarryDrop` in `after()`. That order is
  the rule: a drop can take a private-room key off the sheet, so membership
  must be recomputed from the post-drop holdings. Every request action in
  `requestActions.js`, the Depot's three, `/store`, the GM grant/revoke
  surfaces, the Dev Panel, `gmTransfer.js`, and — once, generically — the
  desk's `resolveRequest`, over every character id it can find on the
  request's effect. That last one keeps REQUESTS.md's promise that adding a
  type costs one `REQUEST_EFFECTS` entry.
- **Every arrival**, in `db/lib/locationMove.js#applyLocationMoveSideEffects`,
  immediately before the room-access sync and immediately after the mounts are
  parked (§3). This is the hook that retries a deferred drop (§5) and settles
  Caving loot picked up on the way in.
- **The bot's `/heal`**, beside its existing room-access sync.
- **Turn close**, as the `carry` pass (`db/lib/carryPass.js`), after `hunger`
  and before `lifewebDecay` so it sees the final sheet: Labor payouts, staged
  pushes, the expiry sweep and the ⬢ upkeep all happen earlier in the close
  and none of them may settle in place. One transaction per character, drops
  returned to `runSideEffects` rather than sent. Caving loot granted at turn
  open is settled by the next close or the next inventory action, whichever
  comes first.

Returned, never sent: `settleCarry` hands back
`{ characterId, over, granted, removed, drop }` and `deliverCarryDrop` does the
Discord half — the DM and the aliased room line (§6).

## 5. The overflow drop

**Drops are acquisition-driven, and only acquisition-driven.** Nothing comes
off a sheet because a cap SHRANK. Unequipping a cart at an inn door, handing
one over, a GM lowering the base cap — all of those make a character
Overburdened and no more.

**`Character.carryWeightSeen` / `carryResourcesSeen` are what tell the two
apart.** They hold the load at the last settle, and the shed fires only when
the load has **grown** past the ceiling — never when the cap fell beneath a
load that did not move. Without that comparison the settle cannot distinguish
"you picked something up" from "you put your cart down", and since §3 parks a
cart at every indoors door, the second reading would empty it onto the chapel
tiles every time you walked in. (The old watermark tracked the *multiplier*,
for the narrower job of noticing a Cart had left; this one tracks the load,
because the load is the thing the rule is actually about.)

The watermark advances to the post-shed load at the end of every settle —
**except** when the shed was deferred for want of a public room, where it is
deliberately left behind so the growth stays unclaimed and the next settle
retries. The write is a conditional `updateMany` on the previous pair, so two
settles racing on the same growth cannot both shed.

**What drops.** `drawDrops` shuffles the droppable units and takes from the
front until the excess is covered, shedding back to the **ordinary cap** rather
than to the ceiling — landing someone exactly on 1.5× would leave them one
letter from spilling again every turn. Weightless units are not candidates at
all, or the shuffle would spend its draws on letters while the anvil stayed
put. Two things are never in the bag: multiplier tags (dropping the Cart to fix
being over would shrink the cap again and loop) and equipped gear (being
disarmed by an overfull pack reads badly). Every ⬢ over the ⬢ ceiling spills
the same way. Audit: `carry_overflow_dropped` with the manifest.

**Nowhere to put it down** — unplaced, or a Location with no public room — and
the character simply stays over the ceiling with the watermark held back; the
next settle, on arrival or at turn close, retries for free. Audit:
`carry_drop_deferred`.

## 6. Room stashes

Every Room, public or private, holds unlimited ⬢ (`Room.resources`) and
unlimited tag stacks (`RoomTag`, one row per tag, `@@unique([roomId, tagId])`).
A room is where you put what you can't carry.

Two things a stash does differently from a pocket, both in
`db/lib/tagWrites.js`:

- `addToRoomStack` has **no non-stackable pin**. Two players can each leave
  their Longbow and the row goes to 2; the pin is a rule about what one
  character can hold, and `addToStack` re-applies it on the way out. That is
  also why `transferRequest` clamps a non-stackable pull out of a room to 1,
  and refuses it outright to someone who already holds one — a silent pin
  would move 1 while the request said 2, and Undo would take 2 back.
- `dropRoomTag`'s **decrement is the check** — a conditional `updateMany` —
  because a room is the game's first multi-actor inventory: two players in
  the same public room can pull the same stack in the same tick.

`expiresTurn` rides along from the holder's row (the earlier clock wins when
stacks merge), and the two blind sweeps in `db/index.js` shed `RoomTag` rows
the same way they shed `CharacterTag` ones — a stashed meal still rots.
`tagExpiryPass.js` stays character-only, so no *affliction* chain fires on a
floor. **One progression does reach a room stash**: a corpse left lying in one
goes off after three turns (`db/lib/corpseRotPass.js`, `CORPSES.md` §3). It
runs before the sweep and nulls the holding's `expiresTurn`, which is what
stops the blind `deleteMany` deleting the body instead of rotting it — so the
sweep never sees it and needs no exemption list.

One trap while you are in here: `RoomTag.tagId` cascades from `Tag`, but
`CharacterTag.tagId` is **RESTRICT**. Deleting a catalog row somebody is
carrying throws; clear the holdings first.

**Who can reach a stash.** Standing in the room's Location, and admitted to
the room — `roomAccess.js#accessibleRooms`, the same predicate the
thread-membership sync uses, so the transfer gate and the door can never
disagree about The Charon. `web/lib/transferReach.js#canReachParty` carries
the rule. Since the 9/2026 roster change every reach rule is Location-grain
(`db/lib/presence.js`), so a room and a person are judged at the same grain.

**A public stash is public.** Anyone at the Location can list its contents
(the Storage button, or the Transfer dialog) and walk off with them. That is
the point of a floor, and it is also a trace: the goods often say who passed
through. Private rooms leak nothing to anyone their key doesn't admit.

The stash survives the Dawn wipe (it lives in the database, not the thread),
is cleared by a Restart Game wipe (`wipeGameData` deletes `RoomTag` and zeroes
`Room.resources`), and cascades away with its Room when `db:sync-zones` prunes
one. Deleting a Tag from the catalog cascades its **room** stacks
(`RoomTag.tagId` cascades) but not the copies people carry
(`CharacterTag.tagId` is RESTRICT) — see the trap above.

## 7. Transfer

One dialog on `/character` (`TransferDialog.js`, mode `transfer` in
`RequestActionsProvider.js`) replaces the old Transfer Tag and Transfer
Resources buttons. From → To, any number of tag lines, a ⬢ amount, one reason.
From is **you or a Room** here; To is a person standing at your Location
who isn't concealed (web/lib/peopleHere.js — the same roster every picker
uses) or a Room here you can get into. Nothing is ever taken from another
person through Transfer, ⬢ included: you can't reach into their pockets, and
listing what's in them would show their hidden tags. Loot is how you take
from a person, and only a helpless one (REQUESTS.md §5b). The projection line
("After this you carry 84 / 120 lb and 6 / 25 ⬢") warns in accent when the
result is over a cap and submits anyway — going over is allowed up to the ceiling (§2).

Server side, `transferRequest` in `requestActions.js` resolves both parties
(`db/lib/parties.js`, which now knows `room:<id>`), checks reach once,
validates every line against the source's holdings, and in one transaction
files **one `TRANSFER_TAG` per line and one `TRANSFER_RESOURCES` for the ⬢** —
so a GM can still undo any single piece from `/gm/turns`. The two request
types are unchanged in kind; `TRANSFER_TAG`'s effect gained `from`/`to`
parties beside its legacy `fromCharacterId`/`toCharacterId` mirrors, and Undo
synthesizes the pair from the legacy fields for rows filed before rooms
existed. `moveParty` maps the three kinds through a table so `applyTransfer`'s
`(kind, id)` lock ordering is untouched.

After the commit: `afterInventoryChange` for every character end, the usual
DM to a receiving character, and for a room end an **aliased line in the
room's thread** (`db/lib/roomAnnounce.js`, the whisper poll's alias):
"*An old woman leaves Graga Sac ×3 and 12 ⬢ here.*" / "*A young man takes a
Lantern.*" The room learns an age and a presentation, never a name.

The two older actions, `transferTagRequest` and `transferResourcesRequest`,
still exist for their `LOOT` direction and for anything else that calls them.

## 8. The Storage button

Every Room's starter post carries one button, **Storage**
(`db/lib/roomStarterRow.js`, `room:storage:{roomId}`, hashed into
`Room.postHash` with the body so existing threads get it on the next
`db:sync-zones` and never again). `bot/src/lib/roomStorage.js` answers it,
ephemeral, to anyone standing in the room's Location, in Bascinet's format:

```
-# 15 ⬢ | **Tags**: Graga Sac ×3, Lantern, Cart
-# Nothing is stored here. ‡
```

Reading is free; moving things is the web's Transfer. A Discord select menu
caps at 25 options, which is why there is no native deposit/withdraw flow.

## 9. Where the code lives

| Piece | File |
|---|---|
| Math, `settleCarry`, `deliverCarryDrop` | `db/lib/carry.js` |
| Turn-close pass | `db/lib/carryPass.js`, wired in `db/index.js` (`TURN_PASSES` `"carry"`) |
| Random public room, manifest and Storage formatting | `db/lib/roomStash.js` |
| Aliased room line | `db/lib/roomAnnounce.js` (+ `aliasSubject` in `db/lib/concealedIdentity.js`) |
| Room stack writes | `db/lib/tagWrites.js#addToRoomStack` / `dropRoomTag` |
| `room:` party, balance table | `db/lib/parties.js`, `db/lib/resourceTransfer.js` |
| Reach | `web/lib/transferReach.js` |
| Corpses in reach (same rule) | `db/lib/corpses.js` (`CORPSES.md`) |
| Post-commit tail | `web/lib/afterInventoryChange.js` |
| Merged action | `web/app/(app)/character/requestActions.js#transferRequest` |
| Undo, party-shaped moves | `web/lib/requestEffects.js#takeTagFrom` / `giveTagTo` |
| Dialog, grid, readout | `TransferDialog.js`, `ActionGrid.js`, `StatusPanel.js`, `PartySelect.js` |
| `{carry:slug}` | `web/lib/referenceData.js#getCarryReference`, `CarryProvider.js`, `RichText.js`, `ChipText.js` |
| Free zone moves, travel gate | `db/lib/locationTravel.js#performLocationMove`, `freeZoneMoves`, `freeMovesLeft` |
| Mounts: what counts while equipped | `db/lib/mounts.js` |
| Parking at an indoors door | `db/lib/indoors.js`, `db/lib/locationMove.js` |
| Storage button | `db/lib/roomStarterRow.js`, `db/lib/syncZones.js`, `bot/src/lib/roomStorage.js` |
| Caps on `/gm/dev` | `web/app/(desk)/gm/dev/page.js`, `web/app/(app)/gm/dev/actions.js` |
| Constants | `OVERBURDENED_SLUG` in `db/lib/constants.js` |
| Load watermark | `Character.carryWeightSeen` / `carryResourcesSeen` |
| Weight bands | `weight:` in `docs/tags.yaml`; `Tag.weightLbs` |
