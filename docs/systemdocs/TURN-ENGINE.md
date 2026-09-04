# Turn engine

How a turn closes and the next one opens. One function owns it —
`advanceTurn()` in `db/index.js` — and everything else on this page is either a
pass it calls or a side effect it hands back.

Turns advance **once a day, 00:00 America/Chicago**, strictly alternating: a
DAWN turn opens at midnight and runs to the next midnight, then a DUSK turn
does the same. So a turn is one real day and an **in-game day is two of them**
— `Math.ceil(turn.number / 2)` still gives the day, it just takes twice as long
to get there. The schedule lives in `bot/src/events/ready.js`'s cron, and
`db/lib/turnClock.js`'s `TURN_BOUNDARY_HOURS` must agree with it. It was two
turns a day until 2026-09-03, boundaries at 00:00 and 12:00; everything counted
in turns therefore takes twice as long in real time as it used to. The advance is also **the push**: everything the GMs staged during the
closing turn — mechanical effects, private messages, public declarations, and
every Move's own declared payout — applies and delivers here, and nowhere
else. See `ADJUDICATION.md`.

## 1. Two callers, one engine

| Caller | Path | How it handles the side effects |
|---|---|---|
| The bot's cron | `bot/src/lib/turnEngine.js` (a 39-line wrapper) | Awaits the thunk inline — it's a background process, nobody is waiting. |
| The Dev Panel's "End turn" | `web/app/(app)/gm/dev/actions.js#forceAdvanceTurn` | Hands it to `next/server`'s `after()`, so the response — already carrying the committed new turn — flushes first. |

Each adds its own `AuditLog` entry. **Both must check the returned `advanced`
flag** before logging or dereferencing `newTurn`.

Manual turn control lives only in the Dev Panel, not on `/gm/turns`. The
Current Turn widget can also overwrite the open turn's day/phase directly
(`updateCurrentTurn`) *without* resolving Needs, for raw correction.

## 2. The order, and why

This sequence is the thing to know. Two steps in it are load-bearing and were
each arrived at by getting them wrong first.

1. **Claim the open turn by closing it.** An `updateMany` conditioned on
   `status: "OPEN"`. This happens **before Needs resolve**, deliberately: if a
   GM clicks just as the cron fires, exactly one caller wins and the loser
   returns `advanced: false` having done nothing. A half-resolved turn is a
   cheaper failure than a losing racer double-charging everyone's upkeep.
2. **Auto-labor pass** (`db/lib/autoLaborPass.js`) — files a Labor for anyone
   who didn't act and can work. **First**, because a day's labor *earns*
   resources and the Hunger pass below spends them; the other order makes a
   player whose work buys them a meal go hungry anyway. See `LABORING.md` §8.
2b. **Lessons pass** (`db/lib/lessonPass.js`, `"lessons"` in `TURN_PASSES`) —
   the game's first code-adjudicated Gambit. For every ACCEPTED lesson `Offer`
   on the closing turn it rolls the modified die (threshold 5 for a normal
   lesson, 4 for a fighting skill under a Drill Instructor teacher), grants
   the skill on success with `TagSource.LESSON`, and DMs both sides the die
   and the result in one line — so step 3 below skips its own 🎲 result DM
   for a Gambit whose `gmNotes` reads `auto:lesson`, since this pass already
   sent one. Every still-PENDING lesson offer on the turn expires here too,
   with a DM to the initiator. Its slot is load-bearing: **after** the
   auto-labor pass, and **before** the staged push, so the push's silent-close and
   payout logic sees the lesson's Action already resolved. See `LESSONS.md`.
3. **Staged push pass** (`db/lib/stagedPush.js`) — applies every `StagedEffect`
   the GMs queued this turn, then every confirmed Move's own declared numbers
   (nothing pays at confirm any more — a Routine, a Labor payout and a
   GM-solved Gambit all sit with `appliedEffects` null until here), and
   silently closes untouched Moves (`OPEN → PASSED`, `auto:silent_close`).
   Silent for a Gambit's *adjudication*, but every Routine and every
   hand-filed Labor gets a close DM shaped like the auto-labor one —
   description, `**Applied:**`, resource roll — because this push is the only
   place a hand-filed Routine or Labor payout is ever reported. It carries a "no adjudication notes" tail unless a private
   staged message on that Move already went to that player or a staged effect
   on it targets them, in which case the summary stands alone. The only Routine
   skipped outright is one whose `gmNotes` carry an `auto:` marker, meaning
   another pass is already DMing them about it. Every Gambit gets its own DM
   regardless: the d6 is rolled and
   stored at submit (`bot/src/lib/moveConfirm.js`) and shown to the player
   nowhere else, so this is where they find out how it fell. `/character`
   used to reveal it at Moves lock — three hours early
   (`MOVE_LOCK_HOURS`, `db/lib/turnClock.js`) — which handed players a bare
   number with no outcome attached; it now strips the die unconditionally
   (`web/app/(app)/character/page.js`).
   Its slot is load-bearing three ways: **after** the auto-labor pass
   (whose rows arrive already stamped, so this one skips them), **before**
   the progression/sweep (a staged "remove Infected" must beat the
   progression, and a staged fresh grant carries `expiresTurn > N` so the
   sweep can't eat it), and **before** Hunger (deferred income lands before
   upkeep — the same income-before-upkeep rule as step 2). Every row is
   claimed with a conditional write (`appliedAt`, or `appliedEffects` DbNull
   → `{}`), so the resume path can never apply one twice. The staged DMs and
   the public post are handed back for the thunk, not sent here.
   A payload is `{ resources?, tagPoints?, tagOps? }`. Resources go through
   `addResources`' clamp and tag ops through `db/lib/tagOps.js`, but
   `tagPoints` is a plain `increment` with no clamp — a GM may take points
   back off a sheet, and negative is a legal balance. `appliedEffect`
   snapshots each of the three that actually moved.
4. **Tag progression pass** (`db/lib/tagExpiryPass.js`) — **before** the sweep,
   never after. Any expiring tag carrying `Tag.expiresInto` turns into
   something else first: Infected festers, Festering goes both Feverish and
   Necrotic, Necrosis rolls a leg or an arm (`TAGS.md` §5c). The sweep below is
   a blind `deleteMany`, so once it has run there is nothing left to read. This
   pass grants and never deletes; the sweep removes exactly the rows it just
   read. **Nothing here kills anyone** — the terminal chains still land on the
   `dying` tag and stop. What changed is what `dying` is: a one-turn clock
   (`durationTurns: 1`) rather than a permanent flag, so pass 4b below ends it
   at the *next* close. A character who reaches the end of a chain gets a full
   turn on death's door, which is the window a medic has to reach them.
4b. **Dying death pass** (`db/lib/dyingDeathPass.js`) — the second of the
   engine's two auto-kills. Every ALIVE holder of `dying` whose
   `CharacterTag.expiresTurn` has come due dies at this close, through the same
   `applyDeathToRow` claim and the same returned-`deaths` teardown as 7b. Its
   slot is load-bearing on both sides: **after** the staged push and pass 4, so
   a staged "remove Dying" or a medic's cure landing this same close always
   beats the axe, and **before** the sweep at 5, which would otherwise delete
   the very rows that are the evidence. A `dying` row with a **null**
   `expiresTurn` is not killed — it is stamped for the next close and its
   holder warned, so nothing granted before this pass existed dies to a clock
   it was never shown. Own `resolvedPasses` marker, same as 7b: a destructive
   pass must not half-run on a resume.
5. **Expiry sweep** — delete non-stackable `CharacterTag`s whose `expiresTurn`
   has come due.
6. **Stackable sweep** (`sweepExpiredStacks`) — a stack is one row carrying a
   count, so an expiry sheds a single unit and rerolls the remainder's timer,
   deleting the row only when the last unit goes.
7. **Catatonic (AFK) pass** (`db/lib/catatonicPass.js`) — every ALIVE
   character's `lastActivityTurn` checked against `GameConfig.catatonicTurns`.
   Slotted **after** the sweep for the same reason Hunger is below: it reads
   and writes `CharacterTag` rows and must not race the sweep over the same
   table. Unlike every other pass here, it also **clears** its own tag —
   there is no `durationTurns` on `catatonic-afk`, so nothing sweeps it; the pass
   grants it when a character goes stale and deletes it the moment their
   clock moves again. A character whose player **left the guild**
   (`Character.leftGuildAt`, set by `db/lib/playerDeparture.js`) reads as
   stale whatever their clock says — their clock can never move again, and
   without the override the tag granted at leave time would be cleared at
   the very next close. The pass also stamps `Character.catatonicSinceTurn`
   when it grants and nulls it when it clears — the death countdown below.
   Ordering against Caving/Hunger doesn't matter; it touches neither
   resources nor the Hunger streak.
7b. **Catatonic death pass** (`db/lib/catatonicDeathPass.js`) — the other
   automatic death, alongside 4b. A character
   who has held `catatonic-afk` for `GameConfig.catatonicDeathTurns` consecutive
   turns (default 4; **0 is the off switch**, a Dev Panel dial needing no
   deploy) dies at this close, outright: the DB half of death runs here via
   `db/lib/characterDeath.js#applyDeathToRow` (shared with
   `killCharacter` so the two death paths can't drift — conditional
   `status: "ALIVE"` claim, so a resumed turn can never kill twice), and the
   Discord teardown — access revoke, role delete, Cursed grant **only if
   the player is still in the guild**, death DM, one combined `#leave`
   alert — rides back on `deaths` for the thunk. A separate pass rather
   than a branch of 7, deliberately: it must run strictly **after** 7's
   clear branch so a character who woke this close can never be killed by
   it, and a destructive pass gets its own `resolvedPasses` marker. The
   countdown clock is `catatonicSinceTurn`, not `lastActivityTurn`, so a GM
   moving `catatonicTurns` mid-game doesn't move anyone's execution date; a
   GM hand-grant with no stamp never counts down at all. Players one close
   from death get a warning DM (`warnings`), same posture as the
   Disappointed track's.
7c. **Bird pass** (`db/lib/birdPass.js`) — the delayed half of the Bird
   (`BIRD.md`). A letter whose zone guess missed, or whose recipient was
   already dead, resolved into nothing when it was sent; this is what finally
   tells the sender so, one turn later. **The delay is the mechanic, not a
   scheduling detail** — an instant answer would make a Bird a once-a-day
   oracle for whether a named person is alive in a named zone. Slotted
   deliberately **after** both auto-kills, so a sender who died this same close
   is already dead when the notice is composed and the passes cannot disagree
   about writing to them. The `failureNotifiedAt` stamp it writes IS its claim,
   so a resumed close cannot tell the same sender twice; own `resolvedPasses`
   marker for the same reason. DMs ride back on `notices` for the thunk.
8. **Hunger pass** (`db/lib/hungerPass.js`) — **after** the sweep, never
   before. Last turn's Hunger carries `expiresTurn` equal to the closing turn's
   number, so the sweep clears it a moment before a fresh one may be granted.
   The other order collides with `@@unique([characterId, tagId])` and silently
   drops the re-grant, leaving a tag that expires immediately.
8b. **Carry pass** (`db/lib/carryPass.js`) — **after** hunger, so it sees the
   final sheet: Labor payouts, staged pushes, the sweep and the ⬢ upkeep all
   happen earlier in the close and none of them may settle in place.
   `settleCarry` for every ALIVE character holding a tradeable tag,
   Overburdened, or more ⬢ than the base cap — one transaction each — and the
   overflow drops ride back for the thunk (`CARRY.md` §3).
9. **Lifeweb decay** — a fixed `lifewebDecayPerTurn` off `GameConfig.lifewebBlood`.
10. **Open the next turn** with the alternated phase, and roll its weather (§4).
11. **Write the `TURN_START` archive row** — here, where the turn is created,
   rather than in the side effects, so a failed announcement can't leave two
   days with no boundary in the transcript.
12. **The Caving Die** (`db/lib/cavingPass.js#runCavingPass`) — every ALIVE
   character standing in a `CAVE_LEVEL` zone rolls, against the turn that just
   opened at step 10, **not** the one every pass above this closed. It is
   deliberately not one of `TURN_PASSES` / steps 2–9: those all operate on the
   closing turn, and the die is supposed to roll for the turn a player is about
   to spend in the Depths. It used to be step 5.5 (after the sweep, before
   Hunger) and ran against the closing turn — which meant an arrival roll made
   earlier that same turn had already claimed the row, so the pass itself
   rolled nothing. Own try/catch that never rethrows, since a throw here would
   abort the turn announcement below it for the sake of one missed die. See
   `docs/systemdocs/CAVING.md` §2.
13. **Return `runSideEffects`** — see §3. Nothing above this line talks to
   Discord; nothing below it touches the database.

**`needsResolvedAt` is stamped only when every pass in `TURN_PASSES` has been
recorded.** A pass that throws leaves the turn advancing — a stuck turn is
worse than a missed upkeep — but the turn stays unstamped, so the next advance
picks it up and re-runs only what never landed. It used to be stamped
unconditionally, which meant a hunger pass that failed at 04:00 was written off
as resolved and nobody ever ate that day's upkeep.

Two things follow from that, and both are load-bearing:

- A pass with **nothing to do returns an object, not `null`**. `null` is
  reserved for "this pass did not run, retry it" — the value `resolveNeeds`'s
  own catch returns. `autoLaborPass` and `tagExpiryPass` used to return
  `null` for both, so a game with no default efforts (or, far more often, a
  turn with nothing expiring) never recorded the pass at all.
- The **resume path claims `Turn.needsResumeClaimedAt`** before it does
  anything, with the same conditional `updateMany` the normal path uses on
  `status: "OPEN"`, and a 30-minute staleness window so a resume that dies
  holding the lease can't wedge the turn. `resolvedPasses` is not a lock, and
  `needsResolvedAt` is the completion stamp rather than a lease, so neither
  could do this job.

## 3. The side-effect thunk

`advanceTurn` **composes but does not run** the Discord work. It returns
`{ advanced, previousTurn, newTurn, note, runSideEffects }`, and the caller
decides when the thunk runs.

That split is load-bearing. The Dawn wipe walks every zone's channels
sequentially; awaiting it inside a server action holds the action open, and a
pending server action blocks client-side navigation — which froze the entire
web app until a hard refresh.

The thunk performs, in narrative order:

1. Public staged posts (via `postAsCharacter`, the REST twin of the
   bot's webhook proxy), each archived only once Discord accepts it.
2. Auto-labor DMs.
3. Tag progression DMs — one per player whose condition worsened, listing each
   step (`» Festering → Feverish and Necrosis`). Before the Hunger DMs purely
   so the two arrive in severity order.
3b. The Catatonic DMs and role renames, then the death pass's work: the
   eve-of-death warning DMs, and per death the Discord teardown — membership
   check first (Cursed grant, nickname clear and death DM go only to a
   player **still in the guild**; for a departed one each would just 403
   into the REST breaker's tally), then access revoke, role delete, and one
   combined `#leave` post naming everyone who died this turn.
4. Hunger DMs — one per player who starved, or who ate and still carries some
   of the streak, or who just cleared the last of it. A quiet −1 ⬢, or a fed
   character whose streak was already 0, sends nothing.
5. **The staged deliveries** — every unsent `StagedMessage` for the closing
   turn. PRIVATE rows fan out one DM per recipient (per-recipient try/catch,
   failures collected onto the row's `deliveryFailures` and into one
   `staged_push_delivery_failed` audit row naming who); PUBLIC rows post to
   **the row's own zone `#summary`** (the composer requires a real zone — no
   fallback). If that zone's summary channel isn't configured, the post is
   skipped and recorded instead — never lost. Each row is stamped `sentAt` only after its sends were attempted, so a
   crash mid-way leaves the remainder visibly unsent — the workspace's
   missed-push banner — rather than falsely delivered.
6. The `#turns` announcement (`db/lib/turnAnnouncement.js`).
7. The Dawn wipe, if the new phase is `DAWN` and `GameConfig.messageWipeEnabled`
   is on (`db/lib/dawnWipe.js`; see `CHANNELS.md` §8). It is handed a
   **cutoff** — a timestamp the thunk takes as its very first statement, before
   any Discord call — and deletes nothing created at or after it. That is what
   lets the slow wipe stay last in the order without eating the summaries step
   5 just posted. Move the cutoff and you reintroduce that bug.
8. The thread expiry pass, on **every** Dawn, unconditionally. After the wipe
   on purpose, so a thread the wipe just deleted isn't also "expired"
   (`db/lib/threadExpiryPass.js`; `CHANNELS.md` §4).
9. The channel doctor's **cheap** reconcile, if `GameConfig.autoReconcileEnabled`
   is on — roles and membership only, a handful of requests
   (`db/lib/channelDoctor.js`; `CHANNELS.md` §6).

Everything is sequential and individually `.catch()`'d, so a Discord failure
never blocks the turn. The Dawn wipe additionally guards **per zone**, so
one channel a GM deleted by hand costs that room rather than every room after
it plus `#watch`. **Never `Promise.all` a fan-out here** — sequential
awaiting is what keeps the bot from emitting the burst of 429s that earns an
IP-level ban.

All three passes follow the same discipline: `runHungerPass` returns
`starvedDiscordUserIds`, `runAutoLaborPass` returns `dms`, and
`runTagExpiryPass` returns `dms`, rather than any of them sending anything
themselves — so none makes a network call and none can hold a turn advance
open. Each also writes exactly **one** summary `AuditLog` row
(`tag_expiry_resolved` for the new one), never one per character: at 100+
players a per-character row would drown every human-authored line in
`/gm/audit`.

## 4. Weather

`db/weather.js`. Weather rolls every turn as a **Markov transition off the
previous turn's weather**, with separate DAWN and DUSK tables so the roll also
depends on which phase is being entered. `WEATHER_WEIGHTS` is the base
distribution, used only for the very first turn the game plays.

The tuning is deliberate:

- **The diagonal creates streaks.** CLEAR and RAIN are "spell" states that run
  several turns together — a clear spell, three turns of rain.
- **STORM has the highest self-transition in either table.** Every other state
  enters STORM rarely, but once one kicks off it can rage for days. Rare but
  genuinely possible, rather than diluted away by restarting each turn.
- **FOG is the phase-dependent one.** The DAWN table both enters and holds fog
  far more readily; the DUSK table mostly resolves it back to CLEAR. Mornings
  are foggy and it burns off by evening.

A GM can override the next turn's weather from the Dev Panel
(`GameConfig.nextWeather`); leaving it unset means "roll randomly".

### Weather banners

Each turn announcement carries a photo of the weather,
one per weather **per phase** — eight images in
`docs/assets/weather/{weather}-{phase}.jpg`, each a genuine dawn or dusk
photograph, cropped to the same 2446×1122 frame as the `#info` banner by
`docs/assets/make-weather.py` so both channels read as one system.

How it is posted (`db/lib/turnAnnouncement.js`): **`#turns` is ONE rolling
message**, replaced each turn, carrying the announcement, the banner and the
player console together. Discord renders content, then attachments, then
components, which is exactly the order wanted:

```
DAY 4 · DUSK · Rain          <- content
[ weather banner ]           <- attachment
Travel   Move   Speak        <- components, always last
```

It was three messages once — banner, announcement, and a console anchor
deliberately kept separate so it would not "jump above and below the
announcement twice a day". The cost of holding it still was worse: the
announcement reposted *beneath* it every turn, so the buttons sank up the
channel until players stopped finding them, and a wipe of `#turns` (Restart
Game) left them gone entirely until the next bot restart. One message has no
ordering problem to solve. (Restart Game no longer leaves the channel empty
either: `finishGameWipe` calls `postTurnsAnnouncement` for the fresh Turn 1
right after the channel wipe, since a wipe opens Turn 1 directly and never
runs the thunk this section describes.) Tracked on `GameConfig.turnsConsoleChannelId` /
`turnsConsoleMessageId`; `turnsAnnouncementMessageId` and
`turnsBannerMessageId` are no longer written.

A missing image file is not an error — `weatherBannerPath()` returns null and
the announcement posts alone. A banner is worth losing; a turn announcement
is not. That also covers `docsPath()` itself coming back null: the guard is at
the top of `weatherBannerPath`, because `path.join(null, …)` throws, and it
threw one line above the `existsSync` that was supposed to be the graceful
exit — taking the announcement, the console text and the button row with it.

## 5. Hunger

A `hungry` Status tag in `docs/tags.yaml` (`durationTurns: 1`), stacking
additively with Mood. The penalty escalates: **−1 to the die per consecutive
turn gone hungry**, read off `Character.hungerStreak` and floored at **−6**
(`HUNGER_STREAK_CAP` in `db/lib/hungerPass.js`) — see `db/lib/gambitModifier.js`
for how the streak and Mood combine into one number. Reaching the cap grants
`dying` with a one-turn clock; nothing here kills anyone, same as every other
terminal tag chain (§3) — the Dying death pass (§2 4b) is what finishes at the
next close what starving started, and the Catatonic death pass (§2 7b) is the
other. Nothing player-initiated ever grants or removes Hunger, the
streak, or Dying via this path — no request type, no picker entry.
`db/lib/hungerPass.js#runHungerPass` is the only writer of all three.

Per character, at the close of every turn:

| State | Outcome |
|---|---|
| Holds `hungerless` | Skipped entirely; streak resets to 0 (immunity, not eating — a full reset). |
| Holds `fast-metabolism` | Owes **2 ⬢** instead of 1. Everything else below reads against that cost. |
| Holds `ate-meal` | **Shielded**, tag consumed, **owes nothing**, streak drops by **one tick** — the meal was already paid for when it was cooked (2 ⬢ Fine, 3 ⬢ Lavish), so billing upkeep on top made eating strictly worse than the 1 ⬢ it saves. |
| Short of the cost | Goes Hungry, owes **nothing**, streak **+1**. A fast metabolism holding 1 ⬢ keeps it rather than half-eating. |
| Can cover the cost | Pays it, stays fed, streak drops by **one tick**. |

So **the upkeep always buys a fed turn** — 1 ⬢, or 2 with Fast Metabolism —
and `Character.resources` can never go
negative without a `Math.max` — the clamp is a `resources: { gte: n }` on the
decrement's own `where`, so the check and the payment are one statement. That
pairing is why the two costs are two separate `updateMany` batches (`toPay1` /
`toPay2`) rather than one: an `updateMany` carries a single decrement, and a
guard that didn't match its own decrement would be the hole the clamp exists
to close. They
used to be two, with the whole pass between them, and anyone who spent their
last ⬢ in that window went to −1.

A single fed turn only clears **one tick** of the streak, not the whole thing
— a character six turns deep in Hunger needs six fed turns to climb back to
0, the same way it took six starved turns to get there. The `hungry` tag
itself is re-granted for as long as the streak is above 0 after eating, not
only on a turn actually spent starving — so its meaning is "carrying hunger
damage", not "starved this turn". A Hunger granted while closing turn N
carries `expiresTurn = N + 1`, so it bites for exactly turn N+1; eating on
turn N is what decides whether it's re-granted for N+1, at one point lower
than it was.

The streak itself has no `expiresTurn` of its own — it's a plain Int column,
computed in the pass off the value it already read, not off a DB
`increment`/`decrement` return (neither hands back the new total in time to
decide who crosses the cap, or who still carries Hunger after eating, this
turn). Only starving ever pushes it up; eating only ever brings it down, one
tick per turn, floored at 0 the same structural way the resource decrement is
floored — a `hungerStreak: { gt: 0 }` where-guard, not a `Math.max`. It keeps
counting past 6 if nobody intervenes; the penalty just stays floored there,
and re-granting `dying` on a later starved turn is a harmless `skipDuplicates`
no-op.

One summary `hunger_resolved` audit row per turn, not one per character: at
100+ players the latter would drown `/gm/audit`.

Full writeup: `REQUESTS.md` §4.

### 5a. Nobility upkeep (Disappointed)

The same pass runs a parallel track for characters holding `nobility`: each
turn close **without** the `ate-meal` shield ticks `Character.missedMealStreak`
up — paying the 1 ⬢ upkeep is commoner food and does not count. At
**3 missed days** (`DISAPPOINTMENT_THRESHOLD` in `db/lib/hungerPass.js`) the
pass grants `disappointed`: a flat **−1 to Gambits**
(`db/lib/gambitModifier.js`), no expiry. A warning DM goes out at 2 missed
days, one more DM when the tag lands, and nothing in between.

Unlike the hunger streak there is no slow climb back down: **one Fine or
Lavish Meal settles the whole count.** Consuming anything that becomes
`ate-meal` clears the tag **on the spot** and the pass resets the count to 0
at the next close (`web/app/(app)/character/requestActions.js`; the pass's
shielded-branch delete is only the backstop for meals a GM granted directly).
Undoing the CONSUME_TAG request puts the Disappointment back off the
`cleared` snapshot on the request effect.

Hungerless and Dying nobles are exempt — a hungerless noble's count freezes
where it is. The player-facing tracker is the **Dinner row** on the sheet's
Status panel (`web/app/components/StatusPanel.js`), which counts missed days
against the threshold and flips to a Condition row once the tag lands.

## 6. Auto-labor

There is no Default Move any more. `DefaultEffort` and its `/character` panel
are deleted: filing nothing IS the standing order, and what it buys you is a
day's work.

`db/lib/autoLaborPass.js#runAutoLaborPass` walks every `ALIVE` character with
**no `Action` at all** on the closing turn — an auto-resolved zone change
counts as acting, since crossing zones spends the day — and files a `LABOR`
Move: `CONFIRMED`/`PASSED`, resources pushed via `applyMoveEffects` and
snapshotted onto `appliedEffects`. That snapshot is what tells the staged push
pass, one step later, to skip these rows. **Never a Gambit** — a Gambit is a
deliberate risk and nobody's there to take it. Marked `gmNotes: "auto:labor"`.

Four kinds of character are skipped, and all four are skipped **silently** — no
Action, no Resources, no DM:

- **Incapacitated** (`db/lib/incapacitation.js`'s `INCAPACITATING_SLUGS`:
  `dying`, `catatonic-afk`, `paralyzed`, `bound`). They didn't get a turn to
  try. The tag itself is the explanation, and this is why binding someone
  actually costs them their next turn rather than just their ability to defend
  themselves (`REQUESTS.md` §5b).
- **No Laboring tag at all.** Labor is a skill now, not a floor — a character
  without one who does nothing has simply done nothing.
- **Exhausted.** They worked last turn; one labor per turn, which is one a day.
- **Standing where none of their skills reach** — no `LocationYield` row of any
  kind they hold. Filing an empty Move to say so would only clutter the desk.

The rate resolves **at pass time** (`db/lib/laborAccess.js`), against the
Location the character is standing in that night, that location's live yield
coefficients, and the `productionCoefficient` in force — all from bulk reads,
never per character.

One summary `auto_labor_resolved` audit row per turn, reporting `filed` and
`skipped`.

The old summary-post half (`shareInSummary` / `summaryMessage`) died with
`DefaultEffort`; the pass returns `dms` only.

## 6b. Labor yield drift

`"laborYield"` in `TURN_PASSES` (`db/lib/laborYield.js#runLaborYieldPass`)
walks every `LocationYield` row one turn forward — a mean-reverting random walk
plus rare jump events. Its slot is late and load-bearing: **after** the
auto-labor pass, so a day is paid at the coefficients that were live during it,
and what it writes is what the next turn is worth.

It is random and therefore **not idempotent**. That is exactly why it is a
named pass rather than inline work: `markDone` is what stops a resumed turn
advance from drifting the whole map twice. The full parameter table is in
`LABORING.md` §7.

## 6a. The Move cutoff

Moves close **three hours before the turn ends** (`MOVE_LOCK_HOURS` in
`db/lib/turnClock.js`) — 9:00 PM America/Chicago on a normal turn — so a GM has
a window to adjudicate what was filed before the push runs.

Nothing stores a turn's end time, so it is derived: `turnEndsAt(turn)` is the
first `TURN_BOUNDARY_HOURS` Chicago boundary strictly after `turn.startedAt` —
now just 00:00, regardless of phase (a turn a GM opened by hand at 13:00 really
does end at the coming midnight, eleven hours later, rather than running a full
24) — and `moveCutoffAt(turn)` is that minus three hours. Deriving from
`startedAt` rather than from *now* is what makes a manually advanced turn come
out right — and it fixes a live bug in the announcement, which the bot rebuilds
on restart and which used to say "ends at noon" six hours after noon.

`moveWindow(turn, { now, autoTurnAdvanceDisabled })` returns
`{ endsAt, cutoffAt, locked, hasLock }`. There is **no lock at all**
(`hasLock: false`) in two cases: `GameConfig.autoTurnAdvanceDisabled` is on, so
there is no scheduled end to count back from; or the turn is shorter than three
hours, which a manual advance at, say, 11:00 produces — counting back would
otherwise lock the whole turn the moment it opened. `locked` is true only
*between* the cutoff and the end, so a turn that outlives its derived end (a
missed cron) reopens rather than staying shut forever.

Enforced in the bot at both `move:open` (the `#turns` button and `/move`) and
on modal submit — a modal can sit open on screen across the cutoff — with an
ephemeral refusal naming both times. **Travel, Speak, requests, GM edits and
the auto-labor pass are not affected**: the cutoff is about the Move queue a
GM has to read, and a standing default files itself at the push.

Surfaced to players on the `#turns` announcement (`Moves must be sent by
<t:C:t>`, added by `buildTurnAnnouncement` when `hasLock`), in `/character`'s
"This turn" row, and in the handbook.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/index.js` | `advanceTurn`, `resolveNeeds`, `sweepExpiredStacks` |
| `db/weather.js` | The Markov tables and `rollWeather` |
| `db/lib/turnClock.js` | Turn end / Move cutoff derivation (§6a) |
| `db/lib/stagedPush.js` | The staged push pass (`ADJUDICATION.md`) |
| `db/lib/autoLaborPass.js` | The auto-labor pass |
| `db/lib/laborYield.js` | Location yield drift, and the quality words |
| `db/lib/hungerPass.js` | The Hunger pass |
| `db/lib/catatonicPass.js` | The Catatonic (AFK) flagging pass |
| `db/lib/catatonicDeathPass.js` | The Catatonic death pass (§2 7b) |
| `db/lib/dyingDeathPass.js` | The Dying death pass (§2 4b) |
| `db/lib/characterDeath.js` | The shared DB half of death (`applyDeathToRow`) |
| `db/lib/playerDeparture.js` | Guild-leave marking, shared by the live handler and the startup reconcile |
| `db/lib/tagExpiryPass.js` | The tag progression pass (`Tag.expiresInto`) |
| `db/lib/turnAnnouncement.js` | The rolling `#turns` announcement |
| `db/lib/dawnWipe.js` | The Dawn wipe (`CHANNELS.md` §8) |
| `db/lib/threadExpiryPass.js` | Inactivity expiry for player threads (`CHANNELS.md` §4) |
| `db/lib/channelDoctor.js` | The optional post-turn reconcile (`CHANNELS.md` §6) |
| `bot/src/lib/turnEngine.js` | The cron caller |
| `bot/src/lib/moveModal.js` | The Move modal a player files a Move through (`COMMANDS.md`) |
| `bot/src/lib/moveConfirm.js` | Resolving a filed Move |
| `web/app/(app)/gm/dev/actions.js` | `forceAdvanceTurn`, the GM caller |

## The Depot pass

`db/lib/depotPass.js`, registered in `TURN_PASSES` as `"depot"` and run **last**
— after `lifewebDecay` — so the turret fires on the sheet every other pass left
behind, in particular the armour the carry pass may have made somebody drop.

It does three things:

- **Generator burn.** `Depot.fuelBurnPerTurn` off `Depot.generatorFuel` while it
  is running. Reaching zero switches `generatorOn` off, so the Merchant has to
  deliberately restart it after refuelling rather than having it come back on
  its own.
- **Shuttle clock.** A `DOCKED` shuttle leaves on its own after
  `Depot.shuttleMaxTurns`. A timed departure takes **nothing** with it — the
  crates stay on the pad. Selling is a deliberate act.
- **Turret sweep.** Everyone standing in the Depot whose presented name is not
  `Depot.merchantFace` takes a roll. Only when the generator is running and the
  turret is armed.

Like every other pass it returns its side effects — `lines` (ambient lines the
caller speaks into the Depot channel) and `dms` — rather than making a network
call. The turret's **other** trigger is on arrival, in
`db/lib/locationMove.js`, deliberately before that function's `DISCORD_TOKEN`
guard: being shot is a database fact and must not depend on there being a token
to announce it with.

See `docs/systemdocs/DEPOT.md` §0c, §0d and §0f.
