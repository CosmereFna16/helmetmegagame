# The Player Desk

`/gm/players` — every player, and every conversation with one, on one screen.
Companion to [`ADJUDICATION.md`](ADJUDICATION.md) (its sibling desk) and
[`DEV-PANEL.md`](DEV-PANEL.md) (where a GM actually edits a sheet).

## 1. What it replaced, and why

Two screens, both weak in the same direction.

**`/gm/messages`** was a support-grade inbox inside `PageShell width="wide"`,
so it spent most of a desktop on gutters. Worse, its conversation list was
built from a `groupBy` over `DirectMessage` filtered to rows that *had* a
message — so it could only ever list players who had **already written**.
There was no way to start a conversation. The thread route worked fine for a
character with no history; nothing linked to it.

**`/gm/players`** was a nine-column table with two bulk verbs and a recursive
faction table beside it. It could not answer "who still hasn't moved this
turn", which is the question that comes up most in the back half of a turn.

They are one desk now. The rail is the **union** of "everyone with a
conversation" and "everyone with a character", which is what makes a first
message possible at all — that is the structural fix, not a new button.

## 2. The shell

`web/app/(desk)/gm/players/`, the second page in the `(desk)` route group. Full
viewport minus the nav rail, on the same `.desk-*` classes as the adjudication
desk — the two are the same tool and should read as one.

```
┌ header: Players · turn chip · N tracked · N unread · N awaiting · Bulk message ┐
│ RAIL            │  ROSTER TABLE (nobody selected)  │  INSPECTOR     │
│ search, filters │  ─────────── or ─────────────────│  Sheet · Tags  │
│ zone scope      │  CONVERSATION                    │  Moves ·Archive│
│                 │  thread + composer                │  DMs           │
└─────────────────┴──────────────────────────────────┴────────────────┘
```

Fleet view, then person view. The middle column is the roster with nobody
selected and the conversation once somebody is picked. The **inspector is the
third column of the shell**, not of the person view (§6): it is there on the
roster too, and it does not get thrown away and rebuilt every time you open a
different conversation. Its tabs are the five base ones —
`Sheet · Tags · Moves · Archive · DMs`, same list as `/gm/turns`. Canon is not
a sixth tab any more: it is folded into **Moves** as the "This turn" section
above that person's past turns (§6).

Under the shared `.desk-*` mobile breakpoint (720px, `DESIGN-SYSTEM.md` §8),
this desk is the exception to the rest of the family: the rail is the content
here, not a queue beside the work, so `.desk-body--players` and `.desk-rail`
are exempted from the shared single-column-stack / 45vh-cap rules
(`globals.css`, the players-desk mobile block) and the roster just runs full
width, full length, scrolling with the page. The **inspector** is not
exempted: it stacks and keeps the shared 45vh cap, exactly like the one on
`/gm/turns` — same column, same component, same rule. `/gm/turns` and `/gm/audit` keep
the 45vh cap on their rails — there, the rail is a queue and the main pane is
the work.

Routes are keyed on **`discordUserId`, not `characterId`**: that is what
`DirectMessage` keys on (no character FK, by design), every character has one,
and it keeps working for a conversation whose character is gone.
`/gm/messages` and `/gm/messages/:id` redirect here (307 — an internal tool
with no SEO to protect and a real chance of another reshuffle).

## 3. The rail

One lens. The rail is the inbox: with no search query it lists only players
with a conversation, sorted pinned → unread → recency, showing the last
message with a `You:` / `GM:` / `Bot:` prefix. There used to be a second,
Roster lens — everyone with a character, alphabetically — as the only way to
reach someone who had never written. It's gone: a search query does that job
instead (below), and it did not earn a whole second lens, a segmented toggle
and a sort-order tie-break of its own.

Typing a query widens the candidate set from "has a conversation" to "has a
conversation **or** a character" — that's what makes a first message
possible at all, since a character with no DM history still has a working
`href` to an empty thread. A query also **pauses** the zone filter and the
Needs-reply toggle rather than composing with them: the zone filter seeds
from the GM's own zone seat, and without the pause it would silently hide a
cross-zone search hit, which is exactly the case search exists for. The rail
shows a small "Searching everyone — filters paused." line under the search
box while a query is active. Sort while searching is match score, then
conversation-havers before non-havers, then recency — a name hit with a
thread still usually outranks a name hit with none.

Search is `scoreMatch` (`web/lib/fuzzySearch.js` — keep that the one shared
engine) over name, role, faction, Discord username **and** global name, zone,
**held tag names** and message preview. `scoreMatch` tokenizes and folds diacritics, tolerates a
typo, and takes `field:term` scopes — `role:smith`, `zone:caves`, `@handle`
as shorthand for `username:handle` — so a bare word still matches anything
but a scoped one narrows to that field only. The zone filter and
`ZoneScopeToggle` seed from the GM's zone seat the same way every other GM
table does.

The old All/Unread/Awaiting three-way toggle is one **Needs reply** button
now, filtering to rows where `unreadCount > 0` or the player wrote last
(`lastDirection === "INBOUND"`). Two of the three old lenses were sort orders
wearing a filter's clothes; a 100-player inbox needs "who is waiting on me",
not three mutually exclusive views of it. What used to be the "Awaiting"
filter is a row-level mark instead: any row where the player wrote last and
it's already read (`lastDirection === "INBOUND" && unreadCount === 0`) gets a
small muted "awaiting" chip next to its time chip — the unread badge already
says as much when there's an unread count, so the chip only shows when there
isn't one. The desk header's meta row totals the same predicate as an
"N awaiting" chip beside "N unread".

**The ✓ under the star clears a row from that pile.** Some messages want no
answer — a thank-you, an "ok", something already handled in-game — and without
a way to say so they sit in the awaiting count forever, inflating the one
number the desk exists to answer. The second gutter button under each row's
pin marks the conversation as needing no reply: the `awaiting` chip goes, the
row drops out of **Needs reply**, the header's count falls, and the
conversation is marked read too (saying it needs no answer implies having read
it). Unlike the pin beside it, this is **server state and desk-wide**, on
`ConversationMeta.handledAt` — whether a conversation still wants an answer is
a fact about the conversation, not one GM's taste, and five GMs should see one
answer. It is a **dismiss, not a mute**: the mark is a timestamp, and the rail
only honours it while it is at or after the conversation's last message, so
the next inbound DM outruns it and the row is awaiting again with nothing to
clean up. Clicking ✓ again clears it outright.

**The ⊘ under it mutes the conversation outright.** Where ✓ says "nothing to
answer here, for now", ⊘ says "this thread is not part of my working set":
the row leaves the rail entirely and stops counting toward both unread and
awaiting. It is **desk-side only** — nothing about the bot's behaviour toward
that player changes, they are not blocked or told anything, and their DMs
still arrive and still read normally. It is also **standing**, unlike ✓: a
new message does not lift it, because a mute is a decision about a person
rather than about one message. `ConversationMeta.mutedAt` holds it until a GM
clicks ⊘ again.

Muted rows are hidden, not deleted. A **Show muted (N)** button appears among
the rail's filters whenever there are any; it reveals them **in their ordinary
place** in the rail, rendered greyed (`[data-muted]` in `globals.css`), with
the gutter buttons at full strength since unmuting is what a GM came there to
do. They are deliberately not sunk to the bottom: a muted row you are looking
for on purpose should be where you expect it, not at the end of a hundred
others. A
search query does **not** lift the mute on its own the way it pauses the zone
and Needs-reply filters — those are lenses over the inbox, this is a standing
decision — so finding a muted person means showing muted first.

**Content search is the server's half of the same box.** The fuzzy engine only
ever sees what the layout ships to the client, and that is *one preview line
per conversation* — so "find the thread where we talked about the barley"
could not work at all, whatever the preview happened to be. A query of three
characters or more is therefore also sent, debounced 300ms, to
`searchConversations` (`actions.js`): a Postgres `ILIKE` over
`DirectMessage.content` carrying the same noise predicate as the rest of the
desk, grouped per `discordUserId`, newest 50. Those hits merge in **under**
the fuzzy ones — a name match is still what a GM usually means — and only for
people the fuzzy pass could not already see, marked `in messages · N`.
Clearing the box drops them, because the hits are stored keyed by the query
that produced them and simply stop matching (clearing state from an effect is
what `react-hooks/set-state-in-effect`, an error in this repo, exists to
catch).

The **roster table** (§4) runs the same `scoreMatch` engine, over name, role,
faction, both zones (seat and standing-in) and Discord handle — as a filter
only, though: unlike the rail it keeps whatever column sort the GM chose
rather than reordering by match score, since the roster has real sortable
headers to preserve.

**Pins are shared with the adjudication desk** (`usePins.js`). This is a merge,
not a rename: the two desks kept separate keys in separate identity spaces —
`desk-pins` held `{ characterId }` objects, `messages-pins` held bare
`discordUserId` strings — so an entry now carries both ids and the old keys
migrate once on first read. Identity is `characterId` when there is one,
`discordUserId` otherwise.

Both desks now prune dead pins against what each one knows, via
`usePins({ knownIdentities })`: this desk passes both id spaces (it has
rows keyed on both), `/gm/turns` passes characters only. A pin whose
identity isn't in the caller's `knownIdentities` for its namespace drops
silently on load, instead of surviving as a pin to nothing.

## 4. The roster

Everything the old table had, plus the columns a GM actually asks about
mid-turn: **Acted this turn** and **tag count**. A **Catatonic** column sits
beside Cursed, same shape (word or dash), computed from the `catatonic` tag
rows the page already loads — the same AFK state the rail avatars mark with
a muted dot (`CharacterAvatar`'s `catatonic` prop; see `TAGS.md` §7 for
every surface the tag reaches). Since the guild-leave rework, a Catatonic
mark can also mean the player has left the server and the character is on
the death countdown (`CHARACTERS.md` §5). Selection is a `Set` of
character ids, so it survives paging, filtering and sorting. Select-all covers
the **filtered page**, not the whole roster — a header checkbox that quietly
picks up a hundred people you cannot see is how a broadcast goes to the wrong
room.

Two bulk verbs, both GM-safe:

| Verb | Action | Lives in |
|---|---|---|
| Message selected | `sendGmBroadcast` | this desk's `actions.js` (sequential, never a fan-out) |
| Tag / untag selected | `bulkTagCharacters` | `(app)/gm/actions.js` (one transaction **per character**) |

`BulkComposer` — the same modal, over the whole living roster with
zone/faction bulk-check — has two more doors: **Bulk message** in the desk
header, reachable from the rail where the roster's checkboxes are not, and
**Message pinned** in the inspector's pin row, which opens it prefilled with
the pinned characters. It was a finished component nothing imported until
then.

**Bulk zone moves are deliberately absent.** `bulkMoveCharacters` requires
superadmin, so a button for it here would fail for most of the people looking
at it. It stays on `/gm/dev`.

The faction hierarchy is a view of this table rather than a separate tab, and
`/gm/players?tab=factions` still selects it — `/faction` sends a GM here.
A faction's **name** is the door out to `/faction`'s per-faction detail view
(member roles, add/remove, Silo history) — there is no separate "Manage" link.
Clicking a faction from a **player** row still stays in the desk: it switches
to the Factions tab and highlights that row instead of navigating away.

Each faction row's Silo cell carries a **Move ⬢** control — the fix for GMs
having no way to touch a faction Silo before this beyond `/gm/dev/factions`'s
superadmin-only absolute-set field. It's open to any GM, applies immediately
(no `Request` row, no Undo — the reverse transfer is the reversal), and
covers every counterparty a Silo can trade with, including another Silo
(`web/lib/gmTransfer.js`, `FACTIONS.md` §5). The character half of its picker
is built from the faction rows already on the page rather than a second
roster fetch.

## 5. The conversation

A real chat pane: the transcript takes the height that's left and scrolls
inside itself, with the composer pinned at the bottom. It used to be a 32rem
`DmThread` block sitting in document flow under a page header.

- **Enter sends, Shift+Enter makes a newline** (`useSubmitOnEnter.js`).
  Two guards that are not optional: `isComposing`, because an IME uses Enter to
  accept the candidate being composed and sending there posts half a word; and
  `useIsCoarsePointer`, because on a phone Return is the only way to make a
  paragraph. Touch sends with the button.
- Drafts persist per conversation in `localStorage`, read through
  `useSyncExternalStore` — the textarea's value *is* the store's value, so
  there is no `setState` in an effect to seed it.
- **Send is optimistic.** The row appears and the draft clears the instant you
  press Enter, styled pending (`data-pending` on the bubble) until the server
  answers; a failure removes the row, puts the draft back exactly as it was,
  and shows the error, so nothing a GM typed is lost to a failed send. The
  server half matches: `sendGmDm` awaits the Discord POST (a GM must know if
  *that* failed) and returns the one created row instead of re-reading the
  whole thread page, with the audit row, the read cursor and both
  `revalidatePath`s deferred into `after()`.
- **Claim/release** is advisory (`ConversationMeta`), so five GMs don't answer
  the same player twice. The same table carries `handledAt` and `mutedAt`, the
  rail's ✓ "needs no reply" mark and its ⊘ mute (§3).
- The thread is a **conversation**, not a raw `DirectMessage` dump: rows that
  are pure bot/UI plumbing — inspect/dossier embeds, the ✏️ edit-flow prompt
  (`bot/src/lib/editModal.js`), `@mention` relay notices, proxy hand-back —
  are tagged `source: "system_notice"` at the `sendDm()` call site. The old
  ✏️ DM-collector's replies were `source: "prompt_reply"`; nothing writes
  that any more (✏️ is a button and a modal now, so editing produces no
  inbound DM at all), but the historical rows stay filtered.
  (Tag search covers **living** characters only — the layout's tag load is
  bounded to `ALIVE`, since it re-runs on every revalidation; a dead
  character is still found by name, role, faction and handle.)
  `system_notice` and `prompt_reply` are excluded at the query
  (`web/lib/dmThread.js#withoutDmNoise`), not just visually collapsed.
  **The rail's raw queries carry the noise predicate written out as SQL**
  (`layout.js`: the `DISTINCT ON` preview and the unread count, via
  `dmThread.js#dmNoiseSql`), which they did not before — so the rail
  previewed and *sorted by* rows the pane hid, and an inspect embed sat at
  the top of the inbox as if the player had just written. Written as
  `IS DISTINCT FROM` rather than `NOT (… = …)`: a NULL predicate drops its
  row, and almost every row has a NULL `source` or no `meta.embed` key.
  - **The preview snippet goes one step further than the noise filter.**
    A *third* query (`layout.js`, `genuineConversationSql`) additionally
    excludes `bot_auto`/`player_event`/`gm_dev`/`move_unlock` — canned
    bot/effect text ("You were given 1 ⬢.", a dev-panel edit summary, a
    Move-unlock notice) that would otherwise win the "last message" slot and
    bury a player's actual last line. This is **preview text only** — the
    row's relative-time chip and its "awaiting reply" status still key off
    the ordinary noise-filtered latest DM, automated or not, so recency
    doesn't silently change meaning depending on who or what sent the most
    recent thing. `staged_push` (turn-result prose) is deliberately **not**
    in this bucket — it's GM-authored content, just delivered in bulk. In
    the pane, these same four sources render as a centered, bubble-less
    `SystemLine` (`DmThread.js`, `.dm-system-line` in `globals.css`) instead
    of an ordinary bubble, and still collapse in runs of 3+ the way
    `bot_auto` alone used to.
- Mark-read fires from a client effect, never during RSC render — otherwise
  Next's link prefetch marks a conversation read on hover.

## 6. The inspector

`Sheet · Tags · Moves · Archive · DMs`, fetched on demand and memoized per
`${characterId}:${tab}` for the life of the page view. **Moves** is that
person's turns: this desk's **Canon** section on top ("This turn"), then that
person's past turns underneath ("Past turns", ADJUDICATION.md §3). One
question, one tab — Canon used to be a sixth tab pointing at Moves with a
"Past moves →" button, which made the GM click twice to read one story.

This used to be `DossierColumn`, a column of the **person view** — which meant
it did not exist on the roster at all, and every navigation between two
players threw it away and rebuilt it. It is the adjudication desk's inspector
now, literally: one component, `web/app/components/InspectorColumn.js`, mounted
by both desks. There the character is context for a Move, here the Move is
context for a character, but it is the same five base tabs over the same
`getCharacterInspector` / `getArchiveSlice` fetchers, the same staged quick
edits (✕ a tag to stage its removal, click Resources or Tag points to stage a
± delta — which is why the player desk's `layout.js` loads this turn's
unapplied `StagedEffect`s too), the same DM composer, the same
`ArchiveContextModal`, and the same **`+ Custom tag`** door on the Tags tab.
The door differs by desk and only by desk: `/gm/turns` defaults to *staging*
the new tag because that desk is mid-push, `/gm/players` defaults to
*applying* it because this one is a conversation.

**Canon is this desk's one extra**, and the seam it arrives through is
`tabPreludes` — `{ [tabKey]: (ctx) => node }`, a desk-specific section the
shared column renders *above* a base tab's own body. It replaced `extraTabs`
(whole tabs appended after the base five), because a prelude is the narrower
seam: the only thing a desk wants above a tab is the part that changes, and a
section can't fork the tab list or the tab-bar layout the way an extra tab
could. The adjudication desk passes none.

**The caching story is the whole reason a prelude is not a tab.** A prelude
owns its own fetching and its own freshness and takes **no** slot in the
shared per-`(character, tab)` cache: `CanonTab` refetches on every mount by
design, because staged rows and the open Move change under the GM all day.
Past moves are settled history, so they stay cached for the page view like
every other base tab. The prelude also renders *before* the loading/error/data
branches, so this turn paints without waiting on the past-turns fetch.

`InspectorHost.js` is the client half. Which person the column shows is
**derived, never stored**:

- `useSelectedLayoutSegment()` is the `[discordUserId]` the child route is on,
  so opening a conversation points the inspector at that player with nobody
  having to tell it;
- a `useState` **override** holds the last person clicked in the inspector's
  own search box or pin row, which is how a GM looks at somebody *other* than
  the open conversation.

The override remembers which segment it was set under and is ignored once the
route moves on, so navigating to another player follows the route again
instead of staying stuck on a stale pin. All of it is computed during render:
there is no context, and no effect syncing state to a prop — the latter is a
lint **error** here (`react-hooks/set-state-in-effect`).

**Canon** is the player's open Move, staged messages and staged effects, with
"Insert into reply" buttons that write into the composer's draft. The wire
used to be a ref handed down from `PersonShell` while the two were siblings;
the inspector is a column of the shell now, so it writes the draft's
`localStorage` key directly (`players/dmDraft.js`) and the composer — whose
value *is* that store, read through `useSyncExternalStore` — picks it up.

## 7. GM notes (removed)

The GM-notes tab (`NotesTab.js`, and the `listGmNotes`/`addGmNote`/
`deleteGmNote` actions) was removed from the desk on 2026-08-31. The
`GmCharacterNote` table still exists in the schema — nothing reads or writes
it any more — and stays orphaned on purpose. Dropping the table is a later,
deliberate migration, not a side effect of this removal.

## 8. Getting between the desks

- **⌘K** (`CommandPalette.js`) — a player, an open Move or Request, a zone, a
  faction, or any page including the ones with no rail item at all
  (`/gm/gamemasters`, `/gm/dev/tags`, `/gm/dev/factions`). It also offers
  "Audit: about <name>" and "Audit: by <name>" per character, which are just
  pre-filtered `/gm/audit` URLs — the audit desk keeps its whole filter state
  in the query string, so anything can link into a view of it. Built
  on `Modal` so it inherits the focus trap and the topmost-Escape stack; its
  `.modal-overlay` also stands the adjudication desk's Escape and 45s refresh
  down, the way every other dialog does. The index is fetched on first open and
  held for a minute.
- A **Move or Request** links to that player's conversation; the
  conversation's **Canon** section (top of the Moves tab) links back to that
  Move already selected.
- A roster row's name opens the conversation; the icon beside it opens the Dev
  Panel.

## 9. Revalidation

The rail lives in `layout.js`, and **a page path does not invalidate what is
below it**. So every `revalidatePath("/gm/players")` is
`revalidatePath("/gm/players", "layout")` — without it a GM sitting in a
conversation never sees the list move. There are a dozen call sites across
`faction/`, `gm/`, `gm/dev/`, `lifeweb/`, `gamemasters/` and the adjudication
desk's own actions.

## 10. File map

| File | Role |
|---|---|
| `(desk)/gm/players/layout.js` | Desk shell + all rail data (the union query) |
| `PlayerRail.js` | The inbox rail: search (widens to the roster, pauses filters), zone filter, Needs-reply toggle, pins, the ✓ needs-no-reply mark, the ⊘ mute and its Show-muted toggle |
| `page.js` / `RosterTable.js` | The fleet view + bulk verbs |
| `FactionsPanel.js` | The faction hierarchy view |
| `actions.js` | DM send/page, content search, canon load, read cursors, claims, staging, broadcast |
| `[discordUserId]/page.js` | Thread load + the open Move's id |
| `[discordUserId]/PersonShell.js` | The person view's wrapper (conversation only) |
| `[discordUserId]/ConversationPane.js` | Thread + composer, optimistic send |
| `InspectorHost.js` | The shared inspector's player-desk half: derived selection, pins, the Canon prelude |
| `components/InspectorColumn.js` | The shared inspector itself (ADJUDICATION.md §3) |
| `CanonTab.js` | The "This turn" section — current Move, staged messages/effects, stage-a-DM box — rendered as the Moves tab's `tabPreludes` entry, refetched per mount |
| `dmDraft.js` | The composer draft's `localStorage` key, shared with Canon |
| `BulkComposer.js` / `BulkMessageButton.js` | The broadcast modal and its header door |
| `components/usePins.js` | Pins, shared with `/gm/turns` |
| `components/useSubmitOnEnter.js` | Enter-to-send, IME- and touch-guarded |
| `components/CommandPalette.js` + `paletteActions.js` | ⌘K |
