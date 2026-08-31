# Adjudication

`/gm/turns` — the workspace where GMs arbitrate the turn. Rebuilt around one
rule after the first playtest broke the old flow:

> **Nothing a GM decides touches a player until the turn ends.**

A player locks in a Move; GMs spend the day *staging* — the canonical result,
private messages, public declarations, mechanical adjustments — all of it
freely editable until the turn-end cron (12:00/00:00 America/Chicago,
`TURN-ENGINE.md`) applies and delivers everything in one push. No more
resolve-a-move, DM-a-player, resolve-the-next drip: the whole turn lands at
once, for everyone.

## 1. The staged-arbitration model

Three kinds of staging, all held in real tables (not browser state — a GM's
day of work survives a refresh):

| What | Model | At the push |
|---|---|---|
| **Private messages** | `StagedMessage` (kind `PRIVATE`) + `StagedMessageRecipient` | One DM per recipient character's player, `»`-prefixed, logged to `DirectMessage` like every DM. |
| **Public declarations** | `StagedMessage` (kind `PUBLIC`, required `zoneId`) | Posted to **the row's own zone `#summary`**. The composer requires a real, standable zone (the `Caves` group seat is excluded from the picker), so a row always has one to post to. If that zone's summary channel isn't configured, the post is skipped and recorded on `deliveryFailures` — never lost. A post survives the Dawn wipe that runs later in the same push: the wipe only deletes what predates the push (`CHANNELS.md` §8). |
| **Mechanical adjustments** | `StagedEffect` — `payload` `{ resources?, tagPoints?, tagOps?, zoneId? }` per target character | Resources through `addResources`' clamp, tag ops through `db/lib/tagOps.js` — the same engine the Dev Panel applies with. `tagPoints` is an unclamped increment (a GM may take points back, and negative is legal). `appliedEffect` snapshots what actually moved (the payload-vs-effect rule from `REQUESTS.md` §2). |
| **Transfers** | `StagedEffect` — `payload` `{ transfer: { from, to, amount } }`, mutually exclusive with `resources` | A party-to-party ⬢ move, not a mint/burn from nowhere — either end may be a character or a faction Silo, via `db/lib/parties.js` and `db/lib/resourceTransfer.js#applyTransfer` (the same primitive the player's `TRANSFER_RESOURCES` request and every GM transfer surface use). `targetCharacterId` is nullable to allow **Silo → Silo**: it files the row under the character end if there's exactly one, the recipient if both ends are characters, and null otherwise. Staged from the tray's own "+ Transfer" button (`TransferComposer.js`), separate from the multi-target Effect composer because a transfer is 1:1 by nature. |

### Long messages split; they are never truncated

Both kinds cap at **6000 characters** (`GM_MESSAGE_MAX_LENGTH`), which is about
three Discord messages, not one. Anything over Discord's own 2000-character
limit is split by `chunkMessage` (`db/lib/chunkText.js`) and sent as several
messages in order — DMs through `postDmBatched`, public declarations through
`postMessageBatched`. The split prefers blank lines, so paragraphs stay intact;
only a single paragraph that alone exceeds 2000 is cut mid-sentence. The `»`
prefix lands on the first chunk only, which is what the prefix rule means
anyway.

The composers show the count and refuse to stage over the cap, leaving a long
paste **visible and trimmable**. They deliberately carry no `maxLength`: that
attribute silently truncated a long paste at 1990 with no error and the Stage
button still enabled, so a GM could post two thirds of a declaration and never
find out. Anything that shows a character counter in this app should block
rather than cut, for the same reason.

Two consequences worth knowing:

- **A multi-chunk declaration still survives the Dawn wipe.** The wipe's cutoff
  is the side-effect thunk's start time, and the public-post loop runs earlier
  in that same thunk, so every chunk postdates the cutoff.
- **Resend re-posts the whole body.** `postMessageBatched` and `postDmBatched`
  are sequential and throw on the first chunk that fails, so a failure partway
  leaves the earlier chunks delivered. Resending then duplicates them. This is
  rare by construction — a 429 is already retried, so the realistic failure is a
  channel that is gone or forbidden, which fails on chunk 1 and leaves nothing
  partial. It is not worth per-chunk bookkeeping; just delete the duplicate.

A staged message takes a *set* of recipients — you need to tell different
people different things, so a Move carries as many messages as the truth
requires, and a message needn't belong to any Move at all (the tray's
composers). A mass-apply ("Explosion Burns onto these four") writes one
`StagedEffect` per target under a shared `batchId`, so the tray shows and
deletes it as one line. Editing a batched row detaches it from its batch.

Rows freeze only when the push stamps them (`sentAt` / `appliedAt`). Until
then any GM may edit or delete any staging — concurrent GMs *append*
independent rows and merge harmlessly; edits to the same row are
last-write-wins, which five GMs can live with.

**Move links detach, never cascade.** `moveId` is `SetNull` on both staged
models: rejecting a Move (deleting its Action) leaves the staged work in the
tray as "unattached" for the GM to keep or drop.

## 2. What a Move is now

- **Submit = locked.** The Move modal is one shot ("Lock In Your Move");
  there is no draft window and no player edit. The GM-side escape hatch is
  **Reject**: deletes the Action, frees the turn, DMs the player "Your Move
  was returned to you — you can act again this turn." plus the reason,
  immediately — the one thing the desk sends in real time, because a freed
  turn the player doesn't know about is a wasted day. (The stored
  `source: "move_unlock"` / `actionType: "move_rejected"` values predate the
  rename and are kept — renaming them would orphan old audit rows and DM
  log entries.)
- **Declared numbers always pay.** Every confirmed Move's own
  `resourceDelta` (now only ever machine-written — the Labor roll; players
  can no longer type a delta at all) applies at the push, solved or not. A GM
  who disagrees stages a counter-effect; the composer's "offset declared"
  prefill is that in one click. Nothing pays at confirm any more — Routines
  and Labor included.
- **Solve is bookkeeping.** It stores the Result and Kind edit, stamps
  `reviewedBy`, and marks the staging complete. It applies nothing;
  Unsolve reverts nothing, because there is nothing yet to revert.
- **Silent close.** A Move still `OPEN` at the push closes `PASSED` with
  `auto:silent_close` appended to `gmNotes` and pays its declared numbers.
  It used to send **no DM** at all. A **Routine** that ends the push `PASSED`
  now gets one canned line — "Your Routine automatically passed without any
  special adjudication notes…" — so a player who hears nothing knows why
  rather than wondering if they were forgotten. It is suppressed when a
  private staged message on that Move actually went to *that* player (they
  already have real notes), when a staged effect on the Move targets them
  (their sheet is changing — "no notes" would be a lie), when `gmNotes`
  carries any `auto:` marker (a default move and travel send their own),
  and for Gambits and Solved Moves.
  See `TURN-ENGINE.md` for where in the push it fires.
- **The Result box is canon.** One GM-facing field (`resultMessage`) holding
  what actually happened. `gmNotes` survives as a column for the `auto:*`
  machine markers only and renders nowhere.

## 3. The workspace

A full-viewport workspace: `web/app/(desk)/gm/turns/`, in the `(desk)` route
group with no PageShell and no centred max-width (the sanctioned deviation —
tokens and the shared control classes still apply; the `.desk-*` family in
`globals.css` is its layout). It **does** carry the nav rail, which is how you
leave; `/gm/players` is its sibling in the same group.

The route is `/gm/turns/[[...selection]]`, and the URL carries which row is
open — `/gm/turns/move/<id>`, `/gm/turns/request/<id>`, `/gm/turns/caving/<id>`,
`/gm/turns/history/<id>`.
An optional catch-all, not `[moveId]`: the desk selects one of four things, so
the URL has to carry both halves of `{ type, id }`. Selection changes never
touch the server — `setSelected` is `useState` and the URL is mirrored with
`history.replaceState`, so picking a row leaves the queue, every DTO, the
inspector cache and the tray untouched.

Two consequences worth knowing. The route file has to genuinely exist, because
the desk polls `router.refresh()` against the *current* URL and a GM parked on
a selection would otherwise 404 on the first poll. And a revalidation of this
page must be `revalidatePath(TURNS_PATH, "page")` (`web/lib/routes.js`) — a
dynamic route needs its pattern, not a path that happens to match it. Only
the **cross-page** actions carry that call now (depot, store, dev panel,
player desk…); the desk's own actions dropped theirs, because every desk
call site follows success with `refresh()` and the pair meant rendering
`page.js` twice per mutation (see the header note in `actions.js`).

```
┌ header: turn chip · push times · Preview push ─────────────────────┐
│ QUEUE RAIL      │  ARBITRATION DESK          │  INSPECTOR          │
│ Moves/Requests/ │  the selected Move or      │  Sheet · Tags ·     │
│ Caving/History  │  Request: result box,      │  Moves · Archive ·  │
│ lens, zone-seat │  staged items, composers   │  DMs for the last-  │
│ filters, search │                            │  clicked one + pins │
├ PUSH TRAY: counts · every staged row · missed-push banner ─────────┤
```

- **Queue rail** — the open turn's Moves and the newest Requests, as
  selectable rows. Opens filtered to the GM's zone seat
  (`GAMEMASTERS.md`), soft as ever. A live lock renders as a small `GmAvatar`
  chip beside the row's real status pill — **never as a status of its own**.
  It used to be: a Move under a live lock displayed "In Progress" regardless
  of its actual `moveReviewStatus`, which let a GM's OWN lock on a Move they
  had just Solved make the desk they were sitting in read back
  `solved = false` and offer Save/Solve on a row already SOLVED in the DB —
  the incident this section's model fixes. Search runs the shared
  `scoreMatch` engine (`web/lib/fuzzySearch.js`) over name, role, faction,
  both zones, Discord handle, tag names, Move/Request kind and status, and
  the free text (a Move's description, a Request's reason/summary, GM notes)
  — a bare word matches anything, `field:term` (`role:smith`, `zone:caves`)
  or `@handle` narrows to one field, and a query reorders the list by match
  strength instead of the default sort — Open Moves first, Solved then
  Passed sinking toward the bottom (a locked-but-Solved row sinks too — the
  avatar is just riding along), newest-first within each rank. The
  Kind/Status/Type/Reviewed dropdowns always list every value the enum has,
  even at `(0)`, so "Open" never looks like it vanished just because nothing
  is open right now — Zone stays derived from what's actually loaded. The
  whole view survives a reload, split across three `sessionStorage` keys by
  write frequency (`web/app/components/useSessionState.js`): `gm-turns-rail`
  (filters per lens, the two travel toggles, the active lens — subscribed,
  click-frequency), `gm-turns-desk` (tray open/expanded, the inspected
  character, the History turn — Workspace.js's half), and `gm-turns-view`
  (search text and queue scroll position per lens — unsubscribed
  `readSession`/`writeSession`, debounced with a `pagehide` flush, restored
  by a post-hydration one-shot in `QueueRail.js`).
  Auto-filed **Travel** Moves (`db/lib/travel.js#performTravel`, no
  Routine/Gambit to review) render as "Travel" and stay hidden by default
  behind a "Show N travel" toggle beside the Kind dropdown; picking Travel
  from that dropdown always overrides the hide.
- **History lens** — the same rail over a turn that has already been pushed,
  one **resolved** turn at a time, picked from a Turn dropdown above the
  filters (newest first). A GM used to have to go to `/gm/audit` to see what
  somebody did last turn. Nothing is loaded with the page: the lens fetches
  its turn on demand (`actions.js#getMoveHistory`) and caches it for the page
  view, so the open turn's desk never pays for history nobody opened and the
  45s refresh never re-sends it. Rows go through the same mappers the live
  queue does (`web/lib/moveRows.js`) and open a **`MoveHistoryDesk`**: the
  Move's kind, dice, what was declared, what actually **paid**
  (`appliedEffects`), the Result, and everything that was sent on it. No lock,
  no composers, no Solve, no Reject — but a staged row the push never carried
  keeps its Edit/Delete, and a failed delivery keeps its Resend, because those
  are the two things about a past turn that can still need doing.
- **Desk** — the selected item. For a Move: situation, dice, declared
  numbers, the Result box, everything staged on it, and the three composers.
  Every button derives from `moveReviewStatus`, never from a display label or
  a lock: **Save · Solve · Reject** on an open Move, **Save · Reopen ·
  Reject** once it's Solved — Save stays live on a Solved Move (it edits
  freely; the status guard that used to block it protected nothing, since
  Solve is bookkeeping and nothing pays until the push), so fixing a Result
  after Solving no longer needs the Reopen → edit → re-Solve dance. For a
  Request: the old panel's sections, semantics untouched (§5). The
  90s cooperative lock, its 30s heartbeat and the `sendBeacon` release all
  carry over unchanged (`useMoveLock.js`,
  `web/app/api/move-lock/release/route.js`). Every card's meta line under the
  name leads with `roleTitle` (Move/Request/Caving desks alike), so who's
  acting reads at a glance before you open anything.
- **Inspector** — *"quickly pull up the guy he was talking to"*. Every
  character name in the workspace is a click target that swaps the column to
  that character: Sheet (live facts + gambit modifier), Tags, **Moves**, their
  archive slice, their DM thread. **Moves** is that person's own history —
  their newest 40 Moves on **past** turns, each row linking to
  `/gm/turns/history/<id>`. Both Move desks carry a **Past moves** button that
  opens it (`onInspect(characterId, name, "Moves")`), and so does the player
  desk's Canon tab, which owns *this* turn and points at the tab for
  everything before it. The header carries name, `@username`, and role on
  the line below, all from the roster DTO already on the client — no fetch
  needed just to see who someone is. A search box above the pin row
  (`InspectorSearch`, fuzzy-matched via `web/lib/fuzzySearch.js#scoreMatch`
  over name/role/faction/username/zone) opens anyone the same way, not just
  names already on screen. Pin the ones an arbitration keeps returning to.
  Fetched on demand via server actions, cached for the page view. Three quick
  edits live here too: the DMs tab carries a composer that sends immediately
  (»-prefixed, logged, not staged — `sendInspectorDm`); clicking an archived
  line opens `ArchiveContextModal` (`web/app/components/`), the ~30 messages before/after it in the
  same Discord channel/thread with a jump link when the message still exists
  (`getArchiveContext`); and the Sheet/Tags tabs stage deltas in place — ✕ a
  held tag to stage its removal, click Resources or Tag points to stage a
  ± delta. All three route through the same `createStagedEffects` the tray
  uses, so they land at the push like any other staged effect. `EffectComposer`'s
  own tag browser carries a "+ Custom tag" door too (`CustomTagDialog.js`,
  `DEV-PANEL.md` §8a) for inventing a one-off tag against the composer's
  current targets without leaving the modal.
- **Tray** — the push, honestly: counts (including how many open Moves will
  silently close), every staged row with edit/delete, batches as one line,
  unattached and detached rows, and the composers for staging outside any
  Move. **Preview push** groups it all by recipient — the DMs they'll get,
  net staged deltas, their declared payout — plus the public posts.
- **Missed-push banner** — staged rows a resolved turn's push never carried
  (a crash, a validation skip, the turn-boundary race) stay visible here
  with one verb: carry them onto the current turn for the next push.

**Responsiveness.** Five GMs share this page for a day at a time, so it
keeps itself current and stays reachable from the keyboard:

- The queue **refreshes itself** every 45s (`router.refresh()`), paused while
  a modal is open, while any panel holds unsaved edits
  (`useDirtyGuard.js#isAnyDirty`), or while the tab is hidden — a GM
  mid-sentence never gets the page yanked out from under them. The header
  carries an "updated HH:MM" stamp, a **countdown** to the next noon/midnight
  CT push, and an `N/M solved` progress chip.
- The poll is **version-aware** (`useDeskVersion.js` + `/api/desk-version` +
  `web/lib/deployVersion.js`): it only calls `router.refresh()` after the
  server answers with the same build the page rendered from. Refreshing
  across a deploy trips Next's build-mismatch fallback — a full browser
  navigation that destroys all view state — and this repo deploys many times
  a day, which is exactly how the desk used to "refresh for no reason". Now
  a deploy latches a quiet **"Updated — reload when ready"** chip in the
  header (auto-refresh stands down until the GM clicks it), a switchover 5xx
  or dropped connection is a silently skipped tick, and once the flag has
  latched, a mutation that fails from the stale build says to reload
  (`mutationErrorMessage`) instead of "something went wrong". The one window
  left uncovered is a mutation inside the ≤45s between the deploy landing
  and the next poll noticing it — that can still fail generic, or succeed
  and have its `refresh()` trip the reload; the persisted view state is what
  makes that survivable.
- **Keyboard**: `↑↓` / `j k` walk the rail, `⏎` opens the focused row,
  `m`/`r`/`c`/`h` flip the lens, Escape peels the layers below. All of it stands down while a
  field has focus or a modal is open.
- **GM identity** shows as a small avatar (`GmAvatar.js`, roster from
  `web/lib/gmProfiles.js`) wherever a GM is named: the lock holder on an
  In Progress row, a staged row's author, a Move's solver, and the actor
  column on `/gm/audit`. The player desk's conversations get none —
  `DirectMessage` records the player, not which GM typed the reply — though
  its GM notes do (`GmCharacterNote.authorDiscordUserId`).
- The **push preview is a way in**, not just a readout: a character name
  swaps the inspector to them, and a staged line closes the preview, opens
  and expands the tray, and scrolls to that row with a brief flash.
- **Pins survive a reload** and are **shared with the player desk**
  (`web/app/components/usePins.js`, `localStorage` read through
  `useSyncExternalStore`). Pin someone while adjudicating and they are pinned
  when you go talk to them. They self-heal on load, though: this desk passes
  `usePins({ knownIdentities })` with the live roster's character ids, so a
  pin for a character a wipe or a death removed quietly drops off the list
  instead of pointing at nothing. A message whose push left `deliveryFailures` grows
  a **Resend** button that retries only the recipients that failed
  (`resendStagedMessage`). The Result box has a **Stage as message** button
  that opens the message composer prefilled with the result text and the
  Move's own character.

Escape is layered, topmost-first: an open `Modal` handles its own Escape and
the workspace yields to it; otherwise a focused field just blurs, and a
selected Move/Request deselects through its own dirty guard (`Workspace.js`).
With nothing selected **Escape does nothing**. It used to navigate to
`/gm/players`, which made the desk read as a mode you were trapped in rather
than a page — one stray keystroke and the whole workspace was gone. The rail
is how you leave. The tray also
grew a search box, an All/Effects/Messages/Public filter, and an Expand
toggle for combing through a big push (`StagingTray.js`).

## 4. The push, from this page's side

The mechanics live in `db/lib/stagedPush.js` (ordering and crash-resume
guarantees: `TURN-ENGINE.md` §2–3). What a GM needs to know:

- Effects apply one transaction per row — one bad row can't roll back the
  batch. A row that no longer validates (the tag left the catalog, the
  staged zone was reworked away) is stamped errored with the reason on
  `appliedEffect`, shown in the tray.
- A staged relocation writes `Character.zoneId` in that same transaction;
  the Discord half (zone role, narrowcast, thread invites) runs afterwards
  in the side-effect thunk via `db/lib/zoneMove.js`, with the channel
  doctor as the safety net (`CHANNELS.md` §3).
- Messages are stamped `sentAt` after their sends are attempted, per-recipient
  failures recorded on the row and in one `staged_push_delivery_failed`
  audit row. A crash mid-delivery leaves the rest visibly unsent, not
  falsely delivered.
- A staged row created in the seconds around the cron retargets itself to
  the new open turn; anything that slips through lands in the missed-push
  banner. Honest beats locked.

## 5. Requests

Relocated onto the desk, and rebuilt as a quiet feed. Requests are
**apply-first**: the effect landed when the player filed it, and the GM's
verdict — Mark reviewed, Save edits, or Undo — executes immediately, not at
the push (`REQUESTS.md`). The per-type sections live in `RequestSections.js`;
the Feed-Person kill keeps its confirm-gated immediate path.

Most requests need nothing more than a glance, so the desk stopped treating
every one as a problem to solve:

- The primary button reads **Mark reviewed** until the GM actually edits a
  field, at which point it becomes **Save edits** (`RequestDesk.js` tracks
  this as `touched`). Confirming with no edit stamps `reviewedAt` and leaves
  the status alone — it does not force `EDITED`.
- The rail no longer flags a never-reviewed row with a loud "Unreviewed"
  warn pill. It shows the row's real status (`Passed`/`Edited`/`Undone`) and
  a small quiet dot before the name for anything not yet reviewed
  (`QueueRail.js`'s `.desk-dot`). `Edited` reads neutral now too — a GM
  tweak is routine bookkeeping, not a warning.
- The tray/rail lens label is just "Requests" — the count badge that used to
  read like a to-do queue is gone.

`RequestStatus` tones, `payload` vs `effect`, and Undo-reads-only-`effect`
are otherwise as documented in `REQUESTS.md`, including the `changed`
field `applyEdit` now returns and how it drives `EDITED` vs. a plain
`request_reviewed` audit row.

## 6. Where the code lives

| File | Role |
|---|---|
| `web/app/(desk)/layout.js` | The full-viewport route group's GM gate |
| `web/app/(desk)/gm/turns/page.js` | RSC: queue, staged rows, catalog, roster — all DTOs |
| `.../Workspace.js` | Client shell: selection, inspector context + cache, layout |
| `.../QueueRail.js` | Lens, filters (zone-seat seeded), the queue |
| `web/lib/moveRows.js` | The Move / staged-effect / staged-message DTO mappers, shared by `page.js` and the History fetchers so they can't drift |
| `.../MoveDesk.js` / `RequestDesk.js` | The desks |
| `.../MoveHistoryDesk.js` | The read-only desk for a Move on a pushed turn |
| `.../EffectComposer.js` / `MessageComposer.js` / `PublicComposer.js` | The staging composers (create + edit) |
| `.../StagedItems.js` / `StagingTray.js` / `PushPreview.js` | Staged-row lists, the tray, the per-recipient preview |
| `web/app/components/InspectorColumn.js` | Sheet / Tags / Moves / Archive / DMs + pins — **shared with `/gm/players`**, which appends Canon / Notes through `extraTabs` (PLAYER-DESK.md §6) |
| `web/app/components/ArchiveContextModal.js` | The "in context" slice behind an Archive row, moved alongside it |
| `web/app/components/GmAvatar.js` | The small GM pfp, fed by `web/lib/gmProfiles.js` |
| `web/app/components/useSessionState.js` | The generic `sessionStorage` hook behind rail-state persistence — one key (`gm-turns-rail`) shared by `QueueRail.js`'s filters/toggles and `Workspace.js`'s `lens`, plus the unsubscribed `readSession`/`writeSession` pair behind `gm-turns-view` |
| `web/app/components/useDeskVersion.js` / `web/lib/deployVersion.js` / `web/app/api/desk-version/route.js` | The deploy-awareness triad: the 45s poll refreshes only on a same-build answer, a deploy shows the reload chip instead of letting Next's build-mismatch fallback hard-reload the desk |
| `.../useMoveLock.js` | The lock's client half |
| `.../actions.js` | Every server action: staging CRUD, solve/save/unsolve, unlock, locks, request review, inspector fetchers, the two history fetchers (`getMoveHistory`, `getCharacterMoveHistory`), retarget |
| `db/lib/stagedPush.js` | The push pass |
| `db/lib/tagOps.js` | The tag-op engine (shared with the Dev Panel) |
| `web/lib/tagOpAlgebra.js` | `mergeTagOp`, the client-side staging algebra |
