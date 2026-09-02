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

**The one exception is a horse.** The `horse` and `wild-horse` ("Wild
Horse") tags buy a single free hop a day — one zone, no `Action` filed, and
therefore no Move spent and no block from having already acted. It is a
**Request** (`FAST_TRAVEL`), not a route through `performTravel`:
`performTravel` always files the Move, and a Request has to write its effect
and its `Request` row in the same transaction, so `fastTravelRequestImpl`
(`web/app/(app)/character/requestActions.js`) re-derives the same adjacency
rules instead of calling it. Everything else about the hop matches an ordinary
one — the zone-role swap, the narrowcast sync, the standing thread invites and
the Caving Die's on-arrival roll all run after the commit, exactly as
`travelTo` runs them. The once-a-day limit is `Character.fastTravelTurnId`, a
claim token written by a conditional `updateMany` whose `WHERE` is the check —
the same lesson as the `Action` unique above, since counting the rider's
Requests afterwards would let two tabs put them two zones away. The field
name is a misnomer worth flagging: it holds the in-game **day** number
(`describeTurn(openTurn).day`), not a turn id — Bascinet runs two turns a
day, and an earlier version keyed the claim on `openTurn.id`, which let a
rider claim a free hop in both Dawn and Dusk of the same day.

**A horse doesn't ride alone.** `web/lib/tagRequests.js#fastTravelCapacity`
reads the rider's own tags for how many people (rider included) the trip can
carry: a horse or Wild Horse alone seats **2**; the `cart` tag upgrades that
pair to **6** (Cart does nothing without a horse — it upgrades one, it isn't
one); the `steam-automobile` tag is inherently a **6**-seat vehicle by itself
and does not need Cart to stack further. Any character standing in the
rider's zone can be picked as a passenger — no Bound/Led/corpse authority
check like `MOVE_CHARACTER`'s, the same "self-attest, a GM can review and
Undo" bet the rest of the Requests system already makes. Passengers move in
the same transaction as the rider (one `updateMany`, since they all share the
same from/to zone) and get the same post-commit Discord fan-out, but they do
**not** claim their own `fastTravelTurnId` — being carried today doesn't stop
them riding under their own power again later the same day.

**"Easily visible" is real:** the departure zone's `#summary` gets a
bot-posted line naming the rider (and passengers) as they leave, and the
`TRAVEL` archive entry is unconditional. See `REQUESTS.md` §5d for both.

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

`/map` is the drawn Ravenheart plate (`/assets/Map_Basic.png`) with a
pointcrawl overlay: **four rhombus nodes** and the routes between them. A node
is filled if you can move there and hollow and grey if you can't; a route is
solid when the hop starts where you stand and dashed when it is a road on the
map but not a road from here. A `Switch` labelled "Show routes" hides the whole
overlay — nodes, lines and labels — leaving the bare painting, and the choice
is remembered in `localStorage` (`lifeweb:map-routes`), read through
`useSyncExternalStore` so nothing sets state in an effect.

**Four nodes, six presence zones.** The three surface zones stand for
themselves; the whole cave system is one node, drawn on the **`CAVE_GROUP`**
row, because a player reads "the Caves" as one place on the drawing. Which
level they actually mean is picked from the **depth strip** under the plate —
a `.segmented` control, Caverns · Railroad · Aberrant Pits, each segment
carrying its own tier and its own click-to-travel. Clicking the Caves node
does not travel; it focuses the strip. Two things fall out of the fold:

- The Caves node wears the **best tier of its three levels** (`here` > `cost` >
  `spent` > `noroad`). From the Town only the Caverns are adjacent and from the
  Fortress or the Windlands only the Railroad, so the node reads as reachable
  either way and the strip says which level that means. Standing on any level
  makes the node `here`.
- A route to the Caves node resolves against the **specific level**
  connections: `town — caverns`, `fortress — railroad`, `windlands — railroad`
  all fold onto one line each, and the links inside the cave system
  (`caverns — railroad`, `railroad — aberrant-pits`) fold away entirely. A pair
  with no underlying link gets no line at all, which is why the Fortress and
  the Windlands are not joined. Because the fold is per level, standing in the
  Caverns lights the Town line and leaves the Fortress and Windlands lines
  dashed.

**The node anchors are data, not code.** `map.label: {x, y}` in
`docs/zones.yaml` is the point a Zone's rhombus is drawn on — percentages
(0–100) of the plate art, origin top-left — synced into `Zone.mapLabelX` and
`mapLabelY`. It used to say where a region's *name* was drawn; reusing it as
the anchor is why the panel needs no new column. Retuning the map is a YAML
edit and a re-sync. `.map-plate` carries the art's own **1078 / 825** aspect
ratio rather than 4:3, so a stored percentage lands where it was measured; the
SVG uses a `0 0 100 100` viewBox with `preserveAspectRatio="none"`, which makes
a coordinate literally that percentage, and `vector-effect="non-scaling-stroke"`
keeps the stretch out of the line weights. `map.polygon` survives in the YAML
and in `Zone.mapPolygon` as **dormant data** — the clickable-region map that
preceded this one; nothing reads it.

Three things carry the panel:

- **Tiers are resolved server-side** in `page.js`, against the same graph and
  the same already-acted check the server action will apply on submit — so the
  map can never offer a hop `performTravel` would refuse. Four tiers: `here`,
  `cost` (the only clickable one), `spent` (a legal hop the character can't
  afford because they already acted this turn, greyed out **up front** rather
  than failing after the confirm), and `noroad`. There is no `free` tier any
  more; an unplaced character's whole map reads as `cost` with its own note
  ("Your first arrival — it costs you nothing").
- **The destination list beneath the plate is the accessible path.** The
  overlay is `aria-hidden` and every control in it is `tabIndex={-1}`; the list
  carries the same zones as real buttons — the three cave levels enumerated
  individually, not folded — and is the keyboard and screen-reader route as
  well as the usable surface at 390px. The depth strip is the reachable twin of
  the Caves node, so the folded node costs nothing in reach.
- **The header is the zone's own `description`**, straight from
  `docs/zones.yaml`, set as body text under the zone name. It replaced a "N
  ways out" count that said less than the list directly below it already did.
  An unplaced character gets the "hasn't been placed" line instead. Beside
  "Where you can go" sits an `InfoIcon` whose text is the GM's plain-language
  summary of the cave routes; it is deliberately looser than
  `zoneConnections` — leave the wording alone.

Travel is optimistic: the "you are here" mark moves on confirm and reverts on
its own if the action errors. The routes still describe the old position until
the refresh lands, which is a second. Confirmation goes through the shared
`useConfirm()` dialog.

The plate's colours are `--map-*` tokens in `globals.css` that deliberately
**do not** flip with the theme — the overlay rides on a painting, so a light
theme would put black labels on a night picture.

There is no `map:check`. The old geometry checker existed to catch crossing
roads and overlapping nodes in a pointcrawl of two dozen Locations; four nodes
placed by hand off the art have neither problem, so the checker and its
script stay gone.

## 6. Where the code lives

| File | Role |
|---|---|
| `db/lib/travel.js` | `performTravel` — validation, the Action, DB writes, no Discord |
| `db/lib/seatZone.js` | `seatZoneIdFor` — the presence-zone → seat-zone mapping |
| `bot/src/lib/zoneTravel.js` | The picker rows, `performMove`, `swapZoneRole`, `syncCharacterNarrowcastAccess` (gateway twins) |
| `web/lib/discordGuild.js` | `syncCharacterZoneRole`, `syncCharacterNarrowcastAccess` (REST twins) |
| `db/lib/threadInvites.js` | `applyPendingInvites` — replays standing `/add` invites on arrival |
| `web/app/(app)/map/` | The panel — `page.js` tiers/nodes/edges, `MapPanel.js` overlay + depth strip, `travelActions.js#travelTo` |
| `docs/zones.yaml` | The master: zones, topics, `map:` node anchors (and dormant polygons), `zoneConnections` |
