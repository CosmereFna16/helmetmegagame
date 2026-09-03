# Carry caps, room stashes, and Transfer

What a character can hold, where they put the rest, and how it moves. This
doc owns `db/lib/carry.js`, `db/lib/carryPass.js`, `db/lib/roomStash.js`,
`db/lib/roomAnnounce.js`, the `room:` party kind, the merged Transfer dialog
and the Storage button. Related: `REQUESTS.md` (the two transfer request
types), `CHANNELS.md` §4 (Rooms), `MAP.md` §3 (the travel gate),
`TURN-ENGINE.md` (the carry pass), `TAGS.md` §5 (`carryMultiplier`).

## 1. The caps

A character carries two loads against two caps, both live on `/gm/dev`:

| Load | Counts | Base cap |
|---|---|---|
| Items | Every **unit** of every `tradeable` tag. A stack of 4 Graga Sacs is 4. Skills, injuries, statuses, and untradeable items (the Quickened Nerve Braid grafted into your neck) are part of you, not cargo. | `GameConfig.carryTagCap`, default 10 |
| ⬢ | `Character.resources` | `GameConfig.carryResourceCap`, default 25 |

Both caps are multiplied by every held `Tag.carryMultiplier`, multiplicatively:
Pack Mule is ×1.5, Cart is ×5, both together ×7.5. Results are floored, so
(10, 25) becomes (15, 37), (50, 125) or (75, 187). Neither tag stacks, so the
product is per row. A Cart is itself tradeable and so occupies one of the
slots it grants.

`db/lib/carry.js` holds the math — `carryMultiplier`, `carryLoad`, `carryCaps`,
`carryStatus` — with no prisma and no I/O, so `/character` can render
"7 / 10 items" without dragging the barrel into the client bundle.

**`{carry:slug}` in a tag description** renders the sentence Bascinet wrote,
computed from the live caps: "You can carry 5 more item tags, and 12 ⬢." Pack
Mule and Cart both end with it. `getCarryReference` in `web/lib/referenceData.js`
pre-formats one line per multiplier tag, streamed from the root layout into
`CarryProvider.js`; `RichText.js` and `ChipText.js` render it as plain text.
The multiplier lives once, in `docs/tags.yaml`, and the description only names
its own slug.

## 2. Over the cap: Overburdened

**Nothing blocks going over.** A Labor payout, a Depot sale, a GM grant or a
gift can all push you past a cap, and they land. What happens instead is the
`overburdened` status tag (`docs/tags.yaml`, `OVERBURDENED_SLUG` in
`db/lib/constants.js`): granted the moment you are over either cap, cleared
the moment you are back under, never by a player and never on a clock.

While held, `db/lib/locationTravel.js#performLocationMove` refuses a **zone
crossing** with a plain `{ ok: false, reason }`. Hops inside the zone stay free,
so you can always walk to a room and put something down. Only the mover is
gated; the dragged are corpses and the helpless, and `MOVE_CHARACTER` is not
gated at all.

## 3. Settlement: pull-based, post-commit

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
  immediately before the room-access sync. This is the hook that retries a
  deferred drop (§4) and settles Caving loot picked up on the way in.
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
Discord half — the DM and the aliased room line (§5).

## 4. Losing a Cart: the overflow drop

Lose a Cart or a Pack Mule for any reason — handed over, looted, sold to the
Depot, stashed, revoked, removed — and if you are now over a cap, the excess
falls into a **random public Room at your Location**.

How the settle notices. `Character.carryMultiplierSeen` holds the multiplier
product at the last settle, ×1000 as an integer so "has it shrunk?" is an
exact comparison. Only the multiplier is persisted, never the derived cap: a
GM lowering `carryTagCap` from 10 to 8 must make people Overburdened, not dump
a hundred inventories onto the floor.

| `now` vs `seen` | over? | what happens |
|---|---|---|
| `now >= seen` | any | `seen = now`; grant or clear Overburdened |
| `now < seen` | no | `seen = now`; clear Overburdened |
| `now < seen` | yes, public room here | claim `seen = now`, drop, DM + room line |
| `now < seen` | yes, nowhere to drop | leave `seen`, grant Overburdened, audit `carry_drop_deferred` |

The claim is a conditional `updateMany` on `carryMultiplierSeen` — two settles
racing on the same shrink must not both drop. With nowhere to drop (unplaced,
or a Location with no public room) `seen` stays high, so the next settle —
on arrival, or at turn close — retries for free. The system converges without
a queue.

**What drops.** Random units out of the droppable holdings until the item
load fits, and every ⬢ over the ⬢ cap. Two things are never in the bag:
multiplier tags (dropping the Cart to fix losing the Pack Mule would shrink
the cap again and loop) and equipped gear (being disarmed by a lost cart reads
badly). If the bag empties first, you stay Overburdened. Audit:
`carry_overflow_dropped` with the manifest.

**Rebase after a catalog edit.** `db:sync-tags` ends by running
`settleCarry(…, { drop: false })` for every holder of a multiplier tag, which
advances `seen` and grants the status without dropping. Otherwise lowering
Cart from 5 to 3 in the YAML would read, to every holder, as "your Cart just
left".

## 5. Room stashes

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
the rule; note it is Location-grain where every other reach rule is zone-grain.

**A public stash is public.** Anyone at the Location can list its contents
(the Storage button, or the Transfer dialog) and walk off with them. That is
the point of a floor, and it is also a trace: the goods often say who passed
through. Private rooms leak nothing to anyone their key doesn't admit.

The stash survives the Dawn wipe (it lives in the database, not the thread),
is cleared by a Restart Game wipe (`wipeGameData` deletes `RoomTag` and zeroes
`Room.resources`), and cascades away with its Room when `db:sync-zones` prunes
one. Deleting a Tag from the catalog cascades its stacks too.

## 6. Transfer

One dialog on `/character` (`TransferDialog.js`, mode `transfer` in
`RequestActionsProvider.js`) replaces the old Transfer Tag and Transfer
Resources buttons. From → To, any number of tag lines, a ⬢ amount, one reason.
From is **you or a Room** here; To is a person standing at your Location
who isn't concealed (web/lib/peopleHere.js — the same roster every picker
uses) or a Room here you can get into. Nothing is ever taken from another
person through Transfer, ⬢ included: you can't reach into their pockets, and
listing what's in them would show their hidden tags. Loot is how you take
from a person, and only a helpless one (REQUESTS.md §5b). The projection line
("After this you carry 5 / 10 items and 6 / 25 ⬢") warns in accent when the
result is over a cap and submits anyway — going over is allowed (§2).

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

## 7. The Storage button

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

## 8. Where the code lives

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
| Travel gate | `db/lib/locationTravel.js#performLocationMove` |
| Storage button | `db/lib/roomStarterRow.js`, `db/lib/syncZones.js`, `bot/src/lib/roomStorage.js` |
| Caps on `/gm/dev` | `web/app/(desk)/gm/dev/page.js`, `web/app/(app)/gm/dev/actions.js` |
| Constants | `OVERBURDENED_SLUG` in `db/lib/constants.js` |
