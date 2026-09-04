# Threats

The antagonist seats: what they are, how a GM hands one out, and what happens
when somebody accepts one. The catalog is `db/lib/threats.js`; the GM surface
is `/gm/dev?s=assignments` and `/gm/dev?s=antagonists`.

Companion to `CHARACTERS.md` (the creation wizard's Antagonists step, which
writes the consent this reads) and `DEV-PANEL.md` §11 (the panel these two
sections live in).

## 1. What a threat is

One entry in `db/lib/threats.js`. Three optional pieces decide what an entry
can do, and which ones it carries is the whole taxonomy:

| Piece | What it means |
|---|---|
| `optIn: true` | A checkbox on the creation wizard. Consent data, nothing else. |
| `assign: {…}` | A real seat a GM can hand to an existing character. |
| `spawn: {…}` | The same seat, handed to somebody with no character at all. |

`assignable: true` is the flag both buttons read; every assignable seat is also
spawnable, because anything worth giving to a character is worth giving to a
new one.

**Most opt-ins are decoys.** Nine of the eleven checkboxes carry `optIn` and
nothing else. That is the point: ticking one tells a GM about consent without
telling the player which seats are real. Two ship real — **Demoness** and
**Judge** — and Thanati Leader, Thanatos, Tribunal Leader and Tribunal land
later against the same shape. The two that are not opt-ins at all (Tribunal and
Tribunal Leader, when they arrive) are simply assignable without a checkbox.

An entry with neither `optIn` nor `assign` is a **brief**: prose a GM runs
entirely by hand, no checkbox and no button. Sympathizer, Monsters, Brigand and
Brigand Leader are these. They are what is left of `docs/threats.md`, which was
deleted when the catalog took over — a second prose copy of a blurb is a second
thing to drift.

### Why a code module and not a table

Same reasoning as `db/lib/roleIds.js`: fixed values that can never differ per
environment, so a row would only add a join and a way to drift. It also means a
blurb edit ships with a deploy rather than a sync.

### Renaming a slug needs no migration

`normalizeAntagonistSlugs` and `antagonistNames` both **drop unknown slugs
silently**, so a `Character.antagonistOptIns` still holding a retired slug
renders as nothing rather than leaking a stale name. That is what let
`succubus` become `demoness` and `special-circumstances` become
`tribunal-operations` with no data work at all.

## 2. Who holds a seat is derived, not stored

There is no "current threat" column. A character **is** the Demoness because
they hold the `demoness` tag — `seatTagSlug` on the catalog entry is the link,
and `threatBySeatTag()` walks it back.

This is deliberate. A column would be a second copy of the truth, and it would
be wrong the moment a GM granted the tag by hand from
`/gm/dev/characters/[characterId]` — which is exactly how seats were handed out
before any of this existed. `CharacterTag.acquiredAt` supplies the "Since"
column for free.

## 3. Assign

`assignThreat({ characterId, threatSlug })` in
`web/app/(app)/gm/dev/threatActions.js`. Superadmin-gated, and it re-checks
`assignable` itself — a server action is a public endpoint and the dropdown is
a hint, not a lock.

One transaction: the seat's tags, then the points. Tags are **upserted**, not
created, because a GM may have granted the seat tag by hand already and a
duplicate would violate `CharacterTag`'s `(characterId, tagId)` unique. Then one
`threat_assigned` audit row.

The DM goes out **post-commit**, in `after()`, so a Discord outage can never
cost the grant:

```
You are now the {name}!
{blurb, one line each}
Check your tags and documents.
```

`sendDm` applies the `»` prefix, splits past 2000 characters and logs to
`DirectMessage`, so the whole thing shows up on `/gm/messages` too.

**Any threat, opted in or not.** Consent is a GM's judgement call; the opt-in
column exists to inform it, not to gate it.

Assign needs a living character. For anybody else the row offers Spawn instead.

## 4. Spawn

Two phases, because the offer crosses from web to Discord and back.

**Phase 1 — the GM offers.** `offerThreatSpawn` writes a `ThreatSpawn` row and
DMs the target the blurb plus Accept / Decline. The buttons are raw component
JSON built by `spawnOfferComponents()` in `db/lib/threatSpawn.js` — the web
sends them and only the bot has discord.js, so the shape lives where both can
reach it, same as the Bird's Reply button.

If the DM fails (closed DMs, a departed member) the row is **rolled back to
`CANCELLED`**. A live offer with no buttons behind it is worse than no offer.

`ThreatSpawn_pending_unique` is a **partial** unique index
(`WHERE status = 'PENDING'`), so one player can never hold two live offers.
Prisma's schema language cannot express a partial unique, so it exists only in
the migration SQL — `prisma migrate diff` will propose dropping it and the
answer is no, exactly as with `FactionApplication_pending_unique`.

**Phase 2 — the player accepts.** The click lands in the **bot**: a DM has no
guild, and the clicker has no character yet, which is the whole point.
`bot/src/lib/threatSpawn.js` only routes; the work is
`acceptThreatSpawn()` in `db/lib/threatSpawn.js`.

The acknowledgement is `interaction.update()` — the buttons come off the message
and the outcome is written under it, so a dead button cannot be clicked twice
and the DM reads as a record afterwards. Same posture as `bot/src/lib/offers.js`.

Its transaction mirrors `createCharacter`'s, which until this landed was the
only code that had ever written a `Character` row:

- `SELECT id FROM "Role" … FOR UPDATE`, then re-count seats against
  `roleCapacity()` with `seatHolderStatuses()`. Prisma runs READ COMMITTED, so
  the row lock is what actually stops two people taking one seat.
- The `ThreatSpawn` row is **re-read under that lock**. Two fast clicks on the
  same button race here, and the status check before the transaction is only an
  early out.
- `character.create` with the rolled name, the seat's gender, the chosen
  location **and its `zoneId` in the same statement** — the denormalization
  contract.
- Tags: the seat's grant, its spawn kit, and whatever the role grants anyone,
  resolved in one pass so a missing slug is a clean refusal rather than a
  half-granted character.

Everything Discord-side runs **after** the answer is written, best-effort, via
`applySpawnSideEffects()`: the personal role (a mentionable name token held by
nobody — access rides the zone role and the Location overwrite), placement
through `applyLocationMoveSideEffects`, and the Cursed role dropped. The
nickname sync stays on the bot, because `buildNickname` is duplicated per face
on purpose and a third copy in `db/lib` would be a third thing to keep in step.

### The spawn kit

`spawn` names a gender, a `roleSlug` (null means the GM picks), `resources`,
`tagPoints` and `tagSlugs`. Tag entries are **slugs** with an optional count —
`"obol x4"` — parsed by `parseStartingTag`. A role's own `startingTagSlugs` are
display **names** despite the column's name, so the two are looked up
separately and merged.

Names are rolled from a per-gender list in `db/lib/threats.js`. **No `‡` in
any of them**: a name is written to `Character.name`, the Discord nickname and
the personal role title, all worn as identity rather than read as prose.

## 5. The two GM sections

Both live on `/gm/dev` under the **Threats** nav group, superadmin-only like
everything else on that panel. Each fetches only its own data.

### `?s=assignments`

Every **approved player in the guild**, in the game or not —
`listGuildMembers()` filtered on `PLAYER_ROLE_ID`, left-joined to characters by
`discordUserId`. A player with no character is a real row, not a gap: they are
exactly who a spawn is aimed at.

Opt-ins render as chips with their own dropdown. That one filter sits **outside**
`useTableState`, because a `filterDefs` entry compares by string equality and a
player holding three opt-ins would stringify to `"Archon,Judge,Warlock"` and
match none of them. It pre-filters the rows instead and rides in `FilterBar`'s
children.

### `?s=antagonists`

Who holds a seat now, derived per §2, plus the offers nobody has answered yet
with a Cancel button. An unanswered offer's only other trace is a DM in
somebody else's client.

## 6. Where the code lives

| File | What |
|---|---|
| `db/lib/threats.js` | The catalog, the name rolls, the button customId prefixes |
| `db/lib/threatSpawn.js` | Accept/decline, tag resolution, the Discord side effects |
| `web/lib/threats.js` | Client-safe re-export shim (the wizard is a client component) |
| `web/app/(app)/gm/dev/threatActions.js` | `assignThreat`, `offerThreatSpawn`, `cancelThreatSpawn` |
| `web/app/(app)/gm/dev/threats/ThreatAssignmentsTable.js` | The players table |
| `web/app/(app)/gm/dev/threats/ThreatRosterTable.js` | The seats table + pending offers |
| `web/app/(desk)/gm/dev/page.js` | Both sections' data loading and render |
| `bot/src/lib/threatSpawn.js` | The Accept / Decline click |

## 7. Adding a threat

1. Add the entry to `db/lib/threats.js`, alphabetized by `name`.
2. If it is a real seat, add its `seatTagSlug` tag to `docs/tags.yaml` (0-cost,
   `purchasable: false`, like `demoness` and `judge`) and run
   `npm run db:sync-tags`.
3. That is all. Both tables, both buttons and the wizard read the catalog.

Blurbs are Bascinet's words and carry **no `‡`** — the exemption in CLAUDE.md
for dictated text. Anything you write around them does.
