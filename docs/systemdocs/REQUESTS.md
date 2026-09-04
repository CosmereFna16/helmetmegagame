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
   fields underneath. (One exception: the Bird's letter passes
   `reasonRequired={false}`, because the letter it files is already the evidence
   a GM would read — `BIRD.md` §7.)
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
the sender at −10 and the recipient up 20.
The throw aborts the surrounding transaction, so the tag grant, the `Request`
row and the audit entry all roll back with it.

## 3. The nineteen types

Fifteen live in `web/app/(app)/character/requestActions.js`, the two
Lifeweb types in `web/app/(app)/lifeweb/requestActions.js`, `BUY_TAGS`
in `web/app/(app)/store/actions.js`, and `CAVING_LOOT` is filed by the turn
engine rather than by anybody. Each one
authenticates, **re-validates everything the client sent** (a server action is
a public endpoint, and the client's filtered menus are only advisory), applies
the effect, and writes the `Request` plus an `AuditLog` row carrying the same
reason.

| Type | What the player does | GM can edit | Undo |
|---|---|---|---|
| `TRANSFER_RESOURCES` | Moves ⬢ from you or a Room stash at your Location to a person at your Location or a Room stash there (`CARRY.md`). Nothing is ever pulled off a living person — Loot is the only way to take from someone. `direction: "LOOT"` pulls ⬢ off a corpse in the same room | — | Reverses the movement |
| `ADD_TAG` | Craft: makes a tag whose `requirement.skills` you hold, charging its `resourceCost` up front to a payer — yourself, a Room stash here, or a person here (`CRAFTING.md`). `turnsCost` 0 is Dead Simple (no Move, rationed per turn); 1 is this turn's Routine; 2+ opens a `CraftProject`, continued from the same dialog. Stackable tags take a quantity and stay on the menu once held. Desk label: **Craft** | cost; remove what this request added | Drops what it added, refunds the cost, marks any project CANCELLED |
| `BUY_TAGS` | Checks out a whole `/store` cart with Tag Points — one request per cart, `effect.items` listing every tag | — | Returns every tag in the cart, refunds the points |
| `REMOVE_TAG` | Destroy: drops one of their own `removable` tags, no ⬢ field and nothing refunded, in a quantity if it stacks. A tag with `removesInto` leaves its treated form behind (`TAGS.md` §5c). Health tags are no longer `removable` — a wound is healed, not thrown away. Desk label: **Destroy** | — | Restores the tag and its count, takes back the aftermath it granted |
| `CONSUME_TAG` | Uses up one of their own `consumable` tags — always exactly one, even from a stack — and gains whatever it `consumesInto` | — | Restores the one unit with its original expiry, takes back what it granted |
| `TRANSFER_TAG` | Hands an Item or Asset from you or a Room stash to a person at your Location or a Room stash there, in a quantity if it stacks. Nothing is ever taken from another person this way. The merged Transfer dialog files one of these per tag line (`CARRY.md` §6). `direction: "LOOT"` lifts one off a corpse at your Location | — | Moves that many back to where they came from |
| `FULFILL_DESIRE` | Claims one active, slotted Desire (`desireId`, not "the" active one — a character can hold several at once, one per slot) | Tag Points awarded | Revokes the points and reopens the *row*. Because a GM Fulfil/Cancel operates on a specific `desireId` rather than "whatever's in the slot now," an Undo is safe even after a new Desire has since been set in that same slot — it only ever touches the row it snapshotted, never the slot's current occupant |
| `DONATE_BLOOD` | Mortus bleeds someone into the Lifeweb | blood added; clear Drained | Draws the blood back, clears Drained |
| `FEED_PERSON` | Mortus feeds someone to the Lifeweb | blood added | Draws the blood back (never revives) |
| `HEAL_CHARACTER` | Treats a `healable` affliction on anyone at their Location who isn't concealed, on whoever's tab they choose, billed to a payer — yourself, a Room stash here, or a person here. An affliction with `removesInto` leaves its treated form on the patient (`TAGS.md` §5c) | cost; put the affliction back (which also takes the aftermath off) | Restores the tag with its original expiry, takes back the aftermath, refunds the payer |
| `CHANGE_NAME` | Takes a new honorific/first/last name | — | Restores the previous name |
| `CAVING_LOOT` | Nothing — the turn engine files it when a Caving Die rolls a 6 (`CAVING.md`) | — | Drops the find |
| `LOOT_CHARACTER` | Searches a body, **or** anyone Bound/Dying/Paralyzed/Catatonic in their zone, taking Items, Assets and ⬢ in one act | — | Returns every tag with its original expiry, and the ⬢ |
| `MOVE_CHARACTER` | Marches a faction member they lead, anyone helpless (Bound/Dying/Paralyzed/Catatonic), or a body, into a neighbouring zone. Does **not** spend the target's turn | — | Restores the previous zone in the DB only |
| `BIND_CHARACTER` | Ties up anyone at their Location who isn't concealed. A conscious, unhelpless target must accept an Offer first (`LESSONS.md` §3b); a target who is dead or already holds an incapacitating tag is bound on the spot | — | Cuts them loose |
| `FREE_CHARACTER` | Cuts someone in their zone loose | — | Puts Bound back with its original expiry |
| `HARM_CHARACTER` | Inflicts a Health affliction on someone already helpless, **kills** them, or both — see §5b | — | Heals what was inflicted; never revives |
| `BURY_CHARACTER` | Puts a body into the ground, lifting the **Cursed** role off the dead player's Discord account. Needs their **actual corpse tag**, held or reachable in a room here, and spends the filer's Move | — | Raises the body and puts the corpse back where it came from; does **not** re-curse, and the Move stays spent |
| `ENGRAVE_HEADSTONE` | Frees a soul with a stone instead of a body, for **4 ⬢** and the filer's Move. Target is **typed**, first name only, matched **game-wide**. Leaves a `{name}'s Headstone` tag | — | Refunds the ⬢, takes the stone, reopens the grave; does **not** re-curse |
| `BUTCHER_CORPSE` | Cuts a corpse up for what is in it — an organ from a monster, Human Flesh from a person. Free, and it destroys the body. Gated on `butcher` | — | Takes the yield back and returns the corpse to the party it came from |
| `FAST_TRAVEL` | **Retired.** A mount now adds a free zone move instead (CARRY.md §2a). Old rows stay undoable | — | Sends them back and returns the ride |
| `BIRD_MESSAGE` | Sends one written letter to a named person in a **guessed** zone. Once a day, gated on `bird` + `literate`. A wrong guess or a dead recipient means it never arrives, and the sender is told a turn later (`BIRD.md`) | — | Hands the day back and closes the reply window; **cannot unsend a letter that landed** |
| `DEPOT_BUY` | Buys an import off the orbital station at its `depotPrice`. Licence + standing at Customs (`DEPOT.md`) | — | Returns the goods, refunds the ⬢ |
| `DEPOT_SELL` | Sells a `sellable` tag to the station at its `sellablePrice` | — | Buys it back with its original expiry, takes the ⬢ |
| `DEPOT_CREDIT` | Draws on or repays the Company's 60 ⬢ credit line | — | Reverses the ⬢ and the tab together |

**Two buttons on that grid file no `Request` at all**, and both are reads
rather than acts: **Read** (`ReadDialog.js`, a purely local decode of a
ciphered letter) and **Look at** (`examineActions.js`, examining somebody
standing where you stand — `PROXYING.md` §4a). Neither moves anything, costs
anything or spends a Move, so there is nothing for a GM to review and nothing
to undo. Both skip `RequestDialog` — `NO_REQUEST_MODES` in
`RequestActionsProvider.js` — and get their own plain modal, because the
universal "what is your reason?" popup has nothing to ask them.

The per-type behaviour lives in `web/lib/requestEffects.js` as one
`REQUEST_EFFECTS` entry each. **Adding a type means adding one entry
there, one entry in `RequestSections.js`'s `SECTIONS` map, one label in
`requestLabels.js`, one line in the desk's `summarize()`, and one value in the
`RequestType` enum — nothing else in the adjudication surface changes.** That
extensibility was an explicit requirement, and every type added since — the
two Lifeweb ones, the eight of the Actions grid, then the Depot's three — cost
exactly that.

The Depot's three are the only ones whose **counterparty is not in the game**.
An orbital station has no balance to debit and no stock to run down, so each
moves exactly one side, and there is nothing to reverse but his own. They are
also the only three where the price is enforced rather than adjudicated: a GM
does not sign off a purchase, which is why none of them is editable — ⬢ and
stock moved together, and a price nudged afterwards would leave them out of
step with no way back. Undo is the whole correction.

**Validation is returned, never thrown.** Every one of these actions and
`resolveRequest` reports a validation failure as `{ ok: false, error }` via
`guarded()`/`UserError` (`web/lib/actionResult.js`), because a production
Next.js build redacts anything thrown out of a Server Action and shows React
error #441 instead — which made every `catch (e) => setError(e.message)` in
the feature dead code. Anything that isn't a `UserError` still throws, so real
faults keep their stack and `redirect()` keeps working.

**`BIRD_MESSAGE` is the first type whose effect Undo cannot reverse.** Every
other row above moves something inside the database, and `effect` is enough to
put it back. A letter is a Discord DM in somebody's inbox, and there is no
un-sending it. So its Undo does the two things it still can — returns the day
the letter cost and shuts the reply window — and its note says plainly that the
message itself stands. Worth knowing before adding another type whose real
effect leaves the database: the honest move is to reverse what you can and say
what you can't, not to pretend the handler is a full inverse.

Three notes on deliberate choices:

- **Transfer never takes from another person.** From is you or a Room stash at
  your Location; To is a person at your Location (who isn't concealed) or a
  Room stash there. Pulling ⬢ or an item out of someone else's pocket is no
  longer a Transfer at all — Loot is the only way to take from somebody, and
  only from the helpless or dead. This replaced an earlier design where the
  source could be anyone in reach; that let a player pick another player's
  pocket with nothing but a written reason, which was more of the fiction's
  "action at a distance" than Bascinet wanted once the menus went
  Location-scoped (see §6).
- **Transfer Tag is send-only for the living, plus a LOOT direction for
  corpses.** There is no "request a tag from a live someone", because
  browsing another player's inventory to pick something is the abuse the
  one-way flow prevents. But a dead character is a lootable pile: filing a
  `TRANSFER_TAG` with `direction: "LOOT"` names a corpse at the same Location
  as the counterparty and pulls the item OFF it. Being in the same place is
  folded into the same `WHERE` clause in both directions. `TRANSFER_RESOURCES`
  mirrors this: a `LOOT` request pulls ⬢ off a corpse and can only credit the
  initiator. See `CHARACTERS.md` §5.
- **Every request whose subject is a different character notifies that
  character.** `TRANSFER_TAG`, `TRANSFER_RESOURCES`, `HEAL_CHARACTER`,
  `LOOT_CHARACTER`, `MOVE_CHARACTER`, `BIND_CHARACTER`, `FREE_CHARACTER`,
  `HARM_CHARACTER`, `BURY_CHARACTER`, `DONATE_BLOOD` and `FEED_PERSON` all DM
  their target through `web/lib/notifyCharacter.js` — one line, fired after
  the transaction commits, same posture as the Dev Panel's own notifier
  (`DEV-PANEL.md`). **The DM never names the actor.** Several of these only
  work on someone helpless (a bind, a looting, a forced move), so telling the
  victim what changed while leaving out who did it keeps that information in
  the fiction rather than handing it to them for free. A self-targeting act
  (healing yourself, donating your own blood) sends nothing — you already
  know what you just clicked. `killCharacter`
  (`web/lib/discordGuild.js`) carries the one death DM for every path that
  kills a character, so a GM's Kill button and an adjudicated lethal outcome
  never send two.
- **Consume has no resource field and no quantity field.** A meal already
  cost ⬢ to make and the Hunger pass charges its own upkeep, so a third
  charge here would be the same meal paid for three times; and taking one
  unit at a time is the point of a stack. See `TAGS.md` §5b.
- **Transfer Tag and Loot both filter on `tradeable`.** Not on `category`,
  which is what they used to do and which was wrong in both directions — it
  let a corpse be stripped of its Drone, and it ignored the
  Items that already said `tradeable: false`. One flag covers handing over and
  taking off a body alike. `web/lib/tagRequests.js#isTradeable` is the only
  reader, so the menus and the server-side re-checks can't disagree. See
  `TAGS.md` §5.
- **Add Tag is the crafting menu, and only that.** It used to admit a second
  route — `purchasable && purchasableAfterStart` — so a tag could be *bought*
  here as well as made. That was 155 tags, every one of them also priced in
  `/store`, and Add Tag costs nothing but a written reason. It was therefore
  strictly cheaper than paying Tag Points, and players used it that way:
  Butcher, Horse, Stealth, Literate, Ranged (Basic), Workshop, Game Master.
  The help text asking them not to was the tell that the option should never
  have been on the menu. The two economies are now split at the door —
  `/store` spends points against catalog prices, Add Tag (Craft) spends turns
  and ⬢ against a recipe.
- **The recipe's `requirement.skills` is enforced now, not honor-system.**
  A Longbow's `requiredTag: ranged-basic` says who can *shoot* it; its
  `requirement.skills: [crafting]` says who can *make* it. Creation and
  `/store` always enforced the former. Craft used to leave the latter to the
  picker's "To make: …" hint and the GM review as the backstop
  (`TAGS.md` §3b); it now checks server-side that the crafter holds every
  listed skill or a higher tier, the same walk Heal uses
  (`CRAFTING.md` §2). A smith with no combat skill can still forge weapons to
  sell; a fighter still pulls one from an armoury the fiction gives them, but
  only by actually holding the skill. The hidden-category group gate stays
  unconditional on top of that, so a craftable in a hidden category is still
  invisible outside it.
- **Undo never re-syncs Discord.** `resolveRequest` (`gm/turns/actions.js`)
  runs a request's `undo()` entirely inside one transaction, and no network
  call may run inside a `$transaction` (`ARCHITECTURE.md` §5) — so undoing
  `ADD_TAG`/`REMOVE_TAG`/`CONSUME_TAG` leaves `#watch` access
  stale until the next Move reconciles it, and undoing `CHANGE_NAME` leaves
  the personal Discord role/nickname stale until the player's next Bio save
  (`ensureCharacterRole` always re-PATCHes off the live DB name, so that save
  self-heals it). Accepted rather than fixed: the forward path already pays
  for the Discord call outside the transaction, and a bespoke undo path for
  each type would be the `killRequestTarget` treatment for something this
  minor.

## 4. Hunger and the Gambit modifier

Hunger is the Needs layer, and the only thing that modifies a Gambit die.

It is a `hungry` Status tag (`docs/tags.yaml`, `durationTurns: 1`,
`purchasable`/`removable` false). Its penalty is not flat — it escalates with
`Character.hungerStreak`, a plain Int column counting consecutive turns closed
hungry.

Riding the tag system means the per-turn expiry sweep already in
`db/index.js#resolveNeeds` handles it for free —
`characterTag.deleteMany({ where: { expiresTurn: { lte: turn.number } } })` —
with no bespoke expiry column to keep in step.

> **Create Item and the zone cache are gone.** `CREATE_TAG` let a player invent
> an Item that wasn't in the catalog and have it become a real `Tag` row on their
> sheet; `DROP_ITEM` / `PICK_UP_ITEM` let them leave an Item on the ground in a
> zone for anyone standing there to take, backed by a `ZoneCache` table. The
> buttons, the server actions, the `REQUEST_EFFECTS` entries and the table were
> all removed, and `db/prisma/migrations/20260828150000_drop_zone_cache` drops
> `ZoneCache`. Bascinet didn't want a player-facing tag-creation system, and the
> cache never earned its complexity — `db/lib/pruneTags.js` had no `zoneCaches`
> survival check, so a prune could delete a Tag that was lying on the ground.
> **The three `RequestType` values survive**, because Postgres cannot drop an
> enum value in place; `requestLabels.js` still names them so a row filed before
> the removal reads as prose, but nothing renders a body for it and nothing can
> undo it. GM-authored custom tags at `/gm/dev/tags` are a separate system and
> are untouched (`TAGS.md` §5d).

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
   streak reset to 0 — this is immunity, not eating, so it's still a full
   reset rather than the one-tick rule below.
2. Holds `ate-meal` → **shielded** from Hunger, the tag is consumed whether or
   not they were broke, **no ⬢ is taken**, and the streak drops by **one
   tick**. The meal was already paid for when it was cooked (2 ⬢ a Fine, 3 ⬢ a
   Lavish), so charging the upkeep on top of that made eating strictly worse
   than the 1 ⬢ it saves. Eating *settles* the turn's upkeep; the streak it
   took several starved turns to climb takes that many fed turns to climb back
   down.
3. **Check first, then pay**: at `resources === 0` you go Hungry, owe nothing,
   and the streak **increments**; at 1+ ⬢ you pay 1, stay fed, and the streak
   drops by **one tick**.

So 1 ⬢ always buys a fed turn, and `Character.resources` can never go
negative — the clamp is structural, not a `Math.max`, and it lives on step 3,
the only branch that still pays. Structural means the check and the payment
are the *same statement*: the decrement carries `resources: { gte: 1 }` in its
own `where`. Read the balance in one query and decrement in another and a
player who spends in between goes to −1, which is what used to happen, and
turn rollover is exactly when players are most active.

A single fed turn only sheds **one tick**, not the whole streak — a character
six turns deep needs six fed turns to reach 0, the same as it took six starved
turns to get there. So the `hungry` tag no longer means "starved this turn";
it's re-granted for as long as the streak is above 0 after eating, meaning
"still carrying hunger damage." The floor is the same structural posture as
the resources clamp above: `hungerStreak: { gt: 0 }` in the decrement's own
`where`, not a `Math.max` on a value read moments earlier.

**The streak and the cap.** Each consecutive hungry turn is worth an
additional −1 to the die, floored at **−6** (`HUNGER_STREAK_CAP`). Reaching the
cap grants `dying`, the same terminal tag every untreated-wound chain lands on
(see `TURN-ENGINE.md` §3's "NOTHING HERE KILLS ANYONE"). The pass itself still
kills nobody; `dying` carries a one-turn clock, and the Dying death pass
(`TURN-ENGINE.md` §2 4b) is what ends it at the next close. The streak is computed in the pass off the value it
already read for the resource check, not off a database `increment`/
`decrement`'s return value, because neither would hand back the new total in
time to decide who just crossed the cap this turn, who still carries Hunger
after eating, or what to put in their DM. Only starving pushes it up; eating
only ever brings it down. It's allowed to keep counting past 6 if nobody
intervenes; the penalty simply stays floored, and trying to re-grant `dying`
on a later starved turn is a harmless `skipDuplicates` no-op, not an error.

**The expiry arithmetic**, and why the pass runs *after* the sweep:

| moment | what happens |
| --- | --- |
| close of turn **N** | sweep deletes `expiresTurn <= N` — clears Hunger granted at the close of N−1 |
| close of turn **N** | pass grants Hunger with `expiresTurn = N + 1` |
| turn **N+1** open | tag is live; every Gambit rolled this turn takes the −1 |
| close of turn **N+1** | sweep (`lte: N+1`) deletes it |

Exactly one turn of bite, and it is the *next* turn. Eating on turn N decides
whether the tag is re-granted for N+1 at all — and if the streak was more than
1, it's re-granted one tick lower than it was, not cleared. Run the pass
*before* the sweep instead and a still-broke character's re-grant collides with
`@@unique([characterId, tagId])` and is silently dropped, leaving them holding
a tag that expires immediately.

Going hungry sends one DM naming the *actual* penalty in effect
(`» You went hungry this turn. −3 to Gambits.`) via `db/lib/dm.js#sendDm`, the
REST twin that exists so this fires from both the bot's cron and the Dev
Panel's End-turn button. Crossing the streak cap sends a second, distinct DM
about Dying, right after the Hunger one — so a player who's about to see
Dying on their sheet already knows why. Eating sends its own DM too, unless
the streak was already 0: one naming the smaller-but-still-there penalty
(`» You ate, but you're still weak from hunger. −4 to Gambits.`) while any
streak remains, or a short "back to full strength" line the turn it finally
clears. A quiet −1 ⬢ sends nothing.

`runHungerPass` does not send any of these DMs itself. It returns
`hungerNotices` on its summary — one entry per character who starved or whose
streak changed from eating, carrying `discordUserId`, a `kind` (`starved` /
`recovering` / `recovered`), the already-clamped `streak`, and `justDied` —
and the sending happens in `advanceTurn()`'s `runSideEffects()` thunk,
alongside the turn announcement and the Dawn wipe. The pass is therefore two
reads and several bulk writes with no network call in it at all — which
matters because at 100+ players the DMs are
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
cannot drift — the same posture as `specialChannels.js`. It still returns a
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

A Desire is now picked from a catalog (`DesireTemplate`, sourced from
`docs/desires.yaml`) rather than typed as free text on a fixed ladder — the
1–5 points-and-ladder system is gone. Full writeup of the catalog, its
gates, cooldowns and the tag-group lock mechanism:
[`DESIRES.md`](DESIRES.md). This section covers only the request-level
mechanics.

`Desire` holds one row per set/cancel/fulfil attempt, `slotIndex`-scoped: a
character can hold up to `GameConfig.desireSlots` (default 2) `ACTIVE` rows
at once, one per slot, each independent of the others. At most one `ACTIVE`
row per slot is enforced in the server action rather than the schema (the
constraint is "one ACTIVE per slot", not "one row"). Setting a new one in an
already-occupied slot — from the player's `setDesire` or the Dev Panel's
`setDesireGm` — cancels that slot's current one first, in the same
transaction.

**Setting and cancelling are still not requests** — nothing has been
granted, so there is nothing for a GM to undo. Both go through
`useConfirm()`. Only **fulfilling** moves Tag Points, so only fulfilling is
a `Request` (`FULFILL_DESIRE`) with a reason and a review.

Ending a Desire either way (cancel or fulfil) stamps `endedTurnNumber`,
which drives two independent cooldowns, not one — see `DESIRES.md` §2 for
the full mechanics:

- the **slot** locks until the next turn regardless of which template
  ended, so a slot can't be cancelled and immediately refilled in the same
  turn;
- the specific **template**, once fulfilled, is unavailable again for its
  own tier-length (or `cooldownTurns`-overridden) cooldown, independent of
  the slot.

The confirm dialog warns about the slot lock before the player commits.

Undoing a fulfillment revokes the points **even if that drives the balance
negative**. That is intended: if the player already spent them, digging out
is their problem, not a GM's. The same "even into negative" posture applies
by adjudication, not code, to curing an Addiction or Restriction tag —
`DESIRES.md` §7's clawback rule.

`GameConfig.desiresEnabled` is the Dev Panel switch that closes the faucet
without freezing what's already in flight: off blocks `setDesire` (checked
server-side in `setDesireImpl`, not just hidden in the UI) so nobody can
start a **new** Desire, but an already-`ACTIVE` one in any slot can still be
fulfilled or cancelled — the system drains out rather than stopping
mid-goal. `/character` greys the "set a new Desire" form and shows
"Temporarily disabled." in its place. Unaffected: `setDesireGm`/`endDesireGm`
on the Dev Panel (host access, not game permission — same split
`/lifeweb`'s GM panel uses; a GM grant also bypasses every catalog gate, per
`DESIRES.md` §6) and the Discord 🔍/⚜️ inspect surfaces, which stay
read-only regardless.

## 5a. The Lifeweb

`/lifeweb` is gated on the `mortus` tag. Its two buttons are Requests like any
other — they land immediately and a GM reviews afterwards — with three wrinkles.

**Both of you have to be in the Fortress.** The tower is up the Keep stairs, so
tending the Web is the same reach rule as every other person-touching Request
(`MAP.md` §3): `requireMortusCharacter()` refuses a Mortus standing anywhere
else, and the target lookup folds `zone: { slug: FORTRESS_SLUG }` into its WHERE
clause, so a person elsewhere on the map simply isn't found. Getting a victim to
the tower is a journey somebody physically makes. The page stays readable from
anywhere — a Mortus in Town sees the gauge with both buttons disabled and the
reason underneath — and the picker only offers people already at the tower. The
**GM panel on the same page is not gated**; that's host access, not game
permission.

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

**Feed Person kills, on the click.** It used to stop short — fill the pool,
raise a `☠` on the Requests row, and wait for a GM's Kill button — on the
argument that a player must not end another player's game from a dropdown.
What that bought in practice was a character everyone had watched be fed to
the Tower still walking around until someone worked the queue.

The gates are what protect a player, not the delay, and every one of them is
still checked server-side: a living **Mortus**, standing in the **Fortress**,
against a living target standing there too, with a **reason** that is required
and logged. A GM reads it afterwards rather than before.

The kill is claimed inside the same transaction that moves the blood, with the
conditional `status: "ALIVE"` where-clause every death path uses
(`db/lib/characterDeath.js`), so two Mortii feeding the same person in the same
second cannot both claim it; the Discord half (`killCharacter()`) runs after
the commit, never inside the transaction. `effect.killed` and `effect.killedAt`
are stamped there.

The **Kill** button in the Requests tab stays, as a fallback for the rows where
the claim did not land — the target was already dead when the request was
filed, or the row predates this change — and `killRequestTargetImpl`'s
`effect.killed` guard is what stops it double-killing. Undo still reverses the
blood and **never revives**.

Both buttons ask twice: the `RequestDialog` reason, then `useConfirm()` before
anything is written. They act on someone else's character, which is the one
place in the Requests system where that second gate is worth the friction.

## 5b. Coercion: Bind, Loot, Move, Harm

Four requests that act on somebody else, and one tag holding them together.

`bound` is the hinge. `LOOT_CHARACTER`, `HARM_CHARACTER` and the "or
helpless" branch of `MOVE_CHARACTER` all read `db/lib/incapacitation.js`'s
`INCAPACITATING_SLUGS` — `dying / catatonic / paralyzed / bound` — and for a
long time nothing in the game **granted** Bound. A GM had to place it by hand,
which is the day of real time §1 exists to save, so `BIND_CHARACTER` and its
counterpart `FREE_CHARACTER` close the loop.

**Neither one is gated beyond co-presence — but Bind now needs consent unless
the target is already helpless.** A conscious target who holds no
`INCAPACITATING_SLUGS` tag gets an Offer (kind `BIND`), not an instant bind: a
DM asking "Accept?", answered from the same handshake Learn/Teach uses
(`LESSONS.md` §3b). A dead or already-incapacitated target is bound on the
spot, as before. Free is unchanged — anyone standing there can cut somebody
loose again, no consent asked — so a captor who wants their prisoner kept has
to keep other people out of the room, which is a fiction problem rather than a
permissions one. Co-presence for all four of these is now **Location**-grain,
not zone-grain (`db/lib/presence.js` / `web/lib/peopleHere.js`): the target
has to be standing in the same Location and not concealed. The reason field
and the GM's review are the anti-abuse mechanism, exactly as everywhere else.

**Binding someone also costs them their day's labor.** All four
`INCAPACITATING_SLUGS` are read on the *afflicted* character's own side too:
`db/lib/autoLaborPass.js#runAutoLaborPass` silently skips filing a Labor for
anyone holding one, so a bound target loses their next turn, not just their
ability to defend themselves (TURN-ENGINE.md §6).

**Harm is Wound and Finish in one request**, because they are one act: you
stand over someone who can't stop you and decide how far to take it. Either
half alone is valid — a beating that leaves them alive, a clean kill with no
new injury — but not neither. The target must **already** be helpless; knifing
someone who could fight back is a Gambit, and a GM adjudicates that.

**It kills**, on submit, the same posture `FEED_PERSON` takes above and for
the same reasons — the claim is made in the request's own transaction, the
Discord teardown runs after the commit, and the **Kill** button survives only
as the fallback for a claim that did not land. What makes it safe is the gate,
not a delay: the target has to be helpless **already**, and `FINISHABLE_SLUGS`
narrows it further than the loot gate — you can rob a Paralyzed character, but
only someone **Dying or Bound** can be finished off. Paralysis is a moment's
stumble; those two are a body that is not getting up on its own.

**Catatonic is not finishable**, though it is lootable and draggable. It was
added to `FINISHABLE_SLUGS` briefly and pulled back out once the lethal half
started killing on its own: Catatonic doesn't mean a helpless character, it
means an **absent player** — AFK, or gone from the guild. With no GM step left
behind the gate, allowing it would turn "stopped logging in" into a dead
character at another player's discretion. The engine already answers that case
itself, on its own clock and its own GM-facing dial
(`db/lib/catatonicDeathPass.js`, `TURN-ENGINE.md` §2 7b).

**Harm offers wounds, not the whole Health category.** The picker used to run
off `category: Health, custom: false`, which is all 75 rows — so a player
standing over a Bound character could give them Exploded Chest ("a larva
slithered out"), Appendicitis, Dying, or Hungover. But that category is the set
the cure ladder *treats* (`TAGS.md` §5c), and most of it is downstream of an
injury rather than an injury: `health-recovery` is the aftermath a treatment
leaves, `health-infection` is what the engine grants when a wound goes
untended, `health-illness` is disease, `health-minor` is mostly jokes. Two
groups are things one person does to another — `health-wounds` and
`health-maiming` — plus four out of `health-mind` a beating plainly causes
(Concussed, Shell Shocked, Blind, Mute). That is `isInflictable()` in
`web/lib/healRequests.js`, 33 rows, read by both the picker and the server
action for the same reason `isHealable` is. **Paralyzed is deliberately not on
it**: it is in `INCAPACITATING_SLUGS`, so inflicting it would let one player
lock another out of their day's labor indefinitely, at will.

The lethal half is also the only place besides billing someone else for a cure
where the dialog asks twice.

**Move Player does not spend the target's turn**, and it moves nobody but the
target — the copy says to walk there yourself afterwards. It takes a body too,
which is how a corpse gets anywhere: bodies are lootable and Lifeweb-feedable
but would otherwise be pinned where they fell. A corpse needs no authority
over it, so the leader gate is skipped and no Discord role is swapped — and
neither does anyone helpless, so a Catatonic, Dying or Paralyzed character can
be carried as well as robbed.

**The target menus list who is at your Location and not concealed — a corpse
still shows for Loot and Move.** That's a change from the earlier design,
where every one of these listed every living player so nobody learned who was
nearby just by opening a menu; the game now filters by co-presence
(`web/lib/peopleHere.js`, `db/lib/presence.js`), so a menu can show a name a
player isn't actually allowed to act on (Bound already, out of reach by the
time of submit) and the server rejects the rest with its own wording. See §6
on why the buttons themselves don't grey out for who's near you — that rule is
unrelated and still holds.

## 5c. Healing

The Heal button on `/character` sits beside Consume and is the third request
that touches someone else's sheet — and the first whose price the **catalog**
owns rather than the player.

**Three gates, all re-checked server-side.** The button only renders for a
character holding `medical-basic`; the patient must share the healer's
Location and not be concealed; and the affliction's own `requirementSkills`
must be satisfied —
a Deep Wound names Medical (Skilled), so a character with only the Basic tier
sees it in the menu labelled "— Gambit ‡" and may still attempt it — it files a
GAMBIT Move rather than curing anything, and the GM resolves the roll
(TAGS.md §5c). Routine cures are additionally rationed 2/3/4 a turn by the
medic's tier, and a 0-turn cure never counts against that. The menu is
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

**What counts as treatable** is data, not a heuristic: `Tag.healable`, a flag
in `docs/tags.yaml` (`CRAFTING.md` §1), re-checked by
`web/lib/healRequests.js#isHealable`. This replaced the old rule — a held tag
in the `Health` category that carried *any* requirement field — which
conflated "curable" with "has a cure cost" closely enough that it worked, but
the flag is the thing actually read now, not the inference. A Health tag with
`healable: false` and no requirement block is tier 0 of the cure ladder —
Vomiting, a Migraine, a Concussion: realistically untreatable, quick,
harmless, and deliberately not something a doctor bills for. Setting
`healable: true` (with a `requirement:` block) on a Health tag in
`docs/tags.yaml` is the whole of "make this curable", and `TAGS.md` §5c has
the eight rungs to copy rather than invent.

**The cost is `Tag.requirementResources`, and a payer is demanded even at
zero.** `schema.prisma` documents the requirement block as covering whichever
direction is narratively relevant — crafting reads it as the price of gaining
a tag, healing as the price of shedding one. A rung with no `resourceCost`
would cure for 0 ⬢; the payer is still asked for and still recorded, because
who was on the hook is the part a GM needs. The turns and any Gambit are shown
as reference and enforced by nobody — which is what makes "you may always
attempt something above your tier, as a Gambit" a rule a GM adjudicates rather
than one the button blocks.

**Who pays is yourself, a Room stash at your Location, or a person there** —
the same payer choice Craft offers (`CRAFTING.md` §2), and a person picked
this way is DM'd what they were charged. Billing someone other than yourself
asks twice: the reason dialog, then a `useConfirm()` naming the payer and the
amount. Treating another character does not, which is the opposite of the
Lifeweb rule below and deliberate — a cure is not a harm, and being charged
for one is.

The shared Location is re-validated inside the target's `WHERE` clause rather
than by a second read, so a patient who walked out between page load and
submit fails closed with "They aren't here" and nothing is written.

It is also the one type whose subject is a different character from the one
who filed it: `request.characterId` is the medic, `effect.targetCharacterId`
the patient, and every tag write in `requestEffects.js` takes the latter. A
GM can re-price the cure or tick "put the affliction back but keep the
payment" — the treatment that didn't take, the one partial outcome a full
Undo can't express.

## 5d. Bodies

Four requests that each break one rule the others keep. Three of them are about
corpses; the full design is [`CORPSES.md`](CORPSES.md), and this section covers
only what is peculiar to them *as requests*.

**Bury needs the body, not a name.** It used to match a typed first name against
the dead in the filer's zone. It now takes a corpse **tag** the filer is holding
or can reach in a room at their Location — strictly tighter, since you have to
have actually found it — and consumes that tag. It also **spends the filer's
Move** now, filed automatically as a passed Routine by `fileAutoRoutine`. A
monster corpse is refused: there is no soul in a Nekker.

**Engrave is the one that kept the typed name**, and it kept it for the reason
Bury originally had it. Every other target menu in the app is a dropdown built
from the roster; a dropdown here would be a list of the dead, readable by anyone
who opened the dialog, and the whole reason `/character`'s panels never render a
status pill on a corpse is that who died is not supposed to be free information.
So the dialog holds one text field and `firstName` is matched
case-insensitively against `Character.firstName` inside a `WHERE` scoped to
`status: DEAD` and `buriedAt: null`.

**And Engrave's search is game-wide** — no zone clause at all, because the whole
point is a body nobody can find. Two consequences follow, and both are accepted
deliberately. The leak is bigger than Bury's was: a hit tells you that person is
dead *somewhere*, where before it only told you they were not a corpse in your
zone. And **the `>1 match` refusal now does real work.** Two dead people sharing
a first name anywhere in Ravenheart is a plain error — "More than one dead
person answers to that name. A GM will have to do it." — rather than a guess,
because it is the only thing standing between a mourner and freeing the wrong
soul. Do not soften it into picking the first match.

**Butchering destroys a body without freeing the soul.** This reads as an
oversight and is not: cutting someone up is not a burial, so their player stays
Cursed, and Engrave is the way out of that. It is also the only one of the three
that is entirely free — no ⬢, no Move — because the cost of butchering is
supposed to be what other people think of you.

**No gate beyond co-presence**, same as Bind and Free (§5b). The Mortii's job
in the fiction (`docs/roles.yaml`) is not a permission in the code.

**It is the one request whose real effect lands on Discord rather than a
sheet.** `removeCursedRole` runs *after* the transaction commits — no network
call may run inside one (`ARCHITECTURE.md` §5) — which is also why **Undo does
not re-curse**. It raises the body and says so in its note; putting the role
back is a GM's manual edit, the same posture `MOVE_CHARACTER` and `CHANGE_NAME`
already take with their Discord halves.

**A buried body is out of the world.** `Character.buriedAt` is both the flag and
the record of when. Five places treat a corpse as a target and all five now
refuse a buried one — the `LOOT` direction of `TRANSFER_RESOURCES` and
`TRANSFER_TAG`, `LOOT_CHARACTER`, `MOVE_CHARACTER`, and the zone roster in
`character/page.js` that feeds all five target menus. A GM Revive clears it, so
a revived character is never a live person marked buried.

**Fast Travel is retired as a Request, and its mechanic has moved.** There is
no `fastTravelRequestImpl` any more, no `FAST_TRAVEL` row is ever written, and
`Character.fastTravelTurnId` is gone from the schema. What the `horse` and
`steam-automobile` tags promise is now part of ordinary travel: an **equipped**
mount adds one to the free-zone-move allowance every character gets each turn,
and it refreshes each turn rather than once a day. See [`CARRY.md`](CARRY.md)
§2a for the allowance and [`MAP.md`](MAP.md) for the crossing itself.

`db/lib/mounts.js#fastTravelCapacity` survives with **no live caller** — it
was the retired request's seat count, and ordinary travel gates dragging on
`canDrag` (corpse, helpless, or your own faction) rather than on seats. It is
kept because the catalog text still promises a horse carries two and a cart
six, and whatever enforces that later should use this rather than re-derive it.
It now reads the mount only while equipped.

Old `FAST_TRAVEL` rows stay undoable; nothing files a new one.

**The gates on these four all follow §6's rule rather than bending it.** Owning
a horse is a fact about your own sheet, so Fast Travel's icon may grey out. So
is knowing how to butcher, so Butcher greys on holding the `butcher` tag — but
**never** on whether a body is nearby, which is a fact about the world; you find
that out by opening the dialog. Bury and Engrave carry no gate at all for the
same reason: whether a corpse lies where you stand, or whether the name you have
in mind belongs to someone dead, is exactly what you are not supposed to learn
from a greyed-out icon.

## 6. The player-facing surface

`RequestDialog.js` is the universal popup. It is a rendered component taking
`children`, not a promise-returning hook like `useConfirm()` — the second half
is arbitrary JSX per call site, which a hook API handles badly. It reuses the
existing `.modal-overlay` / `.modal-panel` styling, so it matches every other
modal for free, and it only mounts its body while open, which resets the
reason field between openings without an effect syncing state.

The Status panel (`StatusPanel.js`) lays Zone / Resources / Gambit / Tag
Points out on one `<dl>` grid, and **every player action sits beside it as an
icon grid** (`ActionGrid.js`, hover tooltips via the shared `IconButton.js`).

That grid replaced three separate surfaces: a row of text buttons inside the
Tags panel, a Transfer Resources button in the Status panel's own footer, and
a whole "Bodies here" panel for looting corpses. It is a grid rather than a
vertical strip because eleven icons in one column would run far past the
four `<dl>` rows next to them and drag the panel's height with them.

`actionRegistry.js` now lays the grid out as three captioned rows rather than
one undifferentiated block, grouped by who the action touches: **You** (Craft,
Destroy, Consume, Transfer, Learn Skill, Teach Skill), **People here** (Heal,
Loot, Bind, Free, Harm, Move Player, Bury Person), **Letters** (Send Bird,
Read). The caption is presentation only — every button still greys or opens
its dialog by the same per-action rule as before; grouping them by subject
just makes the "acts on you" / "acts on someone else" split legible at a
glance, which matters more now that co-presence actually filters who shows up
in the dialog (§5b).

**The state had to move up to make that work.** `TagRequestButtons.js` used to
own both the buttons and the dialogs, and handed its opener up to `TagsPanel`
through an `onReady` callback so a chip click could open Consume. The buttons
now live in `StatusPanel`, a **sibling above** `TagsPanel`, so no component
contains both. `RequestActionsProvider.js` holds the mode state and every
dialog, and the two consumers read the opener off context — the same shape
`ConfirmProvider` uses for the same reason. It is mounted only in `self` mode,
which is what keeps another player's chips read-only for free.

**A button greys out only for a fact about your own sheet** — nothing to
remove, nothing to hand over, no Medical training. **Never** for a fact about
who is standing near you. A greyed-out Loot icon would announce "nobody here
is helpless" to anyone who glanced at their own sheet, and a live one would
announce the opposite: free scouting, on every page load, without anyone
choosing to look. So the co-presence actions are always lit and you learn who
is here only by opening the dialog. §3 covers the corresponding rule for the
target *menus* themselves — Location-filtered now, not unfiltered — which is
a separate concern from button greying and doesn't change it.

The tag menu inside the Add and Harm dialogs shares `filterTagsByQuery` with
`PointBuy.js`, so the in-play menu and the creation menu find the same tags
for the same words, and its pane is `60vh` rather than the 16rem box that used
to show three rows of a hundred-tag catalog.

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

## 8. Where the code lives

| Concern | File |
|---|---|
| Request creation, reason validation, audit helper | `web/lib/requests.js` |
| `UserError` + `guarded()` result wrapper | `web/lib/actionResult.js` |
| Per-type Undo/Edit behaviour | `web/lib/requestEffects.js` |
| The player-facing server actions | `web/app/(app)/character/requestActions.js` |
| Universal popup | `web/app/components/RequestDialog.js` |
| Status panel | `web/app/components/StatusPanel.js` |
| Every action's dialog + the mode state | `web/app/components/RequestActionsProvider.js` |
| The Actions icon grid | `web/app/components/ActionGrid.js`, `IconButton.js`, `icons.js` |
| Which held tags each menu offers | `web/lib/tagRequests.js` |
| Who is standing in your zone (one roster, five menus) | `web/app/(app)/character/page.js` |
| Co-presence at Location-grain (web / db) | `web/lib/peopleHere.js`, `db/lib/presence.js` |
| Bind, both doors (instant vs. consent Offer) | `db/lib/bind.js` (`LESSONS.md` §3b) |
| Action-grid rows and per-action entries | `web/app/components/actionRegistry.js` |
| Who counts as helpless, and who can be finished off | `db/lib/incapacitation.js` |
| Heal gate, tier chain, `healable` filter | `web/lib/healRequests.js` |
| One end of a resource movement | `web/app/components/PartySelect.js` |
| Reach gate — same zone | `web/lib/transferReach.js` |
| Tags panel + click-a-chip-to-consume | `web/app/components/TagsPanel.js`, `TagChip.js` |
| Desires — panel shell, catalog picker, GM surface, gate evaluator | `web/app/components/GoalsPanel.js`, `DesirePanel.js`, `DesireCatalog.js`; `gm/dev/characters/[characterId]/GoalsTab.js`; `db/lib/desireGates.js`. Full file map: `DESIRES.md` §11 |
| Lifeweb blood tiers + cap, shared bot/web | `db/lib/lifeweb.js` |
| Lifeweb requests, GM bypass panel | `web/app/(app)/lifeweb/requestActions.js`, `actions.js` |
| Lifeweb player buttons | `web/app/components/LifewebRequestButtons.js` |
| GM kill-the-target fallback (FEED_PERSON + HARM_CHARACTER) | `web/app/(desk)/gm/turns/actions.js#killRequestTarget` |
| The Dying clock's auto-kill | `db/lib/dyingDeathPass.js` |
| GM review rows | `web/app/(desk)/gm/turns/RequestSections.js`, `web/lib/requestLabels.js` |
| Gambit roll + modifier | `bot/src/events/interactionCreate.js#handleMoveConfirm` |
| Expiry sweep | `db/index.js#resolveNeeds` |

## The Depot's request kinds

Eight `DEPOT_*` types, all obol-denominated, all moving `Depot.accountObols`
rather than anyone's `Character.resources`: the three original
(`DEPOT_BUY`, `DEPOT_SELL`, `DEPOT_CREDIT`) plus `DEPOT_ORDER`, `DEPOT_SHIP`,
`DEPOT_ATM`, `DEPOT_CRATE_OPEN` and `DEPOT_REFUEL`.

**Two have no undo handler, deliberately.** `DEPOT_SHIP` and
`DEPOT_CRATE_OPEN` are irreversible the way a sent Bird letter is: a shuttle
that went up cannot be recalled and its cargo no longer exists to hand back,
and an opened crate has scattered its contents into an inventory that has moved
on. With no `REQUEST_EFFECTS` entry the rows stay visible on the desk and in
the Depot's own Ledger — they simply cannot be undone, which is honest. A GM
corrects one by hand.

The rest follow the ordinary rule: `effect` snapshots what actually moved and
undo reads only that. `DEPOT_ORDER` restores the manifest to the snapshot taken
before it rather than subtracting its own lines, so a second order filed since
is not silently thrown away.
