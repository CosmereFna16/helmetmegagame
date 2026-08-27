# Requests: acting first, reviewing after

How a player changes their own sheet without waiting on a GM, and what a GM
can do about it afterwards. Companion to `ADJUDICATION.md` (the GM-facing
review surface), `CHARACTERS.md` (creation and the point economy) and
`TAGS.md` (the tag catalog).

## 1. The shape of it

The game runs one turn per real-world day for a month. Any mechanic that
needs a GM in the loop before it resolves costs a player a day. Most of what
players do — handing over resources, dropping an illness a medic just cured,
dropping a cured illness, claiming a Desire — is not contentious enough to be worth
that.

So the approval order is inverted. The player acts, the change lands
immediately, and the GM reviews it later:

1. The player clicks a button on their character sheet.
2. A universal popup asks **"What is your reason?"**, with type-specific
   fields underneath.
3. The player confirms.
4. The effect is applied and a `Request` row is written, in one transaction.
5. A GM sees it in the Requests tab of `/gm/turns` and can **Mark reviewed**
   (stamp it seen, no change), **Save edits** (a real change, stamps the
   status `EDITED`) or **Undo** it.

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
player may transact again, a tag may be displaced by another. Reversing
a request by recomputing it from the character's current sheet would quietly
apply the wrong numbers. Snapshotting the applied deltas is what makes Undo an
exact inverse.

The same reasoning drives the restore snapshots: removing a tag stores its
original `source`, `expiresTurn` and `quantity`, so Undo puts back the tag
that was there rather than a fresh grant with a full duration. The quantity
matters for the same reason everything else here does: a player who cooked
four more meals between the request and the GM getting to it must not have
the whole new stack clawed back — only what this request moved. See
`TAGS.md` §5a.

`web/lib/requests.js#createRequest` is the one writer, and every caller
invokes it inside its own `prisma.$transaction` so a request can never exist
without its effect, or an effect without its request.

**Status semantics.** `PASSED` means the request stands exactly as the player
made it, whether or not a GM has looked at it — `reviewedAt`/
`reviewedByDiscordUserId` are the "seen" stamp, tracked separately from
status. `EDITED` means a GM made a real change to the numbers. A Confirm that
adds only `gmNotes`, or that re-confirms with no change, stays `PASSED` (or
whatever real status it already had) and audits `request_reviewed`, not
`request_edited`. Each handler's `applyEdit` returns `{ effect, note, changed
}` (`web/lib/requestEffects.js`); `resolveRequestImpl`
(`web/app/(desk)/gm/turns/actions.js`) reads `changed` to decide the status
and the audit `actionType`.

**Every ⬢ movement goes through `requestEffects.js#moveResources`, and a debit
the balance no longer covers throws rather than going negative.** The write is
the check — a conditional `updateMany` matching only while the balance still
covers the amount. The friendly `amount > from.balance` checks in the request
actions stay for their better wording, but they are a separate statement from
the write and two tabs firing at once both passed them: ten sent twice left
the sender at −10 and the recipient up 20, and it worked on faction Silos too.
The throw aborts the surrounding transaction, so the tag grant, the `Request`
row and the audit entry all roll back with it.

## 3. The twelve types

Ten live in `web/app/(app)/character/requestActions.js`, the two
Lifeweb types in `web/app/(app)/lifeweb/requestActions.js`, and `BUY_TAGS`
in `web/app/(app)/store/actions.js`. Each one
authenticates, **re-validates everything the client sent** (a server action is
a public endpoint, and the client's filtered menus are only advisory), applies
the effect, and writes the `Request` plus an `AuditLog` row carrying the same
reason.

| Type | What the player does | GM can edit | Undo |
|---|---|---|---|
| `TRANSFER_RESOURCES` | Moves ⬢ between any two parties in reach. `direction: "LOOT"` pulls ⬢ off a corpse in the same room | — | Reverses the movement |
| `ADD_TAG` | Takes a Purchasable or Craftable tag, optionally paying ⬢. Stackable tags take a quantity and stay on the menu once held | cost; remove what this request added | Drops what it added, refunds the cost |
| `BUY_TAGS` | Checks out a whole `/store` cart with Tag Points — one request per cart, `effect.items` listing every tag | — | Returns every tag in the cart, refunds the points |
| `REMOVE_TAG` | Drops one of their own `removable` tags, optionally paying ⬢, in a quantity if it stacks | cost | Restores the tag and its count, refunds the cost |
| `CONSUME_TAG` | Uses up one of their own `consumable` tags — always exactly one, even from a stack — and gains whatever it `consumesInto` | — | Restores the one unit with its original expiry, takes back what it granted |
| `TRANSFER_TAG` | Hands an Item or Asset to another player in the same Location, in a quantity if it stacks. `direction: "LOOT"` lifts one off a corpse in the same room | — | Moves that many back |
| `FULFILL_DESIRE` | Claims their active Desire | Tag Points awarded | Revokes the points, reopens the Desire |
| `DONATE_BLOOD` | Mortus bleeds someone into the Lifeweb | blood added; clear Drained | Draws the blood back, clears Drained |
| `FEED_PERSON` | Mortus feeds someone to the Lifeweb | blood added | Draws the blood back (never revives) |
| `HEAL_CHARACTER` | Treats an affliction on anyone standing in their Location, on whoever's tab they choose | cost; put the affliction back | Restores the tag with its original expiry, refunds the payer |
| `CHANGE_NAME` | Drinks a Mulligan Potion and takes a new honorific/first/last name | — | Restores the previous name and gives back the potion |

The per-type behaviour lives in `web/lib/requestEffects.js` as one
`REQUEST_EFFECTS` entry each. **Adding a type means adding one entry
there, one entry in `RequestPanel.js`'s `SECTIONS` map, and one value to the
`RequestType` enum — nothing else in the adjudication surface changes.** That
extensibility was an explicit requirement, and the two Lifeweb types added
later cost exactly that.

**Validation is returned, never thrown.** Every one of these actions and
`resolveRequest` reports a validation failure as `{ ok: false, error }` via
`guarded()`/`UserError` (`web/lib/actionResult.js`), because a production
Next.js build redacts anything thrown out of a Server Action and shows React
error #441 instead — which made every `catch (e) => setError(e.message)` in
the feature dead code. Anything that isn't a `UserError` still throws, so real
faults keep their stack and `redirect()` keeps working.

Three notes on deliberate choices:

- **Transfer Resources has a source, and the source can be anyone in reach.**
  The dropdown lists every faction Silo and every living player, on both ends.
  A player really can pull ⬢ out of another player's pocket and explain
  themselves afterwards. This is the Requests bet taken to its logical end,
  and it was chosen over the safer factions-only reading.

  What it is *not* is action at a distance. Every party has to be somewhere the
  filer can stand: a person in the same Location, a Silo in its own zone or with
  an officer in the filer's zone (`web/lib/transferReach.js`, `FACTIONS.md` §3b).
  Picking a pocket is now a mugging rather than a wire transfer. The dropdowns
  stay unfiltered on purpose — filtering them to who's in range would make the
  dialog a free scouting tool for who is standing in your zone.
- **Transfer Tag is send-only for the living, plus a LOOT direction for
  corpses.** There is no "request a tag from a live someone", because
  browsing another player's inventory to pick something is the abuse the
  one-way flow prevents. But a dead character is a lootable pile: filing a
  `TRANSFER_TAG` with `direction: "LOOT"` names a corpse in the same room as
  the counterparty and pulls the item OFF it. Co-location is folded into the
  same `WHERE` clause in both directions. `TRANSFER_RESOURCES` mirrors this:
  a `LOOT` request pulls ⬢ off a corpse and can only credit the initiator.
  See `CHARACTERS.md` §5.
- **Consume has no resource field and no quantity field.** A meal already
  cost ⬢ to make and the Hunger pass charges its own upkeep, so a third
  charge here would be the same meal paid for three times; and taking one
  unit at a time is the point of a stack. See `TAGS.md` §5b.
- **Transfer Tag filters on `category`, not `tradeable`.** `Tag.tradeable`
  exists and would be more precise, but it is set on exactly one tag in
  `docs/tags.yaml` today, so Items/Assets is the honest signal. Revisit once
  the catalog populates it (`web/lib/tagRequests.js`).
- **Undo never re-syncs Discord.** `resolveRequest` (`gm/turns/actions.js`)
  runs a request's `undo()` entirely inside one transaction, and no network
  call may run inside a `$transaction` (`ARCHITECTURE.md` §5) — so undoing
  `ADD_TAG`/`REMOVE_TAG`/`CONSUME_TAG` leaves `#watch`/`#intercom` access
  stale until the next Move reconciles it, and undoing `CHANGE_NAME` leaves
  the personal Discord role/nickname stale until the player's next Bio save
  (`ensureCharacterRole` always re-PATCHes off the live DB name, so that save
  self-heals it). Accepted rather than fixed: the forward path already pays
  for the Discord call outside the transaction, and a bespoke undo path for
  each type would be the `killRequestTarget` treatment for something this
  minor.

## 4. Hunger and the Gambit modifier

Hunger is the Needs layer, and the only thing that modifies a Gambit die.

It is a `hunger` Status tag (`docs/tags.yaml`, `durationTurns: 1`,
`purchasable`/`removable` false). Its penalty is not flat — it escalates with
`Character.hungerStreak`, a plain Int column counting consecutive turns closed
hungry.

Riding the tag system means the per-turn expiry sweep already in
`db/index.js#resolveNeeds` handles it for free —
`characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } })` —
with no bespoke expiry column to keep in step.

> **Mood is gone.** `happy` / `unhappy` were two Status tags worth ±1 on the
> Gambit die, set from a Set Mood button via a `SET_MOOD` request. All of it —
> the tags, the button, the request type, `db/lib/mood.js` — was removed, along
> with the `happy` grant on Alcohol, Bliss, Ravenheart Red and the two meals.
> Drinks now leave `tipsy`, `high` or `euphoric` instead. An older design in
> `ARCHITECTURE.md` proposed Mood as Character columns; it was never built
> either.

### Hunger

Nothing player-initiated ever grants or removes Hunger, the streak, or
what it leads to — there is no request type, no picker entry, no
`requestEffects.js` case. `db/lib/hungerPass.js#runHungerPass` is the only
writer of all three, called from `resolveNeeds()` at the close of every turn:

1. Holds `hungerless` → **skipped entirely**. No resource taken, no Hunger,
   streak reset to 0.
2. Holds `ate-meal` → **shielded** from Hunger, the tag is consumed whether or
   not they were broke, **no ⬢ is taken**, and the streak resets to 0. The
   meal was already paid for when it was cooked (2 ⬢ a Fine, 3 ⬢ a Lavish), so
   charging the upkeep on top of that made eating strictly worse than the 1 ⬢
   it saves. Eating *settles* the turn's upkeep and the streak; neither comes
   on top of it.
3. **Check first, then pay**: at `resources === 0` you go Hungry, owe nothing,
   and the streak **increments**; at 1+ ⬢ you pay 1, stay fed, and the streak
   resets to 0.

So 1 ⬢ always buys a fed turn — and clears the streak — a meal buys one
outright, and `Character.resources` can never go negative — the clamp is
structural, not a `Math.max`, and it lives on step 3, the only branch that
still pays. Structural means the check and the payment are the *same
statement*: the decrement carries `resources: { gte: 1 }` in its own `where`.
Read the balance in one query and decrement in another and a player who spends
in between goes to −1, which is what used to happen, and turn rollover is
exactly when players are most active.

**The streak and the cap.** Each consecutive hungry turn is worth an
additional −1 to the die, floored at **−6** (`HUNGER_STREAK_CAP`). Reaching the
cap grants `dying` — permanently, like every other terminal tag chain (see
`TURN-ENGINE.md` §3's "NOTHING HERE KILLS ANYONE") — and a GM confirms the
death by hand from there. The streak is computed in the pass off the value it
already read for the resource check, not off a database `increment`'s return
value, because that wouldn't hand back the new total in time to decide who
just crossed the cap this turn or what to put in their DM. It's allowed to
keep counting past 6 if nobody intervenes; the penalty simply stays floored,
and trying to re-grant `dying` on a later starved turn is a harmless
`skipDuplicates` no-op, not an error.

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

Going hungry sends one DM naming the *actual* penalty in effect
(`» You went hungry this turn. −3 to Gambits.`) via `db/lib/dm.js#sendDm`, the
REST twin that exists so this fires from both the bot's cron and the Dev
Panel's End-turn button. Crossing the streak cap sends a second, distinct DM
about Dying, right after the Hunger one — so a player who's about to see
Dying on their sheet already knows why. A quiet −1 ⬢ sends nothing.

`runHungerPass` does not send either DM itself. It returns `starvedNotices`
on its summary — one entry per starved character, carrying `discordUserId`,
the already-clamped `streak`, and `justDied` — and the sending happens in
`advanceTurn()`'s `runSideEffects()` thunk, alongside the turn announcement and
the Dawn wipe. The pass is therefore two reads and several bulk writes with no
network call in it at all — which matters because at 100+ players the DMs are
sequential Discord round-trips *per starving character*, and awaiting that
inside the Dev Panel's server action used to hold the request open long enough
to freeze the web app's navigation. The list is split back off the summary in
`resolveNeeds()` before the audit row is written, so the logged details are
unchanged.

The pass writes **one summary `hunger_resolved` audit row** per turn, not one
per character — at 100+ players the latter would push 200 entries a day into
`/gm/audit` and drown every human-authored line.

### The summed modifier

Hunger is currently the only contributor, so the "sum" is one number.
`db/lib/gambitModifier.js` is still the single source of it, shared by the
bot and the web app so the number a player is shown and the number applied
cannot drift — the same posture as `narrowcastAccess.js`. It still returns a
*list* of named contributions rather than a bare number, because the confirm
DM names them and because adding a second contributor should be an append
there rather than a rewrite of five call sites. Hunger is a boolean tag whose
*size* comes from a Character column (`hungerStreak`) the turn engine writes —
`gambitModifiers`/`gambitModifierTotal` take it as a second argument for
exactly that reason, since it isn't something the tag list alone carries.

Only a Gambit rolls a die, so only a Gambit can carry the modifier.
`bot/src/events/interactionCreate.js#handleMoveConfirm` stores the **raw** roll
on `Action.diceRoll` and the **sum** separately on `Action.diceModifier`.
Keeping them apart is deliberate: a GM has to be able to tell a modified 5
from a natural 5, and a re-roll during adjudication must not compound the
modifier. `Action.diceModifier` is one `Int`, so the per-contributor breakdown
is display-only — rebuilt for the DM, and mirrored into the `move_confirmed`
audit entry's `diceModifiers`, which is the only place it survives.

The DM reads `🎲 **4** −2 Hungry → **2**`. It is keyed on whether *any*
contributor applied rather than on the total, so a contributor worth 0 would
still show its work instead of pretending nothing happened.
`StatusPanel`'s Gambit row reads the same module.

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

## 5a. The Lifeweb

`/lifeweb` is gated on the `mortus` tag. Its two buttons are Requests like any
other — they land immediately and a GM reviews afterwards — with two wrinkles.

**Whose blood it is decides what it's worth.** Keyed on the *target's* tags,
not the Mortus doing the bleeding: Nobility 40, Courtier 30, anyone else 20;
holding both pays the higher. Feeding a whole person is a flat 100.
`db/lib/lifeweb.js` is the single source of those numbers, shared with the GM
panel on the same page (`web/app/(app)/lifeweb/actions.js`) so the two paths
can't grant different amounts — the same posture as `gambitModifier.js`.

**The pool caps at 100, so the nominal amount is not the applied amount.**
Donating 40 onto a pool at 90 moves 10. `applyBlood()` returns that delta and
it is `bloodDelta` on the effect that Undo reverses — §2's payload-vs-effect
rule applied to the blood pool. Reversing the nominal 40 would mint 30 blood
out of nothing.

**Feed Person does not kill anyone.** Letting a player end another player's
game from a dropdown is too abusable, so the request only fills the pool and
flags itself: in the Requests tab the row burns red with a `☠` until it's
resolved, and `RequestPanel` carries a **Kill** button — behind the shared
`useConfirm()`, on top of the panel — that runs the same death path as the
character editor (`status: "DEAD"` then `killCharacter()`). It stamps
`effect.killed`, so a reopened panel shows the outcome instead of offering the
button twice. Undo reverses the blood and never revives.

Both buttons ask twice: the `RequestDialog` reason, then `useConfirm()` before
anything is written. They act on someone else's character, which is the one
place in the Requests system where that second gate is worth the friction.

## 5c. Healing

The Heal button on `/character` sits beside Consume and is the third request
that touches someone else's sheet — and the first whose price the **catalog**
owns rather than the player.

**Three gates, all re-checked server-side.** The button only renders for a
character holding `medical-basic`; the patient must share the healer's
`locationId`; and the affliction's own `requirementSkills` must be satisfied —
a Deep Wound names Medical (Skilled), so a character with only the Basic tier
sees it in the menu, greyed, reading "needs Medical (Skilled)". The menu is
advisory as always: `healCharacterRequestImpl` re-derives every one of those
from the database before it writes anything.

**Holding a higher tier satisfies a lower requirement.** Medical tiers
*replace* each other up `Tag.parentTagId` (Basic → Skilled → Expert), so a
surgeon must be able to do a nurse's job. `buildSkillAncestry` walks that chain
once over the flat catalog and `satisfiedSkillIds` unions it across everything
the character holds — cheaper than three nested Prisma includes, cycle-guarded,
and pure, so the picker and the server action can never disagree. Both live in
`db/lib/medicalVision.js` (re-exported by `web/lib/healRequests.js`, where they
used to sit) because the bot asks the same question: the doctor's eye on 🔍
inspect shows a medic the hidden afflictions they are qualified for, and the
two faces must not drift on who counts as qualified. See `TAGS.md` §5c.

**What counts as treatable** is data, not a slug list: a held tag in the
`Health` category that carries *any* requirement field. A Health tag with no
requirement block is tier 0 of the cure ladder — Vomiting, a Migraine, a
Concussion: realistically untreatable, quick, harmless, and deliberately not
something a doctor bills for. Adding a `requirement:` block to a Health tag in
`docs/tags.yaml` is the whole of "make this curable", and `TAGS.md` §5c has the
eight rungs to copy rather than invent.

**The cost is `Tag.requirementResources`, and a payer is demanded even at
zero.** `schema.prisma` documents the requirement block as covering whichever
direction is narratively relevant — crafting reads it as the price of gaining
a tag, healing as the price of shedding one. A rung with no `resourceCost`
would cure for 0 ⬢; the payer is still asked for and still recorded, because
who was on the hook is the part a GM needs. The turns and any Gambit are shown
as reference and enforced by nobody — which is what makes "you may always
attempt something above your tier, as a Gambit" a rule a GM adjudicates rather
than one the button blocks.

**Who pays is anyone in reach.** Every co-located living player including the
healer, plus every faction Silo in reach regardless of Silo authority — the
same reach `TRANSFER_RESOURCES` has, for the same reason (see "the source can
be anyone in reach" in §3). The Silo half used to be "from anywhere", which
became a laundering hole the moment transfers grew a reach gate: billing a
distant Silo for a cure moves ⬢ across the map with nobody carrying it. Billing someone other than yourself asks twice: the reason dialog,
then a `useConfirm()` naming the payer and the amount. Treating another
character does not, which is the opposite of the Lifeweb rule below and
deliberate — a cure is not a harm, and being charged for one is.

Co-location is re-validated inside the target's `WHERE` clause rather than by
a second read, so a patient who walked out between page load and submit fails
closed with "They aren't here" and nothing is written.

It is also the one type whose subject is a different character from the one
who filed it: `request.characterId` is the medic, `effect.targetCharacterId`
the patient, and every tag write in `requestEffects.js` takes the latter. A
GM can re-price the cure or tick "put the affliction back but keep the
payment" — the treatment that didn't take, the one partial outcome a full
Undo can't express.

## 6. The player-facing surface

`RequestDialog.js` is the universal popup. It is a rendered component taking
`children`, not a promise-returning hook like `useConfirm()` — the second half
is arbitrary JSX per call site, which a hook API handles badly. It reuses the
existing `.modal-overlay` / `.modal-panel` styling, so it matches every other
modal for free, and it only mounts its body while open, which resets the
reason field between openings without an effect syncing state.

The Status panel (`StatusPanel.js`) was pulled out of `CharacterSheet.js`,
where it had been inline markup at a broken indent level, and now lays
Location / Resources / Gambit / Tag Points out on one `<dl>` grid instead of
four ad-hoc flex lines.

One consequence worth knowing: `CharacterSheet#groupTagsByCategory` now groups
the **`CharacterTag` rows**, not the bare `Tag`s. The wrapper carries
`expiresTurn`, which the per-tag countdowns need; the old version discarded it.

## 7. Audit trail

Every request writes an `AuditLog` row through
`web/lib/requests.js#logRequest`, carrying the player's reason verbatim. That
fills the new **Reason** column on `/gm/audit`, which is blank for every
non-request entry. The audit table is a fixed-height scroller with a pinned
header (`.table-scroll`) over 50 rows a page — the same shell every other
list in the app uses, though `/gm/audit` is the one that pages server-side,
over the URL, so a filtered view stays linkable.

Faction Silos additionally get a `SiloTransaction` row on **both** directions
of a transfer. Deposits into a Silo previously left no ledger entry at all.

## 8. Where the code lives

| Concern | File |
|---|---|
| Request creation, reason validation, audit helper | `web/lib/requests.js` |
| `UserError` + `guarded()` result wrapper | `web/lib/actionResult.js` |
| Per-type Undo/Edit behaviour | `web/lib/requestEffects.js` |
| The player-facing server actions | `web/app/(app)/character/requestActions.js` |
| Universal popup | `web/app/components/RequestDialog.js` |
| Status panel | `web/app/components/StatusPanel.js` |
| Transfer Resources | `web/app/components/TransferResourcesButton.js` |
| Add / Remove / Transfer / Consume Tag / Heal | `web/app/components/TagRequestButtons.js`, `web/lib/tagRequests.js` |
| Heal gate, tier chain, treatable-tag filter | `web/lib/healRequests.js` |
| One end of a resource movement (Silo or player) | `web/app/components/PartySelect.js` |
| Reach gate — same Location / same Silo zone | `web/lib/transferReach.js` |
| Tags panel + click-a-chip-to-consume | `web/app/components/TagsPanel.js`, `TagChip.js` |
| Desires | `web/app/components/GoalsPanel.js` (panel shell), `DesirePanel.js` |
| Lifeweb blood tiers + cap, shared bot/web | `db/lib/lifeweb.js` |
| Lifeweb requests, GM bypass panel | `web/app/(app)/lifeweb/requestActions.js`, `actions.js` |
| Lifeweb player buttons | `web/app/components/LifewebRequestButtons.js` |
| GM kill-the-target action | `web/app/(app)/gm/turns/actions.js#killRequestTarget` |
| Gambit roll + modifier | `bot/src/events/interactionCreate.js#handleMoveConfirm` |
| Expiry sweep | `db/index.js#resolveNeeds` |
