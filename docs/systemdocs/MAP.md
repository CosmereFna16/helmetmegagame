# Geography, travel, and the Map panel

Where characters are, how they move, and the two front-ends over one rule set.
For the *Discord* side of a Zone — channel layout, provisioning, who can see
what — see `CHANNELS.md`. This page is the game side.

## 1. The model

There is one level now: the **`Zone`**. A Zone is a place a character can
stand, and `Character.zoneId` is the whole answer to "where are you".
`Location` as a standable place is gone — what used to be a Location is a
**Location topic**, a generated forum post inside its zone's public forum
(`CHANNELS.md` §4). You can read a topic, roleplay in it, and walk into the
zone that holds it, but you cannot travel *to* one.

`docs/zones.yaml` is the sole master (`SYNC.md` for the sync's destructive
semantics). Zones come in three kinds:

| `kind` | Zones | Standable? | Discord |
|---|---|---|---|
| `SURFACE` | Town, Fortress, Windlands | yes | own category: `#summary`, `#public`, `#private` |
| `CAVE_GROUP` | Caves | **no** | the shared "Caves" category only |
| `CAVE_LEVEL` | Caverns, Railroad, Aberrant Pits | yes | one forum each, under the Caves category |

So **presence is six zones** — three surface plus three cave levels — while the
GM seats stay at four, because the whole cave system belongs to the Caves seat.
That split is `Zone.seatZoneId` and it matters every time a row is stamped;
`GAMEMASTERS.md` §2 is the contract.

The Caves group row is a container, not a place. `performTravel` refuses it
("That isn't a place you can stand"), it may never appear in `zoneConnections`,
and it has no `Zone: {Name}` role.

New characters get their starting zone from their role (`starting_zone` in
`docs/roles.yaml` → `Role.startingZoneId`), and `createCharacter` grants the
zone role immediately (`CHARACTERS.md` §3).

## 2. The adjacency graph

`zoneConnections` in `docs/zones.yaml` is a flat list of pairs, synced into the
`Zone.connectsTo` self-relation **both directions explicitly**, so only
`connectsTo` is ever read. The graph today:

```
town — fortress        fortress — railroad
town — windlands       windlands — railroad
town — caverns         caverns  — railroad
                       railroad — aberrant-pits
```

`performTravel` refuses anything not in the graph with "You can't get there
directly from here." A presence zone that appears in no pair is unreachable;
the sync **warns** about that rather than throwing, because a one-way starting
zone is legal in principle — but it is almost always a typo.

## 3. What a move costs

**Every hop costs the character's Move.** There is no free walk any more; free
same-zone travel went with the per-Location channels, and `isTravelFree` /
`DEPTHS_SLUGS` are gone with it. The hop is written as a real, auto-resolved
`Action` (`type: MOVE`, `status: CONFIRMED`, `moveReviewStatus: SOLVED`, no GM
step, tagged `gmNotes: "auto:zone_change"`), so it lands in `/gm/turns`' Moves
history rather than the pending queue. Its `zoneId` is the **seat** zone of the
destination (`seatZoneIdFor`) — a hop onto the Railroad files work the Caves GM
can see.

**One free arrival: a first placement.** A character with no zone yet can go
anywhere on the map, spends nothing, and files no Action — it isn't travel, it's
arrival. The adjacency gate is skipped entirely in that case.

**Acting and travelling are mutually exclusive within a turn, in either order.**
The Move modal checks for an existing `Action` on the open turn, and
`performTravel` makes the same check in reverse. The enforcement is not that
check, though — it's the `@@unique([characterId, turnId])` on `Action`.
`performTravel` writes the Action **before** it moves the character, inside one
transaction, so two simultaneous submissions (the `#turns` Travel button and the
web map, or two map clicks) end with one `P2002` that rolls the second move back.
Filing after moving is how a player once ended up two hops away having spent one
Move.

Travel cost is also what a **tax run** costs. Moving ⬢ into or out of a
faction's Silo requires standing in its zone, and handing ⬢ or an item to a
person requires the same zone — so a payment across zones is a journey somebody
physically makes. See `FACTIONS.md` §3b.

The Lifeweb is the same rule with a fixed address: bleeding or feeding someone
to the Web needs the Mortus **and** the target standing in the Fortress, because
that is where the tower is (`REQUESTS.md` §5a).

## 4. Two front-ends, one `performTravel`

`db/lib/travel.js#performTravel` owns validation, the Action and the database
writes. It performs **no Discord side effects** — the same split
`advanceTurn()`/`runSideEffects()` uses, and for the same reason: the bot has a
gateway client and the web app only has REST. It returns `oldZone` so each
caller can run its own twin.

| Surface | Entry | Runs afterwards |
|---|---|---|
| Discord | Travel button on the `#turns` console (custom id `loc:open`, kept from the pre-zone console message) or `/location` → ephemeral zone select (`zone:place`) → Confirm (`zone:confirm:{zoneId}`) | `swapZoneRole`, `syncCharacterNarrowcastAccess`, `applyPendingInvites` (gateway + REST, `bot/src/lib/zoneTravel.js#performMove`) |
| Web | `/map` (`web/app/(app)/map/travelActions.js#travelTo`) | `syncCharacterZoneRole`, `syncCharacterNarrowcastAccess`, `applyPendingInvites` (REST, in `after()`) |

The picker offers the current zone's direct neighbours — or, for an unplaced
character, every presence zone. `applyPendingInvites` is on both paths because
a `/add` invite for a private thread lands the moment its guest arrives
(`COMMANDS.md`).

## 5. The Map panel

`/map` is the drawn Ravenheart plate (`/assets/Map_Basic.png`) with one
**clickable polygon per presence zone** over it. The pointcrawl — rhombus nodes,
roads, the Bare/Plate ground toggle and its remembered choice — is gone: a zone
region only means anything drawn over the art it was traced from, so there is
no second ground to switch to.

**The polygons are data, not code.** `map.polygon` in `docs/zones.yaml` is a
list of `[x, y]` pairs as percentages (0–100) of the 4:3 plate, origin top-left,
plus `map.label: {x, y}` for where the name is drawn. They sync into
`Zone.mapPolygon` (Json), `mapLabelX` and `mapLabelY`. Retuning the map is a
YAML edit and a re-sync. The SVG is one fixed `1000 × 750` viewBox, so a
coordinate is a multiplication. `readPolygon` in `page.js` drops anything that
isn't at least three pairs of numbers, rather than throwing NaN points into the
SVG. The Caves group carries an empty polygon and only a label point — it names
its part of the plate without being clickable.

Two things carry the panel:

- **Tiers are resolved server-side** in `page.js`, against the same graph and
  the same already-acted check the server action will apply on submit — so the
  map can never offer a hop `performTravel` would refuse. Four tiers: `here`,
  `cost` (the only clickable one), `spent` (a legal hop the character can't
  afford because they already acted this turn, greyed out **up front** rather
  than failing after the confirm), and `noroad`. There is no `free` tier any
  more; an unplaced character's whole map reads as `cost` with its own note
  ("Your first arrival — it costs you nothing").
- **The destination list beneath the plate is the accessible path.** The
  polygons are `aria-hidden`; the list carries the same zones as real buttons,
  and is the keyboard and screen-reader route as well as the usable surface at
  390px.

Travel is optimistic: the "you are here" region moves on confirm and reverts on
its own if the action errors. Confirmation goes through the shared
`useConfirm()` dialog.

The plate's colours are `--map-*` tokens in `globals.css` that deliberately
**do not** flip with the theme — the regions ride on a painting, so a light
theme would put black labels on a night picture.

There is no `map:check`. The old geometry checker existed to catch crossing
roads and overlapping nodes in a pointcrawl; polygons traced onto the art have
neither problem, so `db/prisma/check-map.js` and the script went with it.

## 6. Where the code lives

| File | Role |
|---|---|
| `db/lib/travel.js` | `performTravel` — validation, the Action, DB writes, no Discord |
| `db/lib/seatZone.js` | `seatZoneIdFor` — the presence-zone → seat-zone mapping |
| `bot/src/lib/zoneTravel.js` | The picker rows, `performMove`, `swapZoneRole`, `syncCharacterNarrowcastAccess` (gateway twins) |
| `web/lib/discordGuild.js` | `syncCharacterZoneRole`, `syncCharacterNarrowcastAccess` (REST twins) |
| `db/lib/threadInvites.js` | `applyPendingInvites` — replays standing `/add` invites on arrival |
| `web/app/(app)/map/` | The panel, `page.js` tiers, `travelActions.js#travelTo` |
| `docs/zones.yaml` | The master: zones, topics, `map:` polygons, `zoneConnections` |
