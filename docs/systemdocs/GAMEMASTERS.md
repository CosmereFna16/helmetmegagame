# Gamemasters and the zone code

How five GMs share one game: a master and four zone-GMs, one per zone, plus the
colour vocabulary that tells them at a glance whose row is whose.

---

## 1. The shape of it

Lifeweb runs with **one master** — the superadmin (`web/lib/superadmin.js`) —
and zone-GMs seated over the four **seat** zones: **Fortress, Town, Windlands,
Caves**. (Characters stand in six *presence* zones, because the Caves seat
covers three cave levels — §2a.)

**A GM may hold more than one seat.** With five GMs and four zones somebody
covers two, so `GmAssignment` is one row per seat rather than one row per GM.
Holding none is the master's state, and reads as All.

Zone-GMs also play, so the point is to keep each of them oriented toward their
own zone without cutting them off from the rest of the game.

**The seat is a soft default and hides nothing.** It picks which zone a GM's
tables *open* on. No Prisma query is scoped by it, no row is withheld, and one
click on Mine/All or the Zone select clears it. A hard gate was considered and
rejected for two reasons: an Opposed Move crosses zones by nature, and a GM who
cannot reach a row mid-turn is a worse failure than one who scrolled past a
zone they did not need.

This makes `GmAssignment` the only gate in the app that is *soft*. Every row in
CLAUDE.md's Discord permission model table is enforcement; this one is
ergonomics. Do not "harden" it without re-reading the paragraph above.

---

## 2. Which zone a row belongs to

### 2a. Presence zones vs seat zones

Since the zone rework, **presence is six zones and the seats are still four.**
Characters stand in Town, Fortress, Windlands, Caverns, Railroad or Aberrant
Pits; the GM seats are Town, Fortress, Windlands and **Caves**, with the whole
cave system belonging to the Caves seat.

That mapping is denormalized onto **`Zone.seatZoneId`** by `db:sync-zones`
(`parentZoneId ?? id`), and `db/lib/seatZone.js#seatZoneIdFor` is the single
reader every writer goes through. **Never stamp a seat-scoped row with
`zone.id`.** Every `Action`, `Note`, `DefaultEffort` and `StagedMessage`
`zoneId` is the *seat* zone — a character acting on the Railroad who filed
against the Railroad row would file work no Caves GM can see.

The seat pickers list `kind != "CAVE_LEVEL"` (`/gm/turns`, `/gm/gamemasters`),
which is the same four rows from the other direction. The channel doctor checks
the invariant from a third: no stamped `zoneId` may point at a `CAVE_LEVEL`
row, and it counts the offenders if any exist (`CHANNELS.md` §6).

### 2b. Seat by faction, not by feet

**The zone a character's *faction* is keyed to — `Faction.zoneId` — never where
they happen to be standing.** A Windlander in Town is a Windlands row. That
distinction is the whole feature and the one real bug it invites.

Two zone fields exist on a character and they mean different things:

| Field | Meaning | Used by |
|---|---|---|
| `Character.faction.zoneId` | The zone seat. Which GM this person is *for*. | Every Zone column and filter; the seat default |
| `Character.zoneId` | Where they are physically standing — a presence zone, possibly a cave level | Travel, the map, `/gm/players`' **Standing in** column |

Every GM page flattens the first onto its rows as a plain string,
**`factionZoneName`** (`""` when the character has no faction at all), because
these all cross a server→client boundary.

All 13 factions in `docs/roles.yaml` are nested under a zone — `unaligned`
included, which sits in Caves. So the neutral chip only ever appears for a
character with **no faction row at all**, or for a DM from someone who never
made a character.

---

## 3. The colour code

Four colours, colour-picked from the game's own Plate map
(`web/public/assets/Map_Basic.png`, a 34-colour pixel plate) so the code is the
map's palette rather than an invented one:

| Zone | Where it comes from | Hex |
|---|---|---|
| Fortress | the castle's red roofs | `#9c4132` terracotta ruby |
| Town | the timber cluster's thatch | `#998d6b` brown linen |
| Windlands | the olive scrub, bottom-centre | `#7f8c64` desaturated lime |
| Caves | mountain rock | `#939d9e` stone grey |

They are `--zone-fortress` / `--zone-town` / `--zone-windlands` /
`--zone-caves`, declared **inside each `[data-theme]` block** in `globals.css`
(not on `:root`) so `audit-contrast.js` picks them up with no parser change.

Three of the twelve values deviate from the map, and the comments in
`globals.css` say why: Fortress's terracotta measures **2.00** on dusk's
surface and **2.12** on dawn's, so it is lifted in lightness with hue and
saturation held; Caves' stone grey measures **2.66** on limestone, so it
darkens there. The other nine ship the map hex untouched. Do not "fix" the
three back.

**These are fills only — the rule down the side of a chip, never a text
colour.** They are gated at **3.0** against `--surface` (the large-graphic
floor), not AA 4.5; none of them would ever clear 4.5, and gating them there
would only force them off the palette. Spending one as `color:` ships a 2.x
contrast.

`Zone` **does** have a slug now (`db:sync-zones` matches on it), but the colour
code does not read it: `web/lib/zones.js#zoneKey()` still slugifies the *name*
and checks it against the known four-key set, because the chip covers seats,
not presence zones, and the set is closed and known at build time. A renamed or
fifth zone returns `null` and renders the neutral chip rather than throwing. A
cave level's name never reaches a chip — its rows are stamped with the Caves
seat (§2a).

`ZoneChip.js` puts the colour on a `data-zone` attribute reading a token, not
an inline style. `ChipLabel.js` is the tempting precedent but it goes inline
only because a `TagGroup` colour is a freeform hex out of the DB with no token
to name; the zone set is closed and known at build time, which is also the only
reason `audit-contrast.js` can see it.

---

## 4. Where the chip and filter appear

| Surface | Column | Filter | Opens on your zone |
|---|---|---|---|
| `/gm/turns` Moves | ✓ | ✓ | ✓ |
| `/gm/turns` Requests | ✓ | ✓ | ✓ |
| `/gm/players` | ✓ | ✓ | ✓ |
| `/gm/dev/factions` | ✓ | — | — |
| `/faction` (player-facing) | ✓ | — | — |

Two surfaces need a note.

**`/gm/players` already owned the key `zone`**, and it meant the *physical*
zone. It now means the seat, matching every other surface; the physical one is
still there, renamed to **Standing in** rather than dropped, because it answers
a real and different question.

**The player desk has no character FK** — `DirectMessage` keys on
`discordUserId`. The zone comes through a character lookup over the
conversation's user IDs, resolved in the *same* loop as the display name under
one ALIVE-wins rule. Splitting them into two loops is how a dead character's
faction ends up deciding a live player's zone.

`/gm/dev/factions` shows the chip read-only: a faction's zone is owned by
`docs/roles.yaml` and written by `db:sync-roles`, so editing it there would be
overwritten on the next sync.

---

## 5. Mine / All, and the unclaimed count

`ZoneScopeToggle.js` is a `.segmented` control that writes `filters.zone`. It
**holds no state of its own** — it and the Zone `<select>` in `FilterBar` are
two faces of one value, and a second `useState` would let them disagree the
moment someone used the select. It renders nothing when the viewer has no seat.

`filters.zone` stays a **single zone name**, because that is what
`useTableState`'s `filterDefs` match on. So the control shows *one button per
seat* rather than a combined Mine: a GM with one seat sees the old `Mine / All`
pair, and a GM with two sees `[Town] [Caves] [All]`. That is also the honest
control — with two seats there is no one zone that is "mine".

The opening default follows the same logic, in `openingZoneName()`
(`web/lib/zones.js`): one seat opens narrowed to it, **two or more open on
All**. Picking one arbitrarily would hide the other seat's rows behind a filter
the GM never set.

The default itself is `useTableState`'s `initialFilters`, which seeds filter
state once at mount exactly as `initialSort` already does. It must **not**
re-apply on prop change: a GM who clicked All would be dragged back to their
own zone on every `revalidatePath`, i.e. after every adjudication.

`/gm/turns` also carries a count of what is still waiting in your zone. A Move
under a live lock reads as *In Progress* and drops out on its own, which is
correct — it is being dealt with. A Request has no lock, so `reviewedAt` is the
only signal there is; `RequestStatus` has no "unreviewed" value.

**The count is over the loaded 500, not a true total** — right while the game is
live, wrong after a long backlog. If that ever matters, replace it with
`prisma.action.count` / `request.count` filtered on `character.faction.zoneId`.

---

## 6. Assigning a seat

`/gm/gamemasters`, superadmin only. Lists everyone holding the GM role with
their Discord avatar, their character (linked through `CharacterLink`), and a
segmented multi-toggle for their seats. **"All" is the cleared state**, named
for what the GM's tables then show rather than for the empty set.

`GmAssignment` is keyed on `discordUserId`, not hung off `Character`, because
**a GM may never roll one** — and should not lose their seat when theirs dies.
The primary key is the **pair** `(discordUserId, zoneId)`: one row per seat, so
a GM can hold several. The near-miss alternative was a nullable
`Zone.gmDiscordUserId`: one column, no new table. It was rejected because a
zone can then hold only one GM, and assignment becomes
clear-everywhere-then-set — a two-statement write whose partial failure leaves
a seat orphaned. The join table makes the *set* of seats the unit of the write,
replaced wholesale in one `$transaction`. Absence of any row **is** "no seat".

The FK is `onDelete: Cascade`. It used to be `SetNull`, on the argument that
`db:sync-zones` is destructive and *will* delete a Zone row that has left
`docs/zones.yaml` — a cascade would take the GM's seat with it silently. With
`zoneId` now required that option is gone, and the loss is smaller than it was:
what cascades away is a seat for a zone that no longer exists, where `SetNull`
would have left a row meaning nothing.

`assignGmZones` re-validates everything the picker already applied — a server
action is a public endpoint. It re-checks that the **target** holds the GM role
(without that the endpoint would happily seat any Discord ID a caller
invented), and that every zone is a **seat** zone: a `CAVE_LEVEL` seat is one
no stamped row can ever match, so it is refused rather than stored.

This is also the only page in the app that renders a **Discord** identity
rather than an in-game one, and so the only user of `DiscordAvatar.js` — the
app's one remote image. It is a plain `<img>`, because `next.config.mjs`
declares no `images.remotePatterns` and `next/image` against
`cdn.discordapp.com` would throw at render.

---

## 7. The audit log is everyone's

`/gm/audit` used to be superadmin-only, on the argument that with five GMs the
log stops being a shared work surface and becomes a record **of** them. That
was true and beside the point: it left four of the five people who run the game
unable to answer "who changed this, and why", which is the only question the
log exists for. Peer visibility is now the feature. **Every GM reads the whole
log**, and the Actor filter's `GMs` toggle makes reviewing each other a
first-class view rather than something you squint for.

Dev (`/gm/dev`) and Gamemasters (`/gm/gamemasters`) stay superadmin — those are
host access, not game permission.

The page is a **desk** (`web/app/(desk)/gm/audit/`), not a table: filter rail,
feed, inspector, the same frame as `/gm/turns`. Three things about it are worth
knowing before changing it.

**It filters server-side, alone among the app's lists.** `DataTable.js`'s whole
model is "ship the rows, filter in the browser", and `AuditLog` is the app's
biggest table and append-only — it can never be shipped whole. So the filter
state lives in the URL and the WHERE is built in Postgres
(`web/lib/auditQuery.js#buildAuditWhere`). That also makes any view a link, and
a filtered log a GM can paste at another GM.

**Selection does not re-fetch.** The page already shipped every row on screen,
so picking one is a lookup plus a `history.replaceState` — the same trick
`/gm/turns`'s `Workspace` uses. Only a permalink naming a row *outside* the
current page costs a query.

**`actionType` is a free string, so the renderer must never require knowing
it.** `web/lib/auditNarrative.js` maps ~90 known types to sentences, and
anything else falls back to the prettified string plus a family derived from
its prefix. Adding an action type at a call site is a one-line change in some
server action, and nobody is going to remember this file — so an unregistered
type has to render, not blank and not throw. Same for `details`: every accessor
in there survives a null, a missing key, and a payload shape from two reworks
ago.

`AuditLog` carries no `turnId` and no `zoneId`. Both are **derived** — the turn
by bucketing `createdAt` against `Turn.startedAt`, the zone through the target
character's faction. Stamping them would only cover rows written from that day
onward, and the log's value is its history.

Adjudicator identity moved the other way, from private to visible. Both
`Action` and `Request` have carried `reviewedByDiscordUserId`/`reviewedAt` all
along; the Request pair was written by `resolveRequestImpl` and **never shown
anywhere**. Both now appear as a column in the table, not just in the panel,
because with four people scanning one queue asynchronously "has someone already
picked this up" is a question the table has to answer. Moves say *Solved by*
and Requests say *Reviewed by* — Review is the Request verb everywhere in that
UI, and Solved is Move vocabulary bound to a `MoveReviewStatus` value.

---

## 8. Where the code lives

| Path | What |
|---|---|
| `web/lib/zones.js` | `zoneKey()`, `ZONE_KEYS`, `sortZones()`, `openingZoneName()` |
| `web/lib/gmZone.js` | `getMyZones()` (cached), `listGmAssignments()` |
| `web/app/components/ZoneChip.js` | The chip |
| `web/app/components/ZoneScopeToggle.js` | Mine / All |
| `web/app/components/DiscordAvatar.js` | The one remote image |
| `web/app/(app)/gm/gamemasters/` | Page, picker, `assignGmZones` |
| `web/app/(desk)/gm/audit/` | The audit desk — filters, feed, inspector, export |
| `web/lib/auditNarrative.js` | actionType + details → a sentence |
| `web/lib/auditQuery.js` | The audit filter parser and WHERE builder |
| `db/prisma/schema.prisma` | `GmAssignment` |
| `web/app/globals.css` | `--zone-*` per theme, `.zone-chip` |
| `web/scripts/audit-contrast.js` | The 3.0 gate |
