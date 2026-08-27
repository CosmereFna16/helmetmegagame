# Turn engine

How a turn closes and the next one opens. One function owns it —
`advanceTurn()` in `db/index.js` — and everything else on this page is either a
pass it calls or a side effect it hands back.

Turns advance **twice a day, 12:00 and 00:00 America/Chicago**, strictly
alternating: a DAWN turn opens at noon and runs to midnight, a DUSK turn opens
at midnight and runs to noon. The schedule lives in `bot/src/events/ready.js`'s
cron. The advance is also **the push**: everything the GMs staged during the
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
2. **Default Move pass** (`db/lib/defaultMovePass.js`) — files a Move for
   anyone who didn't act. **First**, because a default can *earn* resources and
   the Hunger pass below spends them; the other order makes a player whose
   default buys them a meal go hungry anyway.
3. **Staged push pass** (`db/lib/stagedPush.js`) — applies every `StagedEffect`
   the GMs queued this turn, then every confirmed Move's own declared numbers
   (nothing pays at confirm any more — a Routine, a `/labor` payout and a
   GM-solved Gambit all sit with `appliedEffects` null until here), and
   silently closes untouched Moves (`OPEN → PASSED`, `auto:silent_close`, no
   DM). Its slot is load-bearing three ways: **after** the Default Move pass
   (whose rows arrive already stamped, so this one skips them), **before**
   the progression/sweep (a staged "remove Infected" must beat the
   progression, and a staged fresh grant carries `expiresTurn > N` so the
   sweep can't eat it), and **before** Hunger (deferred income lands before
   upkeep — the same income-before-upkeep rule as step 2). Every row is
   claimed with a conditional write (`appliedAt`, or `appliedEffects` DbNull
   → `{}`), so the resume path can never apply one twice. The staged DMs and
   the public post are handed back for the thunk, not sent here.
4. **Tag progression pass** (`db/lib/tagExpiryPass.js`) — **before** the sweep,
   never after. Any expiring tag carrying `Tag.expiresInto` turns into
   something else first: Infected festers, Festering goes both Feverish and
   Necrotic, Necrosis rolls a leg or an arm (`TAGS.md` §5c). The sweep below is
   a blind `deleteMany`, so once it has run there is nothing left to read. This
   pass grants and never deletes; the sweep removes exactly the rows it just
   read. **Nothing here kills anyone** — the terminal chains land on the
   `dying` tag and stop, and a GM confirms the death by hand.
5. **Expiry sweep** — delete non-stackable `CharacterTag`s whose `expiresTurn`
   has come due.
6. **Stackable sweep** (`sweepExpiredStacks`) — a stack is one row carrying a
   count, so an expiry sheds a single unit and rerolls the remainder's timer,
   deleting the row only when the last unit goes.
7. **Hunger pass** (`db/lib/hungerPass.js`) — **after** the sweep, never
   before. Last turn's Hunger carries `expiresTurn` equal to the closing turn's
   number, so the sweep clears it a moment before a fresh one may be granted.
   The other order collides with `@@unique([characterId, tagId])` and silently
   drops the re-grant, leaving a tag that expires immediately.
8. **Lifeweb decay** — a fixed `lifewebDecayPerTurn` off `GameConfig.lifewebBlood`.
9. **Open the next turn** with the alternated phase, and roll its weather (§4).
10. **Write the `TURN_START` archive row** — here, where the turn is created,
   rather than in the side effects, so a failed announcement can't leave two
   days with no boundary in the transcript.
11. **Return `runSideEffects`** — see §3. Nothing above this line talks to
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
  own catch returns. `defaultMovePass` and `tagExpiryPass` used to return
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

That split is load-bearing. The Dawn wipe walks every Location's channels
sequentially; awaiting it inside a server action holds the action open, and a
pending server action blocks client-side navigation — which froze the entire
web app until a hard refresh.

The thunk performs, in narrative order:

1. Default Move summary posts (via `postAsCharacter`, the REST twin of the
   bot's webhook proxy), each archived only once Discord accepts it.
2. Default Move DMs.
3. Tag progression DMs — one per player whose condition worsened, listing each
   step (`» Festering → Feverish and Necrosis`). Before the Hunger DMs purely
   so the two arrive in severity order.
4. Hunger DMs — one per starved player. A quiet −1 ⬢ sends nothing.
5. **The staged deliveries** — every unsent `StagedMessage` for the closing
   turn. PRIVATE rows fan out one DM per recipient (per-recipient try/catch,
   failures collected onto the row's `deliveryFailures` and into one
   `staged_push_delivery_failed` audit row naming who); PUBLIC rows post to
   `GameConfig.turnSummaryChannelId` (unset → skipped and recorded, never
   lost). Each row is stamped `sentAt` only after its sends were attempted,
   so a crash mid-way leaves the remainder visibly unsent — the workspace's
   missed-push banner — rather than falsely delivered.
6. The `#turns` announcement (`db/lib/turnAnnouncement.js`).
7. The Dawn wipe, if the new phase is `DAWN` and `GameConfig.messageWipeEnabled`
   is on (`db/lib/dawnWipe.js`; see `CHANNELS.md` §5).

Everything is sequential and individually `.catch()`'d, so a Discord failure
never blocks the turn. The Dawn wipe additionally guards **per location**, so
one channel a GM deleted by hand costs that room rather than every room after
it alphabetically plus `#watch` and `#intercom`. **Never `Promise.all` a fan-out here** — sequential
awaiting is what keeps the bot from emitting the burst of 429s that earns an
IP-level ban.

All three passes follow the same discipline: `runHungerPass` returns
`starvedDiscordUserIds`, `runDefaultMovePass` returns `posts`/`dms`, and
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
`docs/assets/weather/{weather}-{phase}.jpg`, built by
`docs/assets/make-weather.py` in the same 2446×1122 frame as the `#info`
banner so both channels read as one system.

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

A `hunger` Status tag in `docs/tags.yaml` (`durationTurns: 1`), stacking
additively with Mood. The penalty escalates: **−1 to the die per consecutive
turn gone hungry**, read off `Character.hungerStreak` and floored at **−6**
(`HUNGER_STREAK_CAP` in `db/lib/hungerPass.js`) — see `db/lib/gambitModifier.js`
for how the streak and Mood combine into one number. Reaching the cap grants
`dying`, permanently; nothing here kills anyone, same as every other terminal
tag chain (§3). Nothing player-initiated ever grants or removes Hunger, the
streak, or Dying via this path — no request type, no picker entry.
`db/lib/hungerPass.js#runHungerPass` is the only writer of all three.

Per character, at the close of every turn:

| State | Outcome |
|---|---|
| Holds `hungerless` | Skipped entirely; streak resets to 0. |
| Holds `ate-meal` | **Shielded**, tag consumed, **owes nothing**, streak resets to 0 — the meal was already paid for when it was cooked (2 ⬢ Fine, 3 ⬢ Lavish), so billing upkeep on top made eating strictly worse than the 1 ⬢ it saves. |
| Has 0 ⬢ | Goes Hungry, owes nothing, streak **+1**. |
| Has 1+ ⬢ | Pays 1 ⬢, stays fed, streak resets to 0. |

So **1 ⬢ always buys a fed turn** — and clears the streak — and
`Character.resources` can never go negative without a `Math.max` — the clamp
is a `resources: { gte: 1 }` on the decrement's own `where`, so the check and
the payment are one statement. They used to be two, with the whole pass
between them, and anyone who spent their last ⬢ in that window went to −1. A
Hunger granted while closing turn N carries `expiresTurn = N + 1`, so it bites
for exactly turn N+1 — which is what makes `ate-meal`'s "won't go hungry next
turn" literally true.

The streak itself has no `expiresTurn` of its own — it's a plain Int column,
computed in the pass off the value it already read, not off a DB `increment`
return (which wouldn't hand back the new total in time to decide who crosses
the cap this turn). It keeps counting past 6 if nobody intervenes; the penalty
just stays floored there, and re-granting `dying` on a later starved turn is a
harmless `skipDuplicates` no-op.

One summary `hunger_resolved` audit row per turn, not one per character: at
100+ players the latter would drown `/gm/audit`.

Full writeup: `REQUESTS.md` §4.

## 6. Default Moves

The "Default Move" panel on `/character` (`DefaultEffortPanel.js` →
`setDefaultEffort`, one `DefaultEffort` row per character) is the fallback for
a turn a player never files anything on.
`db/lib/defaultMovePass.js#runDefaultMovePass` finds every `ALIVE` character
holding one with **no `Action` at all** on the closing turn — an auto-resolved
zone change counts as acting — and files one.

What it files is always a **Routine**: `CONFIRMED`/`PASSED`, resources pushed
via `applyMoveEffects` and snapshotted onto `appliedEffects`. This pass runs
*at* the push, so applying immediately here lands at the same moment a
hand-locked Routine's deferred payout does — and the stamped snapshot is what
tells the staged push pass, one step later, to skip these rows. **Never a
Gambit** — a Gambit is a deliberate risk and nobody's there to take it. Marked
`gmNotes: "auto:default_move"`.

Three details:

- The `+N` / `5-12` / `/hunt` notation is parsed out of `description` **at
  resolution time** (`db/lib/resourceDelta.js`), not at save time — so no extra
  columns, the player keeps seeing the text they typed, and a written roll
  actually re-rolls each turn.
- A `/hunt`-style shorthand resolves from three bulk reads, not per character.
  A gated Default Move still files (they did spend the day trying) but pays
  nothing, and carries a `gateNote` into the player's DM.
- The summary posts to the character's **current** Location's plain channel,
  not the `summaryChannelId` snapshotted when they saved the panel — so
  travelling moves where their default gets narrated.

One summary `default_moves_resolved` audit row per turn. It reports
`shareable` rather than `shared`, since the posts haven't been attempted when
it's written and claiming a success count would be a lie.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/index.js` | `advanceTurn`, `resolveNeeds`, `sweepExpiredStacks` |
| `db/weather.js` | The Markov tables and `rollWeather` |
| `db/lib/stagedPush.js` | The staged push pass (`ADJUDICATION.md`) |
| `db/lib/defaultMovePass.js` | The Default Move pass |
| `db/lib/hungerPass.js` | The Hunger pass |
| `db/lib/tagExpiryPass.js` | The tag progression pass (`Tag.expiresInto`) |
| `db/lib/turnAnnouncement.js` | The rolling `#turns` announcement |
| `db/lib/dawnWipe.js` | The Dawn wipe (`CHANNELS.md` §5) |
| `bot/src/lib/turnEngine.js` | The cron caller |
| `bot/src/lib/moveModal.js` | The Move modal a player files a Move through (`COMMANDS.md`) |
| `bot/src/lib/moveConfirm.js` | Resolving a filed Move |
| `web/app/(app)/gm/dev/actions.js` | `forceAdvanceTurn`, the GM caller |
