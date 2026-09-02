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
| DM | Only if something changed | Every verb but Resync and Delete |

**Every microaction but Resync and Delete tells the player.** A dev-panel edit
is still a thing that happened to their character — `notifyCharacter()` in
`actions.js` sends a plain DM (not a Request; nothing here rides the Request
lifecycle) from `after()`, post-commit, same posture as the Discord-sync steps.
It's a thin `source: "gm_dev"` wrapper around the shared
`web/lib/notifyCharacter.js`, the same notifier every player-to-player
Request uses (`REQUESTS.md`) — one DM helper, one posture, everywhere a
player's sheet changes because of someone else's action. Resync is invisible
plumbing with nothing to report; a deleted character has no row left to DM
about. Apply summarises whatever actually changed (tags gained/lost,
resources, zone, name) rather than restating the whole diff. Kill is the one
exception: it doesn't call `notifyCharacter` at all, because
`killCharacter()` sends the death DM itself (`REQUESTS.md`) — a second one
here would double it up.

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

A staged edit's own affordance is the shared pair from `DESIGN-SYSTEM.md` §5:
`.field-dirty` outlines a single control with an unsaved edit, `.staged-row`
outlines a whole row, toned by `data-staged` for a staged add versus remove.

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
{ tagId, op: "add",    quantity?, source?, expiry?, equipped?, force? }
{ tagId, op: "remove", quantity? }      // null quantity = the whole holding
{ tagId, op: "patch",  quantity?, equipped?, expiry? }
```

Both a catalog Grant row and a Held row carry a quantity stepper now, so a
GM can grant several at once instead of clicking one at a time. Ask for more
than one of a tag the catalog marked non-stackable and the button reads
"Grant ×3" and stages `force: true` — a GM surface may stack any tag, not
only the ones flagged `stackable` (`TAGS.md` §5a).

Applied **removes → adds → patches → equipped**. Removes lead so swapping one
tier of a chain for another can't trip the equip cap halfway through; the
equip count is checked **once** at the end, so "unequip A, equip B" isn't
rejected on B.

A `remove` fires the tag's **treated-wound aftermath** (`Tag.removesInto`,
`TAGS.md` §5c): removing a Broken Bone leaves Splinted behind for four turns.
This used to be godmode and skip the chain; it doesn't, because most GM
removals are treatments. The aftermath is rolled per op, granted **after** the
adds — so an explicit add of the same tag, with its own source and expiry,
wins — and recorded as `granted` on the `remove` entry in the audit row.
Removing a tag the character isn't holding grants nothing.

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

  The catalog half — search, tabs, grouping, the row shell, multi-select — is
  the shared `web/app/components/TagCatalogBrowser.js`, extracted so
  `EffectComposer.js` (`/gm/turns`' stage-an-effect modal) gets the same
  power-user tag surface instead of a flat name/slug search box. Row actions
  are the one thing each caller supplies (`renderActions`): `TagEditor.js`
  grants live, `EffectComposer.js` stages an add/remove op instead. Held-tag
  context differs too — `TagEditor.js` keeps its own Holds section above the
  browser (with the live-mutation actions the browser doesn't render);
  `EffectComposer.js` shows the *target's* held tags read-only next to its
  own staged-ops list, since a staged effect only ever adds a fresh op.

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
  `defaultMovePass.js`'s `auto:default_move`. It DMs the player too now, so
  like Restore and Kill it opens a `RequestDialog` for a reason first — the
  same reason becomes both the stub's `description` and the DM text.

Editing a Move is **not** duplicated here. `/gm/turns` owns that, with the
cooperative lock, the dirty guard, Solve/Reject and the dice invariant on a
Kind switch; the Turn tab links across.

## 7a. Resource transfers

The Identity tab's Resources field only mints or burns ⬢ — it has no
counterparty, because a staged edit is one character's diff. "The Watchmen
paid Sera 8 ⬢" needs a party on both ends, which is what the **Transfer ⬢**
button (`ActionBar.js`, `ResourcesIcon`) is for: two Selects, "From" and
"To", each over the same party list — every ALIVE character plus every
faction's Silo (Unaffiliated excluded) — with a small ⇄ button to swap them,
plus an amount. Either end can be a character or a Silo, any pairing,
character-to-character and Silo-to-Silo included; this panel just preselects
"To" as this character, with "From" left on "— Select… —".

It is **immediate, not staged**, unlike every other Dev Panel edit. The
counterparty is a faction, not this panel's own subject, so having half of it
wait on *this* character's Apply/Cancel would be incoherent — the same
reasoning that keeps Kill, Revive, Restore turn and Spend turn off the staged
diff. It goes through `web/lib/gmTransfer.js`, the same primitive the
adjudication desk's staged transfers and `/gm/players`' FactionsPanel use
(`db/lib/resourceTransfer.js#applyTransfer`), open to any GM — not just a
superadmin — and writes an `AuditLog` row plus a `SiloTransaction` row rather
than a `Request`, so there is no one-click Undo; the reverse transfer is the
reversal. See `FACTIONS.md` §5.

This door now covers any pairing, not just this character against a Silo —
`gmTransferResources({ fromKey, toKey, amount, reason })` is the same generic
primitive `/gm/players`' FactionsPanel and the adjudication desk's
`TransferComposer` stage a transfer through, so the Dev Panel's server action
(`transferResourcesImpl`) just passes `fromKey`/`toKey` straight through
rather than reconstructing them from a `characterId` + `factionId` +
direction. It still preselects this character on one end for convenience,
still writes an `AuditLog` row instead of a `Request`, and is still
**immediate, not staged** — same reasoning as above.

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

### 8a. The shared custom-tag dialog

Authoring a one-off tag isn't only a `/gm/dev/tags` action — a GM chasing a
Move or editing a sheet often wants to invent a tag on the spot and hand it to
someone right there. `web/app/components/CustomTagDialog.js` is the one
dialog for that, reached from several doors: the standalone catalog page's
"New tag" button, the Dev Panel's Tags tab (`TagEditor.js`), and the
adjudication desk's stage-an-effect modal (`EffectComposer.js`). Every door
mounts it through `TagCatalogBrowser`'s optional `onCreateCustom` prop, which
renders a "+ Custom tag" button in the browser's toolbar carrying the same
tooltip everywhere: *"Use this for things that would affect adjudications —
not just little bracelets or something."*

**The tag's own fields are `web/app/components/TagFieldset.js`**, shared with
the catalog page's *edit* dialog. The two used to be different forms — this
quick door sent five fields while the edit form sent sixteen — so a tag
invented mid-adjudication couldn't expire, stack or be worn until someone
walked to `/gm/dev/tags` and edited it. One component means they can't drift
again.

It opens on **Basics** — Name, Category, Group, Description, Seen by others on
🔍 — with everything else folded into a collapsed `Advanced` disclosure in four
blocks: **Behaviour** (`stackable`, `equippable`, `concealsIdentity`,
`consumable`, `removable`, `tradeable`), **Lifespan** (`defaultDurationTurns`,
`expiresInto`, `removesInto`), **Economy** (`pointCost`, `purchasable`,
`purchasableAfterStart`, `sellable`, `sellablePrice`) and **Requirement**
(`requirementTurns`, `requirementResources`, `requirementGambit`,
`requirementSkills`). The edit dialog opens that disclosure, since a GM there
came to change a field; the quick door leaves it shut.

Group is still offered only when the caller's tag rows carry a group id —
several DTOs trim `TagGroup` to name/color for display and can't resolve a
picker back to one. The **two chains** — expiry (`expiresInto`) and removal
(`removesInto`, the treated-wound aftermath, `TAGS.md` §5c) — take the same
posture for the same reason: they address tags by `slug`, so a door whose
rows carry none hides them rather than offering a picker whose selections
would never match. They share one row editor; only the expiry chain is gated
on a duration, since the removal chain is fired by the removal itself.

Three pairings are mirrored as disabled controls and re-checked on the server:
`concealsIdentity` and `WORN` visibility need `equippable`, `sellablePrice`
needs `sellable`, and an `expiresInto` chain needs a duration. The chain itself
is a list of outcome rows, each a multi-pick — one tag means "becomes this",
two or more an even coin-flip, the `{ oneOf: [...] }` shape
`db/lib/tagExpiryPass.js` reads.

The **structural** fields stay out on purpose — `parentTagId`,
`requiredTagId`, `exclusive`, `depotPrice` and the `consumesInto` family wire
tags to each other, which is catalog structure for `docs/tags.yaml` to hold
under review. The two chains are the deliberate exception: an untreated wound
getting worse — and a treated one leaving its aftermath — is most of the
point of a homebrew injury, and both point at existing tags rather than
restructuring them. Their rules (`normalizeExpiresInto` /
`validateExpiresInto` and the `removesInto` pair) live in
`db/lib/tagShapes.js` so this form and `db:sync-tags` enforce one rule set —
otherwise the form would accept chains the next sync rejects.

The door's own fields, around that fieldset: Clone from… (prefills **every**
field from an existing catalog tag, its duration and expiry chain included,
then edits normally) and Assign to (a searchable multi-pick over whatever
character list the door supplies — hidden entirely when the door has none to
offer). New tags default to `purchasable: false`,
`purchasableAfterStart: false`, `removable: true`, and visible on 🔍 — a
homebrew tag for solving one situation, not a catalog entry meant to reach the
store.

Doors that pass a character list also get an Apply now / Stage for turn end
toggle (`allowStage`). "Apply now" grants live, in the same transaction as the
tag's creation (`applyTagOpsInTx`, same engine §5 documents). "Stage for turn
end" writes a `StagedEffect` per target instead — one shared `batchId` across
a multi-target assignment, built the same shape `createStagedEffects` uses —
so a GM chasing a Move can invent the tag and queue it against that Move's
target in one gesture. Either way it's **one transaction, one audit row**
(`gm_custom_tag_created`, mirroring `bulkTagCharacters`' details shape) for
the tag's creation and its assignment together. The server half is
`createCustomTagAndAssign` in `web/app/(app)/gm/dev/tags/actions.js`.

The Dev Panel's own door (`TagEditor.js`) is a deliberate exception to §2's
staged/immediate split: a custom-tag assignment from there commits through
the dialog's own transaction immediately, rather than riding the Tags tab's
own pending-ops/Apply-bar flow — the same posture Bulk tagging (§9) already
takes for its own convenience action. `DevPanel.js` passes the current
character's id and name into `TagEditor.js` so "Assign to" comes preselected.
The same door also sits in the shared inspector's Tags tab on both desks
(`web/app/components/InspectorColumn.js`, `customTag` prop) — staging by
default on `/gm/turns`, applying on `/gm/players`. A multi-target grant runs
one transaction per character (never one across the batch, for the reasons §9
gives), refuses dead targets, caps at 200, and reports partial failure.

## 9. Bulk tagging

The player desk's roster grows a "Tag selected" bar beside the message composer,
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
exports `loadDevPanelProps(characterId, actingDiscordUserId)`, the DTO bundle
`<DevPanel/>` needs to **open**, and both the standalone page and the desk
call it. The desk reaches it through its own server action,
`getDevPanelData` in `web/app/components/devPanelActions.js` — a
separate file from the desk's `actions.js` because that file is itself
`"use server"` and can't export a plain loader function, and because its
`requireGm` isn't importable from another `"use server"` module.

**The Record tab is not in that bundle.** Its four history lists (100 Moves,
100 Requests, 100 audit rows, 50 DMs) were the largest thing the panel loaded
and the least likely thing it used — most visits are "grant a tag, close it".
They live in a second export, `loadDevPanelRecord(characterId,
discordUserId)`, behind the `getDevPanelRecord` server action, and `DevPanel`
fetches them from the tab button's own **click handler** on the first switch
to Record — not from an effect, since `react-hooks/set-state-in-effect` is an
error in this repo. `RecordTab` renders a "Loading…" line until they land,
and the result is cached for the life of the mount. `openTurnAction` used to
be found inside that 100-row Moves list; it is now its own small `findFirst`
in the main batch.

`DevCharacterButton` (`web/app/components/DevCharacterButton.js`) is the
shared jump button everywhere a `CharacterLink` might want one. Given an
`onOpen` callback it opens the modal instead of navigating to the standalone
page — the desk's `Workspace.js` owns the open/closed state and passes
`onOpenDev` down through `MoveDesk`, `RequestDesk`, and `InspectorColumn`.
Without `onOpen` it falls back to the plain `Link`, used everywhere else.

In the `onOpen` branch it also **prefetches at click time**: `onPointerDown`
calls `prefetchDevPanel(characterId)`, exported from `DevPanelModal.js`,
which starts `getDevPanelData` and parks the promise in a module-level map.
The modal's mount effect consumes an entry younger than 20s instead of firing
its own fetch, so the round trip overlaps the mount rather than following it.
`reload()` (the `onMutated` path) drops the map entry first — a microaction
just changed the sheet, so any parked promise is stale by definition.

A microaction's refresh (Kill, Revive, resync, the staging buttons…) flows
through an `onMutated` prop rather than a bare `router.refresh()`: in the
modal it re-fetches `getDevPanelData` (so the open panel repaints) and also
calls `router.refresh()` (so the desk's own queue rows and staged hints
repaint too). The standalone page still just calls `router.refresh()`.
Delete follows the same shape through `onDeleted` — the modal closes itself
and refreshes the desk, instead of the page's own navigation away.

## 11. The other Dev Panel: `/gm/dev`

Superadmin-only, and a different page — the game-level one, not this doc's
character panel. It is the fourth page in the `(desk)` family (`DESIGN-
SYSTEM.md` §6): a two-column settings workspace, `OpsNav.js` picking one
section down the left over a validated `?s=` param (`turn` when absent or
unrecognised), one settings surface on the right. Each section fetches only
its own data — `listGuildMembers()` and the whole tag catalog only load for
`?s=antagonists`, instead of on every visit regardless of which section a GM
actually opens.

The split across two route groups is deliberate. `page.js` and `OpsNav.js`
live in `(desk)/gm/dev/`, because the `(app)` layout's fixed `TurnChip` would
float over a desk shell (same reason no desk carries one — `DESIGN-SYSTEM.md`
§6). The server actions and the other sections (`characters/`, `factions/`,
`tags/`) stay in `(app)/gm/dev/`, since only the top page needed to move. The
superadmin gate lives in `page.js` itself rather than the layout, because
`(desk)/layout.js` only checks GM membership — `/gm/players` and `/gm/turns`
share that layout and are meant to stay GM-open.

Six sections: **Turn** and **Configuration** under "Game"; **Bulk move**,
**System reports** and **Antagonist roster** under "Operations"; **Restart
game** on its own under "Danger". The last three are the ones that arrived
with the zone rework, and this is the only doc that lists them. `LAUNCH.md`
covers Restart Game itself.

**Game Config knobs documented nowhere else**, all reset by a wipe:

| Knob | Does |
|---|---|
| `autoReconcileEnabled` | Run the channel doctor's cheap reconcile after every turn advance. It always runs on bot restart regardless |
| `desiresEnabled` | Let players set a NEW Desire, in any slot, on `/character`. Off greys that form with "Temporary disabled." An already-ACTIVE Desire in any slot can still be fulfilled or cancelled, and GMs are unaffected — `setDesireGm`/`endDesireGm` on this panel bypass every catalog gate regardless (`DESIRES.md` §6, `REQUESTS.md` §5) |
| `desireSlots` | How many Desires a character may hold ACTIVE at once, one per slot (default 2). Each slot sets/cancels/fulfils independently (`DESIRES.md` §1) |
| `maxDrawbackTags` | Character-creation cap on the COUNT of drawback tags a player may point-buy (default 5) — not their combined point value. A GM grant bypasses it, same as every other creation gate (`TAGS.md` §4a) |

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
| Shared DTO assembly (page + desk modal) — `loadDevPanelProps` to open, `loadDevPanelRecord` for the deferred Record tab | `web/lib/devPanelData.js` |
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
| The shared tag form body (both custom-tag doors) | `web/app/components/TagFieldset.js` |
| `expiresInto`'s shape + rules, shared with `db:sync-tags` | `db/lib/tagShapes.js` |
| Shared catalog browser (categories, search, grouping, multi-select) | `web/app/components/TagCatalogBrowser.js` |
| Panel styling | `.dev-state-strip`, `.dev-state-group`, `.dev-bar-sep`, `.dev-apply-bar`, `.dev-tag-row`, `.dev-tag-group-head`, `.dev-modal-panel` in `globals.css` |
| Desk modal mount (shared by turns/players desks) + `prefetchDevPanel`, and its server actions (`getDevPanelData`, `getDevPanelRecord`) | `web/app/components/DevPanelModal.js`, `devPanelActions.js` |
| The game-level panel (§11) — page shell + section rail | `web/app/(desk)/gm/dev/page.js`, `web/app/(desk)/gm/dev/OpsNav.js` |
| The game-level panel's server actions | `web/app/(app)/gm/dev/actions.js` |
| The game-level panel's toggle help text, read through `InfoIcon` | `web/app/(app)/gm/dev/devHelp.js` |
| The game-level panel's styling | `.desk-body--ops`, `.ops-nav`, `.ops-nav-group`, `.ops-nav-title`, `.ops-nav-item`, `.ops-main`, `.ops-section`, `.ops-section-head`, `.ops-lede`, `.ops-grid`, `.ops-toggles`, `.ops-toggle`, `.ops-toggle-note`, `.ops-actions`, `.ops-report`, `.ops-report-head`, `.ops-report-detail` in `globals.css` |
| The channel doctor it runs | `db/lib/channelDoctor.js` |
