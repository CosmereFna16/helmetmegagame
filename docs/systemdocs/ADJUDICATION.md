# Adjudication: the GM review surface

What `/gm/turns` is, how its two tables work, and how a GM reverses a player's
Request. Companion to `REQUESTS.md` (the player-facing half, and the
`payload`/`effect` contract this page depends on).

## 1. The shape of it

One page, two tabs, one job: everything waiting on a GM's attention.

- **Moves** — the Actions players submitted in `#turns`, with their Kind
  (Routine/Gambit), Opposed flag, dice, and review status.
- **Requests** — changes players already made to themselves, for
  after-the-fact review.

The two are genuinely different workflows, which is why they are tabs and not
one merged list: a Move is *waiting to be resolved*, a Request has *already
happened*. `AdjudicateTabs.js` holds the tab state and uses the existing
`.tab-bar` / `.tab-item` classes; `?tab=requests` selects the second tab on
first load.

The old adjudication UI was deleted before this rebuild; only the "move sent"
pipeline survived, and the Moves tab is where it resurfaces.

## 2. The tables

Both are long, static tables with **both scroll axes inside the container** and
a header pinned to the top — the GM scans rather than pages. That is one CSS
class, `.table-scroll` (`web/app/globals.css`), reused by `/gm/audit`. The
page body itself never scrolls sideways, which is why the overflow lives on
the container rather than an ancestor.

Filtering, sorting and search are client-side over the full set, the same
posture as `PlayersTable.js` — the rows are already in memory, so filtering is
a plain pass rather than a round trip. The shared machinery is
`tableUtils.js#useTableState`, plus `SortHeader` and `FilterBar`. Sorting is
new; no table in the app had it before, and `.th-sort` is the header-button
style it introduced.

**Moves tab** — Turn, Character, Discord username, Faction, Move, Status, GM
Notes. The Move cell wraps and is truncated to 100 characters, with Kind,
Opposed and the dice result on a second muted line. Status colours:

| Status | Colour |
|---|---|
| Open | `var(--text)` — the default state of every Move, deliberately not shouted |
| Passed | `var(--text)` — a self-resolved Routine, just as quiet |
| Waiting for Opponents / In Progress | `var(--warning)` |
| Solved | `var(--positive)` |

**Requests tab** — the same shell with Type and Reason in place of Move.
`Passed` is plain body text; **both** GM verdicts, `Edited` and `Undone`, are
`var(--accent)`, because either one means the request did not stand as the
player made it.

Each row carries three icon buttons (`IconButton` over `.icon-btn`, framed by
default and filled on hover, wrapping the SVGs in `components/icons.js`): the
balance scale / edit pencil that opens the panel, the envelope that expands one
extra `<tr>` holding a message composer, and the **eye**, which opens the same
panel `readOnly` — inert controls, no footer actions, and no lock claimed.
Every character name is a `CharacterLink` into the GM's character editor, and a
**Resources** column shows the ⬢ the row moved (green gain, accent loss, em-dash
when it moved none). The composer reuses
`sendGmMessage` from `web/app/(app)/gm/actions.js` rather than opening a modal
over a table the GM is mid-scan.

## 3. The Request panel

`RequestPanel.js`. A universal top half — character, Discord name, faction,
turn, type, status, the player's reason, and the fixed line *"To reduce GM
load, players can make big changes."* — then a type-specific bottom half under
a heading naming the type.

The bottom half is a `SECTIONS` map keyed on `RequestType`. Together with
`REQUEST_EFFECTS` in `web/lib/requestEffects.js`, that is the entire cost of
adding a new request type to this page.

Three footer buttons, each with a hover tooltip:

| Button | Status becomes | What happens |
|---|---|---|
| **Confirm** | `EDITED` | Applies the GM's edits |
| **Undo** | `UNDONE` | Inverts `request.effect` |
| **Cancel** | unchanged (`PASSED`) | Discards every edit |

`actions.js#resolveRequest` re-checks GM membership through `getGmSession()`,
does everything in one `$transaction`, stamps `reviewedAt` /
`reviewedByDiscordUserId`, and writes an `AuditLog` row. **It is idempotent on
status**: undoing an already-`UNDONE` request is a no-op rather than a
reversal of the reversal, which would silently re-apply the effect.

Resource-cost edits apply the **delta**, not the new total — raising a cost
from 4 to 7 charges 3. Anything that isn't a non-negative integer falls back
to the existing value rather than being coerced, since a negative cost would
mint resources.

## 4. Closing the panel

Leaving the panel by **any** route other than an explicit save reverts every
edit, and has to be confirmed first. `useDirtyGuard.js` covers this in two
layers:

- `guardedClose()` handles in-app exits — overlay click, Cancel, Escape — by
  routing through `useConfirm()` when the panel is dirty.
- A `beforeunload` listener, attached only while dirty, covers the
  browser-level exits: reload, tab close, back. The wording of that dialog
  belongs to the browser; only whether it appears is ours.

The panel is marked dirty by any edit to a field or the GM notes, and marked
clean on a successful save.

## 5. The Move panel

`MovePanel.js`. Same shell as the Request panel — `useDirtyGuard`,
`useConfirm()`, `{ ok, error }` results — with three sections: **Character**
(name, Zone / Location, faction, resources, tags), **Situation** (turn,
description, Kind and Opposed switches, the dice line), and **Result**
(a signed resources box capped at ±20, and the GM-only Result text).

Kind is a live switch, restoring the invariant the deleted `updateMove` had:
**Gambit → Routine** nulls `diceRoll` and `diceModifier`, **Routine → Gambit**
rolls a fresh d6 and recomputes the modifier from the character's *current*
tags via `gambitModifier.js`. A Mood that lapsed between submission and
adjudication shouldn't haunt a roll made today.

Footer: **Cancel** · **Reject** · **Save** (back to Open) · **Solve**. Reject
deletes the row — the turn-economy checks in `actionSubmission.js` and
`location.js#performMove` look for *any* Action on the open turn, so only a
deletion actually frees the player. The description and reason are copied into
an `AuditLog` row first, any resources a Routine already pushed are clawed
back, and the player is DM'd, since a freed turn they don't know about is a
wasted day.

### Passed, and when resources land

`MoveReviewStatus` gained `PASSED`, rendered as plainly as `Open`. It is where
every **Routine** lands the moment the player confirms: a Routine's resources
are pushed there and then (`handleMoveConfirm`, and `performLabor` for the
`/labor` path), so it only needs a GM if one disagrees. A **Gambit** pushes
nothing until a GM Solves it — the point of rolling is that the outcome isn't
the player's to declare.

`db/lib/moveEffects.js` owns both directions. `applyMoveEffects` pushes and
returns a snapshot; `revertMoveEffects` reads **only** that snapshot, never
recomputing from the row a GM may have just edited. The snapshot lives on
`Action.appliedEffects` as JSON rather than an Int column, so a second pushable
thing (a tag, a location, a Status) costs one entry in `MOVE_EFFECTS` and
nothing else — and an old row written before that key existed still reverts,
because revert skips keys it doesn't recognise. This is `Request`'s
`payload`-vs-`effect` rule (`REQUESTS.md` §2) applied to Moves.

Re-opening a Solved Move goes through `useConfirm()`, whose message names what
is about to be handed back before the GM commits to it.

### The lock

Two GMs must not adjudicate the same Move, but a lock stored *as* a status
strands the row the moment a browser dies. So it is its own pair of columns —
`lockedByDiscordUserId` / `lockExpiresAt` — with a 90s TTL the open panel
refreshes every 30s, and **"In Progress" is derived** from a live lock rather
than written. Nothing can get stuck; the worst case is a GM waiting out the
TTL.

Released explicitly on Cancel / Save / Solve / Reject, on unmount, and
best-effort via `navigator.sendBeacon` to `/api/move-lock/release` when the tab
closes. The heartbeat only extends a lock this GM still holds, so a lock taken
over after expiry is not silently stolen back. The eye (read-only) **never**
claims a lock — looking must not block the GM who intends to resolve.

## 6. Where the code lives

| Concern | File |
|---|---|
| Page shell, row DTOs, status/kind labels | `web/app/(app)/gm/turns/page.js` |
| Tab state | `web/app/(app)/gm/turns/AdjudicateTabs.js` |
| Filter / sort / search machinery | `web/app/(app)/gm/turns/tableUtils.js` |
| The two tables | `MovesTable.js`, `RequestsTable.js` |
| Per-row message composer | `MessageRow.js` |
| Request panel | `RequestPanel.js` |
| Move panel | `MovePanel.js` |
| Move push/revert, the d6 | `db/lib/moveEffects.js` |
| Lock release beacon | `web/app/api/move-lock/release/route.js` |
| Framed icon button, Dev jump | `web/app/components/IconButton.js`, `DevCharacterButton.js` |
| GM verdict server action | `web/app/(app)/gm/turns/actions.js` |
| Unsaved-edit guard | `web/app/components/useDirtyGuard.js` |
| Table / icon-button styling, `--warning` token | `web/app/globals.css` |
