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
  **Unlock** (the old Reject): deletes the Action, frees the turn, DMs the
  reason immediately — the one thing the desk sends in real time, because a
  freed turn the player doesn't know about is a wasted day.
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
  `auto:silent_close` appended to `gmNotes`, pays its declared numbers, and
  sends **no DM**. That is the design: an unremarkable Move resolves
  unremarkably.
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
open — `/gm/turns/move/<id>`, `/gm/turns/request/<id>`, `/gm/turns/caving/<id>`.
An optional catch-all, not `[moveId]`: the desk selects one of three things, so
the URL has to carry both halves of `{ type, id }`. Selection changes never
touch the server — `setSelected` is `useState` and the URL is mirrored with
`history.replaceState`, so picking a row leaves the queue, every DTO, the
inspector cache and the tray untouched.

Two consequences worth knowing. The route file has to genuinely exist, because
the desk polls `router.refresh()` against the *current* URL and a GM parked on
a selection would otherwise 404 on the first poll. And every
`revalidatePath("/gm/turns")` became `revalidatePath(TURNS_PATH, "page")`
(`web/lib/routes.js`) — a dynamic route needs its pattern, not a path that
happens to match it.

```
┌ header: turn chip · push times · Preview push ─────────────────────┐
│ QUEUE RAIL      │  ARBITRATION DESK          │  INSPECTOR          │
│ Moves/Requests  │  the selected Move or      │  Sheet · Tags ·     │
│ lens, zone-seat │  Request: result box,      │  Archive · DMs for  │
│ filters, search │  staged items, composers   │  the last-clicked   │
│                 │                            │  character + pins   │
├ PUSH TRAY: counts · every staged row · missed-push banner ─────────┤
```

- **Queue rail** — the open turn's Moves (a resolved turn's are already
  pushed; there is nothing left to do to them) and the newest Requests, as
  selectable rows. Opens filtered to the GM's zone seat
  (`GAMEMASTERS.md`), soft as ever. "In Progress" is still derived from a
  live lock. Search runs the shared `scoreMatch` engine
  (`web/lib/fuzzySearch.js`) over name, role, faction, both zones, Discord
  handle, tag names, Move/Request kind and status, and the free text (a
  Move's description, a Request's reason/summary, GM notes) — a bare word
  matches anything, `field:term` (`role:smith`, `zone:caves`) or `@handle`
  narrows to one field, and a query reorders the list by match strength
  instead of the default sort — Open/In Progress Moves first, Solved then
  Passed sinking toward the bottom, newest-first within each rank. The Kind/Status/Type/Reviewed
  dropdowns always list every value the enum has, even at `(0)`, so "Open"
  never looks like it vanished just because nothing is open right now — Zone
  stays derived from what's actually loaded. Auto-filed **Travel** Moves
  (`db/lib/travel.js#performTravel`, no Routine/Gambit to review) render as
  "Travel" and stay hidden by default behind a "Show N travel" toggle beside
  the Kind dropdown; picking Travel from that dropdown always overrides the
  hide.
- **Desk** — the selected item. For a Move: situation, dice, declared
  numbers, the Result box, everything staged on it, and the three composers.
  For a Request: the old panel's sections, semantics untouched (§5). The
  90s cooperative lock, its 30s heartbeat and the `sendBeacon` release all
  carry over unchanged (`useMoveLock.js`,
  `web/app/api/move-lock/release/route.js`). Every card's meta line under the
  name leads with `roleTitle` (Move/Request/Caving desks alike), so who's
  acting reads at a glance before you open anything.
- **Inspector** — *"quickly pull up the guy he was talking to"*. Every
  character name in the workspace is a click target that swaps the column to
  that character: Sheet (live facts + gambit modifier), Tags, their archive
  slice, their DM thread. The header carries name, `@username`, and role on
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
- **Keyboard**: `↑↓` / `j k` walk the rail, `⏎` opens the focused row, `m`/`r`
  flip the lens, Escape peels the layers below. All of it stands down while a
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
| `.../MoveDesk.js` / `RequestDesk.js` | The desks |
| `.../EffectComposer.js` / `MessageComposer.js` / `PublicComposer.js` | The staging composers (create + edit) |
| `.../StagedItems.js` / `StagingTray.js` / `PushPreview.js` | Staged-row lists, the tray, the per-recipient preview |
| `web/app/components/InspectorColumn.js` | Sheet / Tags / Archive / DMs + pins — **shared with `/gm/players`**, which appends Canon / Notes through `extraTabs` (PLAYER-DESK.md §6) |
| `web/app/components/ArchiveContextModal.js` | The "in context" slice behind an Archive row, moved alongside it |
| `web/app/components/GmAvatar.js` | The small GM pfp, fed by `web/lib/gmProfiles.js` |
| `.../useMoveLock.js` | The lock's client half |
| `.../actions.js` | Every server action: staging CRUD, solve/save/unsolve, unlock, locks, request review, inspector fetchers, retarget |
| `db/lib/stagedPush.js` | The push pass |
| `db/lib/tagOps.js` | The tag-op engine (shared with the Dev Panel) |
| `web/lib/tagOpAlgebra.js` | `mergeTagOp`, the client-side staging algebra |
