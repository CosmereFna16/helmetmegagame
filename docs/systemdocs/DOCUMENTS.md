# Documents

The in-game reference library: rules, briefs, lore sheets and faction papers,
handed to a player because of who they are rather than because they went
looking.

## 1. The master

`docs/documents.yaml`, matched by `key`, synced by
`db/lib/syncDocuments.js#syncDocumentsFromYaml` (`npm run db:sync-documents`).
It runs **last** of the four YAML syncs, because it validates against tags,
roles and factions — see `SYNC.md`.

The sync is **destructive**, in the `syncLocations` sense: a key dropped from
the YAML loses its row. A Document is pure reference content with no player
state to preserve.

## 2. The page

`/documents` (`web/app/(app)/documents/`) is a pinned board of expandable
cards, in two tabs:

- **PUBLIC** — every `public: true` document, readable by any signed-in user,
  character or not. This is deliberate: the site goes up before the game opens
  so players can read the rules, and launch gating covers character *creation*
  only (`CHARACTERS.md`).
- **ASSIGNED** — **not rendered at all** without an `ALIVE` character, rather
  than rendered empty.

Documents with an empty `description` are filtered out. Several are still
stubs, and a slot awaiting prose shouldn't reach a player as a blank page.

## 3. Assignment

Resolves server-side. Each card shows **the reason it's in your folder**, in an
alt colour — it's metadata about the paper, not part of it.

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

## 5. Where the code lives

| Concern | File |
|---|---|
| Master | `docs/documents.yaml` |
| Sync | `db/lib/syncDocuments.js`, `db/prisma/sync-documents.js` |
| Page | `web/app/(app)/documents/` |
| Role document lists | `docs/roles.yaml` (`doc_elements`) |
