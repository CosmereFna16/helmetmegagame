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
┌ header: Players · turn chip · N tracked · N unread ─────────────────┐
│ RAIL            │  ROSTER TABLE (nobody selected)                   │
│ Inbox | Roster  │  ─────────────── or ──────────────────────────────│
│ search, filters │  CONVERSATION            │  DOSSIER               │
│ zone scope      │  thread + composer       │  Canon · Sheet · Tags  │
│                 │                          │  Record · Notes        │
└─────────────────┴──────────────────────────┴────────────────────────┘
```

Fleet view, then person view. With nobody selected the pane is the roster
across its full width; picking someone splits it.

Routes are keyed on **`discordUserId`, not `characterId`**: that is what
`DirectMessage` keys on (no character FK, by design), every character has one,
and it keeps working for a conversation whose character is gone.
`/gm/messages` and `/gm/messages/:id` redirect here (307 — an internal tool
with no SEO to protect and a real chance of another reshuffle).

## 3. The rail

Two lenses, the way the adjudication rail has Moves/Requests:

- **Inbox** — only players with a conversation, sorted pinned → unread →
  recency, showing the last message with a `You:` / `GM:` / `Bot:` prefix.
- **Roster** — everyone with a character, alphabetically. Dead characters stay
  listed so their history is reachable.

Search is `scoreMatch` (`web/lib/fuzzySearch.js` — keep that the one
implementation) over name, role, faction, Discord username, zone and message
preview. Zone/status filters and `ZoneScopeToggle` seed from the GM's zone seat
the same way every other GM table does.

**Pins are shared with the adjudication desk** (`usePins.js`). This is a merge,
not a rename: the two desks kept separate keys in separate identity spaces —
`desk-pins` held `{ characterId }` objects, `messages-pins` held bare
`discordUserId` strings — so an entry now carries both ids and the old keys
migrate once on first read. Identity is `characterId` when there is one,
`discordUserId` otherwise.

## 4. The roster

Everything the old table had, plus the columns a GM actually asks about
mid-turn: **Acted this turn** and **tag count**. Selection is a `Set` of
character ids, so it survives paging, filtering and sorting. Select-all covers
the **filtered page**, not the whole roster — a header checkbox that quietly
picks up a hundred people you cannot see is how a broadcast goes to the wrong
room.

Two bulk verbs, both GM-safe:

| Verb | Action | Lives in |
|---|---|---|
| Message selected | `sendGmBroadcast` | this desk's `actions.js` (sequential, never a fan-out) |
| Tag / untag selected | `bulkTagCharacters` | `(app)/gm/actions.js` (one transaction **per character**) |

**Bulk zone moves are deliberately absent.** `bulkMoveCharacters` requires
superadmin, so a button for it here would fail for most of the people looking
at it. It stays on `/gm/dev`.

The faction hierarchy is a view of this table rather than a separate tab, and
`/gm/players?tab=factions` still selects it — `/faction` sends a GM here.

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
- **Claim/release** is advisory (`ConversationMeta`), so five GMs don't answer
  the same player twice.
- Mark-read fires from a client effect, never during RSC render — otherwise
  Next's link prefetch marks a conversation read on hover.

## 6. The dossier

`Canon · Sheet · Tags · Record · Notes`, fetched on demand and memoized per
`${characterId}:${tab}` for the life of the page view. The adjudication desk's
inspector is the same idea pointed the other way — there the character is
context for a Move, here the Move is context for a character — so it reuses
that desk's `getCharacterInspector` / `getArchiveSlice`. No DMs tab: the thread
is the pane next door.

**Canon** is the player's open Move, staged messages and staged effects, with
"Insert into reply" buttons that write into the composer's draft.

**Notes** is new, and is the thing that was actually missing: what a GM knows
about a player that lives nowhere else. See §7.

## 7. GM notes

`GmCharacterNote` — **not** to be confused with `Note`, which is a *player's*
own list of messages they starred with a reaction in a location channel
(`/notes`, keyed to the reacting user). That page is unchanged and is still on
every user's rail.

Append-only, attributed, delete-your-own. Not one shared editable field:
five GMs editing a single textarea race each other, and the loser's paragraph
vanishes with no trace of who ate it. Delete-your-own is enforced server-side
— a GM tidying away another's read on a player is how a shared record stops
being worth trusting.

It is a real relation with `onDelete: Cascade`, unlike the log tables
(`DirectMessage`, `AuditLog`) that store snapshot columns on purpose. A note is
live data *about* a character rather than a record of something that happened,
and it means nothing once the character is gone.

## 8. Getting between the desks

- **⌘K** (`CommandPalette.js`) — a player, an open Move or Request, a zone, a
  faction, or any page including the ones with no rail item at all
  (`/gm/gamemasters`, `/gm/dev/tags`, `/gm/dev/factions`, `/gm/audit`). Built
  on `Modal` so it inherits the focus trap and the topmost-Escape stack; its
  `.modal-overlay` also stands the adjudication desk's Escape and 45s refresh
  down, the way every other dialog does. The index is fetched on first open and
  held for a minute.
- A **Move or Request** links to that player's conversation; the
  conversation's **Canon** tab links back to that Move already selected.
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
| `PlayerRail.js` | Inbox/Roster lenses, search, filters, pins |
| `page.js` / `RosterTable.js` | The fleet view + bulk verbs |
| `FactionsPanel.js` | The faction hierarchy view |
| `actions.js` | DM send/page, read cursors, claims, staging, broadcast, GM notes |
| `[discordUserId]/page.js` | Thread + Canon load |
| `[discordUserId]/PersonShell.js` | Splits the pane, wires dossier→composer prefill |
| `[discordUserId]/ConversationPane.js` | Thread + composer |
| `[discordUserId]/DossierColumn.js` | The five tabs |
| `[discordUserId]/CanonPanel.js` | Current Move + staged items |
| `[discordUserId]/NotesTab.js` | GM notes |
| `components/usePins.js` | Pins, shared with `/gm/turns` |
| `components/useSubmitOnEnter.js` | Enter-to-send, IME- and touch-guarded |
| `components/CommandPalette.js` + `paletteActions.js` | ⌘K |
