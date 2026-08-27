# The Dev Character Panel

`/gm/dev/characters/[characterId]` — every value on one player, in one place,
plus the verbs a GM reaches for often enough to want a button. Companion to
`CHARACTERS.md` (the rules this deliberately bypasses) and `ADJUDICATION.md`
(the Move surface this hands off to).

Not to be confused with `/gm/dev`, the **game**-level Dev Panel: turn, game
config, Restart Game. That one is superadmin-gated. This one is not.

## 1. Who can open it

Gated on **GM membership** via `getGmSession()`, not `isSuperadmin`. Every
`CharacterLink` in the app points here, and an in-game GM is meant to use it.
Exactly one thing narrows further: **Delete character** requires superadmin,
checked inside the action rather than by hiding the button.

## 2. The two kinds of interaction

The panel does two different things, and keeping them apart is the whole
design:

| | Staged | Immediate |
|---|---|---|
| What | Values — every editable column, and every tag change | Verbs — kill, revive, restore/spend turn, message, resync, delete |
| When | On **Apply** | The moment it's confirmed |
| Undo | **Cancel** discards the lot | Its own inverse, if it has one |
| Audit | One row for the whole Apply | One row each |

They are held to **disjoint fields**, so they can never race each other. The
field that would have straddled both is `status`: it is deliberately absent
from the form and lives only as the Kill and Revive buttons. That is why
`applyCharacterEdits` never has to reason about "did they also just kill this
character" — it reads status from the database, never from the payload.

Four staging buttons sit in the action bar despite being edits rather than
verbs — **Heal all**, **Feed**, **Refund points**, and the **Inflict wound**
picker. They make no server call: they push ops into the same pending diff the
Tags tab uses. Because they sit in a row of verbs that DO fire, they are
captioned `stages`, and staging one prints an inline
"Staged X — press Apply" line: an unlabelled icon that silently stages reads
as a dead button, which is exactly how it was first reported.
Heal-all and Inflict both read `isHealable` from
`web/lib/healRequests.js` (a **Health** tag carrying a cure cost) rather than
re-deriving the predicate, so the picker and the server can't disagree about
what an affliction is. So they show in the pending count, go through the one tag write
path, and Cancel undoes them like anything else.

## 3. Layout

- **State strip** — the derived facts a GM wants before touching anything,
  grouped into four labeled clusters (Identity, Economy, Turn, Discord)
  rather than one undifferentiated grid. Economy is where the ones that exist
  nowhere as a column live: points spent, equipment slots used, the gambit
  modifier. Discord carries the live guild state (username, nickname,
  Cursed, whether the personal role exists).
- **Action bar** — `IconButton`s over `.icon-btn`, in three clusters
  separated by `.dev-bar-sep`: life & turn · staging · repair. A destructive
  verb never sits flush against a harmless one.
- **Tabs** — Identity · Tags · Turn · Goals · Record, on the existing
  `.tab-bar` / `.tab-item` classes. Identity's place field is a **Zone**
  select, listing presence zones only (the Caves group is a container, not a
  place); Apply swaps the zone's Discord role, and the empty option is a real
  choice meaning "nowhere, and no zone channel access". The state strip's
  Identity cluster shows `Zone` for the same reason — there is no Location to
  show.
- **Apply bar** — `.dev-apply-bar`, sticky at the bottom, and rendered **only
  when something is pending**, so the panel reads as a viewer until it isn't
  one. Sticky rather than fixed so it stays in the page column and can't cover
  the nav rail on a narrow screen.

## 4. `applyCharacterEdits`

One payload, one transaction, one audit row. In order:

1. **Validate everything before opening the transaction**, so a rejected
   payload leaves nothing half-written. Names through `NAME_LIMITS` /
   `normalizeHonorific`, age through `AGE_MIN`/`AGE_MAX`, every foreign key
   checked to exist. A GM form is a public endpoint too.
2. **Allowlist.** `EDITABLE_FIELDS` in `web/lib/characterWrite.js` is the
   whole surface; anything else posted is ignored outright, which is what
   stops a hand-rolled request reassigning `discordUserId`.
3. **The dynasty lock**, keyed on the role *being saved* — so moving someone
   into a family seat renames them in the same write.
4. **`Character.name` recomposed** with `formatCharacterName`. This is the
   GM writer of that column; there is a fixed set and they all go through the
   formatter.
5. **In the transaction**: `SELECT … FOR UPDATE` on the Character row (the
   same lock `equipActions.js#toggleEquip` takes, so an Apply and a player's
   equip tap serialise), an `expectedUpdatedAt` check, the update, the tag
   ops, the audit row.
6. **Discord afterwards**, in `after()`, never inside the transaction — a
   REST call there holds a Postgres connection open across the network. The
   steps are computed as a **plan** rather than a run of independent `if`s,
   specifically so a dead character can't fall through into a branch that
   re-grants channel access.

### Optimistic concurrency

`expectedUpdatedAt` comes from page load and is re-checked inside the
transaction. Two GMs on one sheet is rare enough not to warrant the
cooperative lock Moves use, but silently clobbering the other one's save
isn't acceptable either — the loser is told to reload.

## 5. Tag ops

Keyed by **`tagId`, never `characterTagId`**. A `characterTagId` can vanish
between page load and Apply: the expiry sweep in `resolveNeeds()` deletes rows
at every turn close. `@@unique([characterId, tagId])` makes `tagId` a stable
address, and it is what every `requestEffects.js` helper already takes.

```
{ tagId, op: "add",    quantity?, source?, expiry?, equipped? }
{ tagId, op: "remove", quantity? }      // null quantity = the whole holding
{ tagId, op: "patch",  quantity?, equipped?, expiry? }
```

Applied **removes → adds → patches → equipped**. Removes lead so swapping one
tier of a chain for another can't trip the equip cap halfway through; the
equip count is checked **once** at the end, so "unequip A, equip B" isn't
rejected on B.

Every add stamps its expiry through `expiryFor(tag, openTurn)`. This is not
optional: the sweep matches on `expiresTurn`, so a timed tag granted with a
null there never expires at all.

## 6. The Tags tab is not PointBuy

`PointBuy` is the *player's* rules-respecting store and stays that way. The GM
editor shares its pure helpers and deliberately drops every gate:

- **Every category**, hidden ones (Demoness, Bacchus) and `meta` included.
  `TAGS.md` is explicit that a GM grant ignores `requiredTag` and the
  `TagGroup` gate; this is the surface that does it.
- **No budget.** Cost is information, never a limit — `tagPoints` is a field
  on the Identity tab.
- **Quantity, equipped and expiry** are all reachable, none of which the
  player's store exposes.

Both menus share `filterTagsByQuery` from `characterCreation.js`, so search
behaves identically. In `PointBuy` the search runs **after** `unlockedTags`,
never instead of it — otherwise a lucky search string would reveal a gated tag.

**Layout.** `TagEditor.js` splits into two permanent sections:

- **Holds** — a one-line row per tag the character actually has: name, ×qty
  when stacked, source, an equipped chip, an expiry badge. Every action that
  touches an existing holding lives here — Remove/Take one, Add one, Equip
  toggle, Make permanent, Unstage — so a stage is never pushed from two
  places for the same tag.
- **Catalog** — the browser, still tabbed by category. Within a tab, tags are
  bucketed under a small header per `TagGroup` (name plus the group's own
  colour as a swatch — the one inline colour in the app, since it's freeform
  data out of the database, not a theme token), chain order inside the
  group, ungrouped tags last under no header. Each row is one line — checkbox
  (mass-grant), name, cost, badges (custom / held / staged) — with the
  description behind a native `<details>` disclosure so the tab isn't a mile
  of always-open panels. A held tag still shows up in the catalog (that's how
  a GM finds a second copy or the next tier of a chain), but only carries the
  not-yet-held action; anything on an existing holding is Holds' job.

A non-empty search box searches the **whole catalog**, ignoring the active
category tab, with a chip on each hit naming its category. Clear the box to
go back to per-category browsing.

## 7. Turn economy

There is **no `turnsRemaining` column**. "Has this character acted" is
entirely "does an `Action` row exist for (characterId, the open Turn)".
Everything follows from that:

- **Restore turn** deletes the row, after `revertMoveEffects` claws back
  anything already applied. Since the staged-arbitration rework nothing pays
  before the turn-end push, so pre-push there is nothing to claw back —
  `appliedEffects` is null and the revert is a no-op — but the call stays,
  because it is what keeps this correct for any row that *has* been pushed.
  Shared with the workspace's Unlock as `deleteActionRestoringTurn` in
  `web/lib/moveEconomy.js` — two copies would drift the first time
  `appliedEffects` grew a key. It refuses while another GM holds a live lock
  on the Move, and DMs the player, since a freed turn they don't know about
  is a wasted day.
- **Spend turn** files a stub: a `PASSED` Routine worth nothing, marked
  `gmNotes: "auto:gm_spent_turn"` in the same family as
  `defaultMovePass.js`'s `auto:default_move`.

Editing a Move is **not** duplicated here. `/gm/turns` owns that, with the
cooperative lock, the dirty guard, Solve/Reject and the dice invariant on a
Kind switch; the Turn tab links across.

## 8. Custom tags

`/gm/dev/tags` lists the whole catalog and lets a GM author their own. A
GM-authored tag carries `Tag.custom = true` and lives only in the database.

- **Slugs are server-generated as `custom-${slugify(name)}`, never typed.**
  A GM naming a tag "Arthritis" would otherwise collide with the YAML slug and
  the next `db:sync-tags` would upsert straight over their row.
- **YAML-sourced rows are read-only here.** `docs/tags.yaml` is their source
  of truth and the next sync would revert a UI edit, so allowing it would be a
  lie.
- **Deleting** is superadmin-only, and refused for a tag anyone holds or
  anything references.

`db:sync-tags` is unchanged and still upsert-only. `db:prune-tags` is its new
destructive counterpart — see `SYNC.md`.

## 9. Bulk tagging

`/gm/players` grows a "Tag selected" bar beside the existing message composer,
reusing the row selection already there. `bulkTagCharacters` runs **one
transaction per character, never one across the batch**: a hundred-character
transaction would hold a row lock against each of those players' own equip
toggles for its whole duration, and one bad character would roll back
ninety-nine good ones. Partial success is reported; one audit row covers the
batch.

## 10. As a modal over `/gm/turns`

The whole panel — all five tabs and every microaction — also mounts as a
modal directly over the adjudication desk, so a GM chasing a Move or Request
can jump into a character's full sheet without leaving the desk or losing
its state (selected queue row, inspector, pins, staged effects). `DevPanel`
takes `frame="modal"` and owns the `Modal` itself, because the dirty (staged
edit) state lives inside it — closing has to go through the same
`useDirtyGuard` that already guards Apply/Cancel, so an unsaved edit prompts
before the modal closes.

The data assembly is shared, not duplicated: `web/lib/devPanelData.js`
exports `loadDevPanelProps(characterId, actingDiscordUserId)`, the exact
24-prop DTO bundle `<DevPanel/>` needs, and both the standalone page and the
desk call it. The desk reaches it through its own server action,
`getDevPanelData` in `web/app/(desk)/gm/turns/devPanelActions.js` — a
separate file from the desk's `actions.js` because that file is itself
`"use server"` and can't export a plain loader function, and because its
`requireGm` isn't importable from another `"use server"` module.

`DevCharacterButton` (`web/app/components/DevCharacterButton.js`) is the
shared jump button everywhere a `CharacterLink` might want one. Given an
`onOpen` callback it opens the modal instead of navigating to the standalone
page — the desk's `Workspace.js` owns the open/closed state and passes
`onOpenDev` down through `MoveDesk`, `RequestDesk`, and `InspectorColumn`.
Without `onOpen` it falls back to the plain `Link`, used everywhere else.

A microaction's refresh (Kill, Revive, resync, the staging buttons…) flows
through an `onMutated` prop rather than a bare `router.refresh()`: in the
modal it re-fetches `getDevPanelData` (so the open panel repaints) and also
calls `router.refresh()` (so the desk's own queue rows and staged hints
repaint too). The standalone page still just calls `router.refresh()`.
Delete follows the same shape through `onDeleted` — the modal closes itself
and refreshes the desk, instead of the page's `router.push("/gm/players")`.

## 11. The other Dev Panel: `/gm/dev`

Superadmin-only, and a different page — the game-level one. Three of its
sections are new with the zone rework, and this is the only doc that lists
them. `LAUNCH.md` covers Restart Game itself.

**Three new Game Config knobs**, all defaulting to off/5 and all reset by a
wipe:

| Knob | Does |
|---|---|
| `threadExpiryTurns` (1–60, default 5) | How many turns a player topic or private thread may sit with no messages before it is deleted |
| `threadExpiryEnabled` | Whether that pass runs at all. Persistent threads are **included**; Location topics and the anchors never expire (`CHANNELS.md` §4) |
| `autoReconcileEnabled` | Run the channel doctor's cheap reconcile after every turn advance. It always runs on bot restart regardless |

**System Reports** shows the latest run of each operational pass — `WIPE`,
`DOCTOR`, `DAWN_WIPE`, `BULK_MOVE` — with its summary and its failures. A
report with no finish time means the container died mid-pass; that is the
signal, and the reason the row is written *before* the work starts rather than
after. Two buttons sit above it: **Run channel doctor (dry)** and **Repair**,
both full scope, both fired into `after()` so the button returns immediately
and the outcome shows up where every other pass reports (`CHANNELS.md` §6).

**Bulk Move** relocates several living characters to one zone at once. It is a
raw relocation like `updateCharacterRaw`'s, **not** travel: no Move cost, no
`Action` filed, no adjacency check. The database write is synchronous; the
Discord half (role swap, special-channel access, pending thread invites) runs
sequentially in `after()` and lands on a `BULK_MOVE` report.

## 12. Where the code lives

| Concern | File |
|---|---|
| Page shell | `web/app/(app)/gm/dev/characters/[characterId]/page.js` |
| Shared DTO assembly (page + desk modal) | `web/lib/devPanelData.js` |
| Staged state, tabs, Apply bar, the "modal" frame | `DevPanel.js` |
| Microaction row and its dialogs | `ActionBar.js` |
| Tabs | `IdentityTab.js`, `TagEditor.js`, `TurnTab.js`, `GoalsTab.js`, `RecordTab.js` |
| Server actions | `actions.js` (same directory) |
| Validation, diff, tag ops, effect plan | `web/lib/characterWrite.js` |
| Turn economy, the Move lock predicate | `web/lib/moveEconomy.js` |
| FK-ordered character purge | `db/lib/deleteCharacter.js` |
| Custom tag catalog | `web/app/(app)/gm/dev/tags/` |
| Bulk tagging | `web/app/(app)/gm/actions.js#bulkTagCharacters` |
| Shared tag search | `web/lib/characterCreation.js#filterTagsByQuery` |
| Panel styling | `.dev-state-strip`, `.dev-state-group`, `.dev-bar-sep`, `.dev-apply-bar`, `.dev-tag-row`, `.dev-tag-group-head`, `.dev-modal-panel` in `globals.css` |
| Desk modal mount, its server action | `web/app/(desk)/gm/turns/DevPanelModal.js`, `devPanelActions.js` |
| The game-level panel (§11) | `web/app/(app)/gm/dev/page.js`, `actions.js` |
| The channel doctor it runs | `db/lib/channelDoctor.js` |
