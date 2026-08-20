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
| Waiting for Opponents / In Progress | `var(--warning)` |
| Solved | `var(--positive)` |

**Requests tab** — the same shell with Type and Reason in place of Move.
`Passed` is plain body text; **both** GM verdicts, `Edited` and `Undone`, are
`var(--accent)`, because either one means the request did not stand as the
player made it.

Each row carries two icon buttons (`.icon-btn`, framed by default and filled
on hover): the balance scale ⚖ / edit ✎ that opens the panel, and ✉ which
expands one extra `<tr>` holding a message composer. The composer reuses
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

## 5. Not built yet

**The Move Adjudication Panel is Phase 2.** The scale button on the Moves tab
is rendered but wired to nothing, deliberately — hiding it would shift the
column layout a GM learns now.

When it lands it needs:

- The same `useDirtyGuard` shell as `RequestPanel.js`.
- A universal top half (character, turn, zone, description, raw roll +
  modifier + total), then a bottom half switching on Routine / Gambit /
  Location Change.
- An answer to an open question: **location changes are not currently their
  own Move type.** `bot/src/lib/location.js#performMove` writes an ordinary
  `Action` tagged `gmNotes: "auto:zone_change"` with `moveReviewStatus:
  "SOLVED"`, so cross-zone travel never reaches the queue at all. Follow
  whatever is current at implementation time rather than inventing a type.
- Two invariants from the deleted `updateMove`, both worth restoring:
  switching Kind rerolls or nulls the d6 (a Gambit always has a fresh roll, a
  Routine never has one), and `resourceDelta` applies to `Character.resources`
  **only on the transition into `SOLVED`**, so re-saving a solved Move cannot
  double-apply it.

## 6. Where the code lives

| Concern | File |
|---|---|
| Page shell, row DTOs, status/kind labels | `web/app/(app)/gm/turns/page.js` |
| Tab state | `web/app/(app)/gm/turns/AdjudicateTabs.js` |
| Filter / sort / search machinery | `web/app/(app)/gm/turns/tableUtils.js` |
| The two tables | `MovesTable.js`, `RequestsTable.js` |
| Per-row message composer | `MessageRow.js` |
| Request panel | `RequestPanel.js` |
| GM verdict server action | `web/app/(app)/gm/turns/actions.js` |
| Unsaved-edit guard | `web/app/components/useDirtyGuard.js` |
| Table / icon-button styling, `--warning` token | `web/app/globals.css` |
