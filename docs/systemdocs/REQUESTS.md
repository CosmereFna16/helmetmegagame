# Requests: acting first, reviewing after

How a player changes their own sheet without waiting on a GM, and what a GM
can do about it afterwards. Companion to `ADJUDICATION.md` (the GM-facing
review surface), `CHARACTERS.md` (creation and the point economy) and
`TAGS.md` (the tag catalog).

## 1. The shape of it

The game runs one turn per real-world day for a month. Any mechanic that
needs a GM in the loop before it resolves costs a player a day. Most of what
players do — handing over resources, dropping an illness a medic just cured,
declaring a mood, claiming a Desire — is not contentious enough to be worth
that.

So the approval order is inverted. The player acts, the change lands
immediately, and the GM reviews it later:

1. The player clicks a button on their character sheet.
2. A universal popup asks **"What is your reason?"**, with type-specific
   fields underneath.
3. The player confirms.
4. The effect is applied and a `Request` row is written, in one transaction.
5. A GM sees it in the Requests tab of `/gm/turns` and can **Edit** or
   **Undo** it.

The panel says this out loud, in small type: *"To reduce GM load, players can
make big changes."* The reason field is the whole anti-abuse mechanism — a
player who cannot justify what they did in writing is a player a GM will
notice.

## 2. `payload` vs `effect`

The load-bearing detail of the schema. Every `Request` carries two JSON
blobs:

- **`payload`** — what the player asked for, as submitted.
- **`effect`** — what was actually applied, as a snapshot.

**Undo reads only `effect`, and never re-derives anything from live state.**
That matters because state moves on: a GM may edit the resource cost, the
player may transact again, a mood may be displaced by another mood. Reversing
a request by recomputing it from the character's current sheet would quietly
apply the wrong numbers. Snapshotting the applied deltas is what makes Undo an
exact inverse.

The same reasoning drives the restore snapshots: removing a tag stores its
original `source` and `expiresTurn`, so Undo puts back the tag that was there
rather than a fresh grant with a full duration.

`web/lib/requests.js#createRequest` is the one writer, and every caller
invokes it inside its own `prisma.$transaction` so a request can never exist
without its effect, or an effect without its request.

## 3. The six types

All six live in `web/app/(app)/character/requestActions.js`. Each one
authenticates, **re-validates everything the client sent** (a server action is
a public endpoint, and the client's filtered menus are only advisory), applies
the effect, and writes the `Request` plus an `AuditLog` row carrying the same
reason.

| Type | What the player does | GM can edit | Undo |
|---|---|---|---|
| `SET_MOOD` | Picks Neutral / Happy / Unhappy | — | Restores the displaced mood, with its original expiry |
| `TRANSFER_RESOURCES` | Moves ⬢ between any two parties | — | Reverses the movement |
| `ADD_TAG` | Takes a Purchasable or Craftable tag, optionally paying ⬢ | cost; remove the tag | Drops the tag, refunds the cost |
| `REMOVE_TAG` | Drops one of their own `removable` tags, optionally paying ⬢ | cost | Restores the tag, refunds the cost |
| `TRANSFER_TAG` | Hands an Item or Asset to another player | — | Moves it back |
| `FULFILL_DESIRE` | Claims their active Desire | — | Revokes the points, reopens the Desire |

The per-type behaviour lives in `web/lib/requestEffects.js` as one
`REQUEST_EFFECTS` entry each. **Adding a seventh type means adding one entry
there, one entry in `RequestPanel.js`'s `SECTIONS` map, and one value to the
`RequestType` enum — nothing else in the adjudication surface changes.** That
extensibility was an explicit requirement.

Three notes on deliberate choices:

- **Transfer Resources has a source, and the source can be anyone.** The
  dropdown lists every faction Silo and every living player, on both ends. A
  player really can pull ⬢ out of another player's pocket and explain
  themselves afterwards. This is the Requests bet taken to its logical end,
  and it was chosen over the safer factions-only reading.
- **Transfer Tag is send-only.** There is no "request a tag from someone",
  because browsing another player's inventory to pick something is the abuse
  the one-way flow prevents.
- **Transfer Tag filters on `category`, not `tradeable`.** `Tag.tradeable`
  exists and would be more precise, but it is set on exactly one tag in
  `docs/tags.yaml` today, so Items/Assets is the honest signal. Revisit once
  the catalog populates it (`web/lib/tagRequests.js`).

## 4. Mood

Mood is **not a column**. It is two ordinary Status tags, `happy` and
`unhappy`, mastered in `docs/tags.yaml` with `durationTurns: 2`. Neutral is
the absence of both, not a third tag.

```
Happy   -> +1 to the die on all Gambits
Unhappy -> -1 to the die on all Gambits
Neutral ->  0
```

Riding the tag system means the per-turn expiry sweep already in
`db/index.js#resolveNeeds` handles mood expiry for free —
`characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } })` —
with no `moodExpiresTurn` column to keep in step. (An older design in
`ARCHITECTURE.md` proposed exactly such columns; it was never built and this
supersedes it.)

Both tags are `purchasable: false`, `purchasableAfterStart: false` and
`removable: false`, which keeps them out of every player-facing tag picker.
**The only ways in are the Set Mood button and a GM.**

`db/lib/mood.js` is the single source of the modifier, shared by the bot and
the web app so the number a player is shown and the number applied cannot
drift — the same posture as `narrowcastAccess.js`.

Only a Gambit rolls a die, so only a Gambit can carry the modifier.
`bot/src/events/interactionCreate.js#handleMoveConfirm` stores the **raw** roll
on `Action.diceRoll` and the adjustment separately on `Action.diceModifier`.
Keeping them apart is deliberate: a GM has to be able to tell a modified 5
from a natural 5, and a re-roll during adjudication must not compound the
modifier. The DM reads `🎲 **4** +1 Happy → **5**`.

## 5. Desires

A Desire is a self-set goal worth 1–5 Tag Points. `Desire` holds one row per
attempt; at most one is `ACTIVE` per character, enforced in the server action
rather than the schema (the constraint is "one ACTIVE", not "one row").

Setting and cancelling are **not** requests — nothing has been granted, so
there is nothing for a GM to undo. Both go through `useConfirm()`. Only
**fulfilling** moves Tag Points, so only fulfilling needs a reason and a
review.

Ending a Desire either way stamps `endedTurnNumber`, which drives a one-turn
cooldown: a new Desire is blocked while
`openTurn.number <= lastEnded.endedTurnNumber`. The confirm dialog warns about
this before the player commits.

Undoing a fulfillment revokes the points **even if that drives the balance
negative**. That is intended: if the player already spent them, digging out is
their problem, not a GM's.

The 1–5 ladder is shown in an `InfoIcon` beside the points field:

```
1. Have a drink at the bar.                        Trivial.
2. Convert the depressed bum to Christianity.      Regular.
3. Humiliate your rival in front of the court.     Moderate.
4. Break your comrade out of jail.                 Difficult.
5. Win back your lover.                            Extraordinary.
```

## 6. The player-facing surface

`RequestDialog.js` is the universal popup. It is a rendered component taking
`children`, not a promise-returning hook like `useConfirm()` — the second half
is arbitrary JSX per call site, which a hook API handles badly. It reuses the
existing `.modal-overlay` / `.modal-panel` styling, so it matches every other
modal for free, and it only mounts its body while open, which resets the
reason field between openings without an effect syncing state.

The Status panel (`StatusPanel.js`) was pulled out of `CharacterSheet.js`,
where it had been inline markup at a broken indent level, and now lays
Location / Resources / Mood / Tag Points out on one `<dl>` grid instead of
four ad-hoc flex lines.

One consequence worth knowing: `CharacterSheet#groupTagsByCategory` now groups
the **`CharacterTag` rows**, not the bare `Tag`s. The wrapper carries
`expiresTurn`, which the mood countdown needs; the old version discarded it.

## 7. Audit trail

Every request writes an `AuditLog` row through
`web/lib/requests.js#logRequest`, carrying the player's reason verbatim. That
fills the new **Reason** column on `/gm/audit`, which is blank for every
non-request entry. The audit table is also now a fixed-height scroller with a
pinned header (`.table-scroll`), since it is scanned rather than paged.

Faction Silos additionally get a `SiloTransaction` row on **both** directions
of a transfer. Deposits into a Silo previously left no ledger entry at all.

## 8. Where the code lives

| Concern | File |
|---|---|
| Request creation, reason validation, audit helper | `web/lib/requests.js` |
| Per-type Undo/Edit behaviour | `web/lib/requestEffects.js` |
| The six player-facing server actions | `web/app/(app)/character/requestActions.js` |
| Universal popup | `web/app/components/RequestDialog.js` |
| Status panel, mood readout, Set Mood | `web/app/components/StatusPanel.js`, `SetMoodButton.js` |
| Transfer Resources | `web/app/components/TransferResourcesButton.js` |
| Add / Remove / Transfer Tag | `web/app/components/TagRequestButtons.js`, `web/lib/tagRequests.js` |
| Desires | `web/app/components/DesirePanel.js` |
| Mood modifier, shared bot/web | `db/lib/mood.js` |
| Gambit roll + modifier | `bot/src/events/interactionCreate.js#handleMoveConfirm` |
| Mood tag catalog entries | `docs/tags.yaml` (`happy`, `unhappy`) |
| Expiry sweep | `db/index.js#resolveNeeds` |
