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
| **Public declarations** | `StagedMessage` (kind `PUBLIC`, optional `zoneId`) | Posted to `GameConfig.turnSummaryChannelId`. The `zoneId` is carried now so the future per-zone summary channels can deliver by it; today one channel serves the whole game, and an unset id means the post is skipped and recorded on `deliveryFailures` — never lost. |
| **Mechanical adjustments** | `StagedEffect` — `payload` `{ resources?, tagOps? }` per target character | Resources through `addResources`' clamp, tag ops through `db/lib/tagOps.js` — the same engine the Dev Panel applies with. `appliedEffect` snapshots what actually moved (the payload-vs-effect rule from `REQUESTS.md` §2). |

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
  `resourceDelta` (clamped ±20 at parse time, `db/lib/resourceDelta.js` —
  the human gate the old Solve used to be) applies at the push, solved or
  not. A GM who disagrees stages a counter-effect; the composer's "offset
  declared" prefill is that in one click. Nothing pays at confirm any more —
  Routines and `/hunt`-family labor included.
- **Solve is bookkeeping.** It stores the Result and Kind/Opposed edits,
  stamps `reviewedBy`, and marks the staging complete. It applies nothing;
  Unsolve reverts nothing, because there is nothing yet to revert.
- **Silent close.** A Move still `OPEN` at the push closes `PASSED` with
  `auto:silent_close` appended to `gmNotes`, pays its declared numbers, and
  sends **no DM**. That is the design: an unremarkable Move resolves
  unremarkably.
- **The Result box is canon.** One GM-facing field (`resultMessage`) holding
  what actually happened. `gmNotes` survives as a column for the `auto:*`
  machine markers only and renders nowhere.

## 3. The workspace

The one full-viewport surface in the app: `web/app/(desk)/gm/turns/`, its own
route group with no NavRail and no PageShell (the sanctioned deviation —
tokens and the shared control classes still apply; the `.desk-*` family in
`globals.css` is its layout). Same URL, `/gm/turns`.

```
┌ header: turn chip · push times · Preview push · Exit ──────────────┐
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
  live lock.
- **Desk** — the selected item. For a Move: situation, dice, declared
  numbers, the Result box, everything staged on it, and the three composers.
  For a Request: the old panel's sections, semantics untouched (§5). The
  90s cooperative lock, its 30s heartbeat and the `sendBeacon` release all
  carry over unchanged (`useMoveLock.js`,
  `web/app/api/move-lock/release/route.js`).
- **Inspector** — *"quickly pull up the guy he was talking to"*. Every
  character name in the workspace is a click target that swaps the column to
  that character: Sheet (live facts + gambit modifier), Tags, their archive
  slice, their DM thread. Pin the ones an arbitration keeps returning to.
  Fetched on demand via server actions, cached for the page view.
- **Tray** — the push, honestly: counts (including how many open Moves will
  silently close), every staged row with edit/delete, batches as one line,
  unattached and detached rows, and the composers for staging outside any
  Move. **Preview push** groups it all by recipient — the DMs they'll get,
  net staged deltas, their declared payout — plus the public posts.
- **Missed-push banner** — staged rows a resolved turn's push never carried
  (a crash, a validation skip, the turn-boundary race) stay visible here
  with one verb: carry them onto the current turn for the next push.

## 4. The push, from this page's side

The mechanics live in `db/lib/stagedPush.js` (ordering and crash-resume
guarantees: `TURN-ENGINE.md` §2–3). What a GM needs to know:

- Effects apply one transaction per row — one bad row can't roll back the
  batch. A row that no longer validates (the tag left the catalog) is
  stamped errored with the reason on `appliedEffect`, shown in the tray.
- Messages are stamped `sentAt` after their sends are attempted, per-recipient
  failures recorded on the row and in one `staged_push_delivery_failed`
  audit row. A crash mid-delivery leaves the rest visibly unsent, not
  falsely delivered.
- A staged row created in the seconds around the cron retargets itself to
  the new open turn; anything that slips through lands in the missed-push
  banner. Honest beats locked.

## 5. Requests

Unchanged in substance, relocated onto the desk. Requests are **apply-first**:
the effect landed when the player filed it, and the GM's verdict — Confirm
with edits, or Undo — executes immediately, not at the push
(`REQUESTS.md`). The per-type sections live in `RequestSections.js`; the
Feed-Person kill keeps its confirm-gated immediate path. `RequestStatus`
tones, `payload` vs `effect`, and Undo-reads-only-`effect` are all as
documented in `REQUESTS.md`.

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
| `.../InspectorColumn.js` | Sheet / Tags / Archive / DMs + pins |
| `.../useMoveLock.js` | The lock's client half |
| `.../actions.js` | Every server action: staging CRUD, solve/save/unsolve, unlock, locks, request review, inspector fetchers, retarget |
| `db/lib/stagedPush.js` | The push pass |
| `db/lib/tagOps.js` | The tag-op engine (shared with the Dev Panel) |
| `web/lib/tagOpAlgebra.js` | `mergeTagOp`, the client-side staging algebra |
