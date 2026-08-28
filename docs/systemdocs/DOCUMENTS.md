# Documents

The in-game reference library: rules, briefs, lore sheets and faction papers,
handed to a player because of who they are rather than because they went
looking.

## 1. The master

`docs/documents.yaml`, matched by `key`, synced by
`db/lib/syncDocuments.js#syncDocumentsFromYaml` (`npm run db:sync-documents`).
It runs **last** of the four YAML syncs, because it validates against tags,
roles and factions — see `SYNC.md`.

The sync is **destructive**, in the `syncZones` sense: a key dropped from
the YAML loses its row. A Document is pure reference content with no player
state to preserve.

## 2. The page

`/documents` (`web/app/(app)/documents/`) is a pinned board of expandable
cards, in four tabs:

- **PUBLIC** — every `public: true` document, readable by any signed-in user,
  character or not. This is deliberate: the site goes up before the game opens
  so players can read the rules, and launch gating covers character *creation*
  only (`CHARACTERS.md`).
- **ASSIGNED** — **not rendered at all** without an `ALIVE` character, rather
  than rendered empty.
- **GAMEMASTER** — `flags: [gamemaster]` papers, and the one source that keys
  off a **Discord role** rather than anything on a Character, since a GM
  usually has no character. The tab only exists when the server actually sent
  GM papers, so its absence is never a hint that something is being withheld.
- **SECRET** — `secret: true` papers (threat briefs), visible **only to master
  GMs** — those who hold the GM role and hold **no zone seat at all**
  (`getMyZones().length === 0`). A GM seated anywhere, in one zone or several,
  never sees this tab. A secret document can
  also be assigned via tags, so a player with the `Cultist` tag still sees the
  cult briefs in their Assigned tab — the two paths are independent.
- **ALL** — every written document in the game, on the same Discord-role gate
  as GAMEMASTER and likewise absent for a player. A GM's overview rather than
  anyone's folder, so its source line answers a different question from the
  other tabs': not *why is this in your folder* but *how does this paper reach
  a player at all* — `Public`, `Gamemaster`, `Assigned`, or **`Unrouted`** for
  a written paper nothing hands out. Spotting those is the point; answering it
  honestly costs one extra query for `Role.docElements`, run only for a GM.
  Secret papers are the one exception to *every* document: they stay gated to
  master GMs here exactly as in SECRET, so a zone-GM's ALL never leaks a threat
  brief they cannot open.

Opening a card is a `Modal` (`DESIGN-SYSTEM.md` §8) over `.doc-sheet` — wider
and more generously set than an ordinary dialog, because it is a page of prose.

**Every open sheet lives at `?doc=<key>`**, and it is derived from that param
on every render rather than seeded once into `useState`. Clicking a card
`router.push`es the param; a `{document:…}` chip is a plain `<Link>` to the
same URL, so clicking one while a different sheet is already open re-derives
`open` from the new param and swaps the sheet in place — no remount needed,
and no dead click where the URL changed but the sheet didn't. Closing
`router.replace`s the param away, so Back from an open sheet lands on the
board rather than stepping back through sheets, and a refresh always lands on
the board. The open sheet also carries a `⧉ Copy link` button, Prev/Next
(and `←`/`→`/`j`/`k`) stepping through whichever tab the open document came
from under the board's current search and sort, and — once a document has
three or more headings — a generated table of contents alongside the prose,
built by `web/lib/documentHeadings.js` off the same heading text
`DocumentMarkdown.js` slugs into `id`s, so the two never disagree about where
`#some-heading` points.

The board above the sheet carries a search box (name, source and body,
case-insensitive) and a Default/A–Z/Source sort — all client-side, since
`DocumentsPage` already sent every document the reader may see.

### Your role, pinned

The first card in ASSIGNED is the reader's own **role charter** — `Role.name`
over `Role.description`, which is a `String[]` of plain sentences in
`docs/roles.yaml`, joined into a Markdown bullet list. It is accent-framed and
marked `⌗ YOUR ROLE` so it reads as being about the reader rather than about
the world.

It is **synthesized in the page, not a `Document` row**, so `{document:…}` can
never resolve to it and the sync never sees it. Skipped entirely for a
character with no role or an empty description.

Worth knowing if you edit `docs/roles.yaml`: that field was written and synced
for all 49 roles and **rendered nowhere** until this existed. The nearest a
player got was the one-line `role.intro` in the creation wizard.

Documents with an empty `description` are filtered out. Several are still
stubs, and a slot awaiting prose shouldn't reach a player as a blank page.

### The Handbook, pinned

The first card in PUBLIC (before any real `public: true` document) is the
**Player Handbook** — `docs/handbook.md`, read at request time by
`web/lib/handbook.js#getHandbookBody` (its leading `# Bascinet Player
Handbook` H1 stripped, since both surfaces that render it already carry the
title in their own chrome) and synthesized into the same pinned-card shape as
the role charter above, key `"handbook"`. Public rather than Assigned: it's
the tab a character-less visitor lands on, and it's exactly what that visitor
wants. Skipped entirely if `docs/handbook.md` can't be read.

Like `"role"`, `"handbook"` is a reserved key in
`db/lib/syncDocuments.js#RESERVED_KEYS` — a real document taking it would
collide with the synthesized card and make `?doc=handbook` ambiguous.

The same file also backs a second, standalone surface: **`/handbook`**
(`web/app/(public)/handbook/`), a public page that needs no sign-in — the
`(public)` route group is the one place in the app that renders for an
anonymous visitor, specifically so `ravenheart.quest/handbook` works as a bare
link handed to someone who hasn't joined the game yet. Its nav rail tab (`?`
icon, next to Documents in both `PLAYER_NAV` and `GM_NAV`) only shows for a
signed-in reader, same as everywhere else in the app.

## 3. Assignment

Resolves server-side, in `web/lib/documentAccess.js`. That module is shared
with `/api/documents` **on purpose**: the API decides whether a
`{document:key}` chip is a working link or an inert one, and two copies of a
visibility rule drift. The failure it prevents is telling a player they can
open a Gamemaster brief.

Each card shows **the reason it's in your folder**, in an alt colour — it's
metadata about the paper, not part of it.

Five things can put a document in front of you:

| Source | Key in the YAML |
|---|---|
| Your role's document list (the primary link) | `doc_elements` in `docs/roles.yaml` → `Role.docElements` |
| A tag you hold | `tags:` |
| Your role slug | `roles:` |
| Your faction slug | `factions:` |
| `leader` / `treasurer` — `Character` booleans, not tags | `flags:` |

Those are **denormalized onto `Document` as string arrays**, not four join
tables: ~30 rows, rebuilt wholesale each sync, read in one query per page view.

## 4. One deliberate softness

In an otherwise strict sync, `documents.yaml`'s `tags:` lists conflate three
different things: real Tag names, the Leader/Treasurer booleans, and free-text
authoring notes like `"any of the medical tags"`.

Each entry is routed to whichever bucket it belongs in, and **anything matching
nothing is reported, not thrown** — a placeholder is a note to a human, and
failing the sync over one would block every other document.

The explicit `roles:` / `factions:` / `flags:` keys are **strict** and throw on
a typo. Only `tags:` is soft.

## 5. Referring to a document

`{document:key}` anywhere tokens render — a document body, a tag description —
becomes a chip that links to the paper it names. The payload is
`Document.key`, the same identifier `doc_elements` uses; documents have no
separate slug. See `TAGS.md` §7 for the token system as a whole.

The chip is access-aware, which is the only interesting part. `/api/documents`
ships every written document's **name**, but its source and excerpt only to a
reader who may open it:

- **Readable** → a hoverable chip showing name, source and an excerpt, linking
  to `?doc=<key>`.
- **Not readable** → the same chip, muted and inert.

Inert rather than plain text so the reference still reads as a reference — you
can see a paper exists and that it is not yours. The name is not a leak: the
token sits in prose the reader is already looking at, and it is what lets the
chip say *which* paper it is.

Inside a tooltip or a card preview the chip is always the flat, inert form —
those render through `ChipText.js`, where a link would be invalid markup
inside the `<button>` a card is.

## 6. Where the code lives

| Concern | File |
|---|---|
| Master | `docs/documents.yaml` |
| Sync | `db/lib/syncDocuments.js`, `db/prisma/sync-documents.js` |
| Page | `web/app/(app)/documents/` |
| Visibility rule (shared) | `web/lib/documentAccess.js` |
| Chip index | `getDocumentIndex()` in `web/lib/referenceData.js` (the standalone `web/app/api/documents/route.js` this table used to point at no longer exists — the logic moved here) |
| Chip | `web/app/components/DocumentChip.js`, `DocumentsProvider.js` |
| Role document lists | `docs/roles.yaml` (`doc_elements`) |
| Handbook source | `docs/handbook.md`, read by `web/lib/handbook.js` |
| Handbook standalone page | `web/app/(public)/handbook/`, `web/app/(public)/layout.js` |
| Sheet heading slugs / ToC | `web/lib/documentHeadings.js` |
