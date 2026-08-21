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
| `FULFILL_DESIRE` | Claims their active Desire | Tag Points awarded | Revokes the points, reopens the Desire |

The per-type behaviour lives in `web/lib/requestEffects.js` as one
`REQUEST_EFFECTS` entry each. **Adding a seventh type means adding one entry
there, one entry in `RequestPanel.js`'s `SECTIONS` map, and one value to the
`RequestType` enum — nothing else in the adjudication surface changes.** That
extensibility was an explicit requirement.

**Validation is returned, never thrown.** Every one of these actions and
`resolveRequest` reports a validation failure as `{ ok: false, error }` via
`guarded()`/`UserError` (`web/lib/actionResult.js`), because a production
Next.js build redacts anything thrown out of a Server Action and shows React
error #441 instead — which made every `catch (e) => setError(e.message)` in
the feature dead code. Anything that isn't a `UserError` still throws, so real
faults keep their stack and `redirect()` keeps working.

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

## 4. Mood, Hunger, and the Gambit modifier

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

`db/lib/mood.js` remains the single source of **Mood itself** — the tri-state,
its labels, and the tag slug the Set Mood write path resolves.

### Hunger

Hunger is the second Needs half, built on exactly the same pattern: a `hunger`
Status tag (`docs/tags.yaml`, `durationTurns: 1`, `purchasable`/`removable`
false) worth **−1 to the die on all Gambits**. Nothing player-initiated ever
grants or removes it — there is no request type, no picker entry, no
`requestEffects.js` case. `db/lib/hungerPass.js#runHungerPass` is the only
writer, called from `resolveNeeds()` at the close of every turn:

1. Holds `hungerless` → **skipped entirely**. No resource taken, no Hunger.
2. Holds `ate-meal` → **shielded** from Hunger, and the tag is consumed
   whether or not they were broke. The ⬢ is still owed per step 3 — the
   resource *is* what eating costs, so waiving it would let one meal pay for
   itself twice.
3. **Check first, then pay**: at `resources === 0` you go Hungry and owe
   nothing; at 1+ ⬢ you pay 1 and stay fed.

So 1 ⬢ always buys a fed turn, and `Character.resources` can never go negative
— the clamp is structural, not a `Math.max`.

**The expiry arithmetic**, and why the pass runs *after* the sweep:

| moment | what happens |
| --- | --- |
| close of turn **N** | sweep deletes `expiresTurn <= N` — clears Hunger granted at the close of N−1 |
| close of turn **N** | pass grants Hunger with `expiresTurn = N + 1` |
| turn **N+1** open | tag is live; every Gambit rolled this turn takes the −1 |
| close of turn **N+1** | sweep (`lte: N+1`) deletes it |

Exactly one turn of bite, and it is the *next* turn — which is also what makes
`ate-meal`'s "won't go hungry next turn" copy literally true. Run the pass
*before* the sweep instead and a still-broke character's re-grant collides with
`@@unique([characterId, tagId])` and is silently dropped, leaving them holding
a tag that expires immediately.

Going hungry sends one DM (`» You went hungry this turn. −1 to Gambits.`) via
`db/lib/dm.js#sendDm`, the REST twin that exists so this fires from both the
bot's cron and the Dev Panel's End-turn button. A quiet −1 ⬢ sends nothing.
The pass writes **one summary `hunger_resolved` audit row** per turn, not one
per character — at 100+ players the latter would push 200 entries a day into
`/gm/audit` and drown every human-authored line.

### The summed modifier

Mood's ±1 and Hunger's −1 **stack additively**: Unhappy + Hungry = −2, Happy +
Hungry = 0. `db/lib/gambitModifier.js` is the single source of that sum, shared
by the bot and the web app so the number a player is shown and the number
applied cannot drift — the same posture as `narrowcastAccess.js`. It is a thin
composer *over* `mood.js` rather than a generalization of it, because Mood is a
tri-state with a player-facing write path while Hunger is a boolean the turn
engine grants.

Only a Gambit rolls a die, so only a Gambit can carry the modifier.
`bot/src/events/interactionCreate.js#handleMoveConfirm` stores the **raw** roll
on `Action.diceRoll` and the **sum** separately on `Action.diceModifier`.
Keeping them apart is deliberate: a GM has to be able to tell a modified 5
from a natural 5, and a re-roll during adjudication must not compound the
modifier. `Action.diceModifier` is one `Int`, so the per-contributor breakdown
is display-only — rebuilt for the DM, and mirrored into the `move_confirmed`
audit entry's `diceModifiers`, which is the only place it survives.

The DM reads `🎲 **4** −1 Unhappy −1 Hungry → **2**`. It is keyed on whether
*any* contributor applied rather than on the total, so a Happy+Hungry wash
still shows its work (`🎲 **4** +1 Happy −1 Hungry → **4**`) instead of
pretending nothing happened. `StatusPanel`'s Gambit row reads the same module.

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
| `UserError` + `guarded()` result wrapper | `web/lib/actionResult.js` |
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
