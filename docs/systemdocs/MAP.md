# Geography and travel

Where characters are and how they move. For the *Discord* side — channel
layout, provisioning, who can see what — see `CHANNELS.md`. This page is the
game side.

## 1. The model

There are two levels now. A **`Zone`** (Town, Fortress, Windlands, Caves) is
a region — a category, and for a `SURFACE` zone a `#summary` channel. A
**`Location`** is where a character actually **stands**: one text channel
under its zone's category, opened by its own `Location: {Name}` role.
`Character.locationId` is the authoritative "where is this character"
answer; `Character.zoneId` is a **denormalized mirror** of
`location.zoneId` — every writer of `locationId` writes both, and the
channel doctor's `character-place` check flags a mismatch (`CHANNELS.md`
§6).

`docs/zones.yaml` is the sole master (`SYNC.md` for the sync's destructive
semantics, including the format). Zones still come in three kinds:

| `kind` | Zones | Standable itself? | Discord |
|---|---|---|---|
| `SURFACE` | Town, Fortress, Windlands | no — its Locations are | category + `#summary`; each Location its own channel |
| `CAVE_GROUP` | Caves | no | the shared "Caves" category only |
| `CAVE_LEVEL` | Caverns, Railroad, Aberrant Pits | no — its Locations are | no channels of its own; its Locations parent onto the Caves category |

A zone itself is never a place you can stand in any more — only a Location
is. Every presence zone (`SURFACE` or `CAVE_LEVEL`) must list at least one
Location in `docs/zones.yaml`, or the sync throws. `Zone.seatZoneId` still
decides which GM table a row belongs to (`GAMEMASTERS.md` §2); it hasn't
moved, since a Location doesn't need its own seat.

New characters get their starting place from their role: `starting_zone` (and
an optional `starting_location`) in `docs/roles.yaml` resolve to
`Role.startingZoneId` / `Role.startingLocationId`, and `createCharacter`
grants the zone role and the Location role immediately (`CHARACTERS.md` §3).
If a role names no `starting_location`, it's the first Location (by `sort`)
of its `starting_zone`.

## 2. The adjacency graph

`connections:` in `docs/zones.yaml` is a flat list of `zone/location` pairs,
synced into `Location.connectsTo` **both directions explicitly**, so only
`connectsTo` is ever read — the graph is over Locations now, not zones, and
it can span zones freely (Town's Forest connects straight to the Fortress's
Gatehouse).

`performLocationMove` refuses a hop not in the graph with "You can't get
there directly from here," and refuses standing still with "You're already
there." A presence zone with no Location reachable from anywhere is legal in
principle (a one-way starting spot) but almost always a typo — not checked
by the sync today, unlike the old zone-level warning.

## 3. What a move costs

**`db/lib/locationTravel.js#performLocationMove(prisma, character,
targetLocation, { dragged })`** is the one function both faces call for the
database half of a move. It does **no Discord work** — same split
`advanceTurn()`/`runSideEffects()` uses, and for the same reason: the bot has
a gateway client and the web app only has REST.

**A first placement is free.** A character with no `locationId` yet can land
anywhere, spends nothing, and files no Action — it isn't travel, it's
arrival. The adjacency gate is skipped entirely.

**A hop inside the same zone is free, on a cooldown.**
`GameConfig.locationMoveCooldownSeconds` (default 60, edited on `/gm/dev`)
gates it, enforced by a **conditional `updateMany`** whose `WHERE` clause
*is* the check (`lastLocationMoveAt` null or old enough) — the same shape the
hunger decrement and the mount's daily claim use, so two clicks in one tick
can't both pass. A refusal reports the exact seconds left.

**An Overburdened character can't cross into another zone at all.** Over a
carry cap (`CARRY.md` §2), `performLocationMove` refuses the crossing with a
plain `{ ok: false, reason }` before it opens its transaction; hops inside the
zone stay free so they can walk to a room and stash. Only the mover is gated.

**A hop whose edge crosses into another zone costs the character's Move,
exactly like the old zone-level travel did.** It's written as a real,
auto-resolved `Action` (`type: MOVE`, `status: CONFIRMED`,
`moveReviewStatus: SOLVED`, `gmNotes: "auto:zone_change"`), landing in
`/gm/turns`' Moves history rather than the pending queue. Its `zoneId` is the
**seat** zone of the destination (`seatZoneIdFor`) — a hop onto the Railroad
files work the Caves GM can see. **Acting and crossing are mutually
exclusive within a turn, in either order** — the enforcement is
`@@unique([characterId, turnId])` on `Action`, checked inside the same
transaction that writes it.

**The one exception is a mount.** `horse`, `wild-horse` and
`steam-automobile` (`db/lib/mounts.js#FAST_TRAVEL_SLUGS`, the shared source
for the tag list and `fastTravelCapacity`) buy a second
zone crossing the same day: if an `Action` already exists this turn and the
mover holds a mount tag, the second crossing claims
`Character.fastTravelTurnId` instead of filing another Action — a claim
token holding the in-game **day** (`db/lib/turnFormat.js#turnDay(openTurn)`,
not a turn id, since a day is two turns), written by the same
conditional-`updateMany` pattern. The **`FAST_TRAVEL` Request is retired** —
there's no separate route through `requestActions.js` any more; a mount is
just a second pass through `performLocationMove` on the same turn.

**Travel always offers dragging.** Anyone in the mover's **zone** (not just
their Location) who is a corpse, holds an incapacitating tag (bound / dying
/ paralyzed / catatonic — `INCAPACITATING_SLUGS`), or is in the mover's
faction if the mover leads it, can be brought along — the same
`MOVE_CHARACTER` authority as before, now re-checked **server-side inside
the move's own transaction** (`canDrag`) rather than trusted from a picker.
A candidate who wandered off between the picker and the confirm fails the
whole move rather than being silently dropped. Dragged characters get no
Action, no cooldown claim and no mount claim of their own — one
`updateMany` moves them all — and the move writes one `characters_dragged`
`AuditLog` row naming the mover, the destination and everyone brought.
`lastLocationMoveAt` is set for the dragged too, so a character who's just
been walked somewhere doesn't get an extra free hop the instant they can act
again.

**The Caving Die rolls on arrival** for the mover and every dragged
character, on any `CAVE_LEVEL` destination (`CAVING.md`).

`performLocationMove` returns `{ ok, oldLocation, oldZone, targetLocation,
targetZone, crossedZone, spentTurn, usedHorse, moved: [{ character,
fromLocationId, fromZoneId, toLocationId, toZoneId, zoneChanged, cavingDm },
...] }` (mover first) on success, or `{ ok: false, reason,
retryAfterSeconds? }` on refusal.

## 4. The Discord half

**`db/lib/locationMove.js#applyLocationMoveSideEffects(prisma, entry)`** is
the single function every caller runs after its DB write commits — never
from inside the transaction, the same reasoning `db/lib/dm.js` documents.
Grant-before-revoke throughout: it swaps the Location role, and — only if
the zone changed too — the zone role and the narrowcast reconcile; then
`syncCharacterRoomAccess` for wherever the character now stands and
`applyPendingInvites` for any standing Conversation invite there. Every call
is individually catch-logged; the channel doctor is the safety net for
whatever it misses. See `CHANNELS.md` §3–§4 for the roles and the private
Room membership it drives.

Every caller — the Travel button on `#turns`, `/location`, character
creation, a GM's raw edit or teleport, GM Bulk Move, `MOVE_CHARACTER`, and
the staged "Relocate to" applied at the turn push — runs
`performLocationMove` (or a raw relocation, for the GM/creation paths) then
this function. Any new writer of `Character.locationId` must call both, or a
player either sees the wrong place or none.

## 5. Tax runs and the Lifeweb

Travel cost is also what a **tax run** costs. Handing ⬢ or an item to a
person requires the same zone — so a payment across zones is still a journey
somebody physically makes, checked against `Character.zoneId` exactly as
before. See `FACTIONS.md` §3b.

The Lifeweb is the same rule with a fixed address: bleeding or feeding
someone to the Web needs the Mortus **and** the target standing in the
Fortress zone, because that is where the tower is (`REQUESTS.md` §5a).

## 6. The web `/map` panel is gone

The drawn Ravenheart plate, its pointcrawl overlay and the depth strip
(`web/app/(app)/map/*`) were retired along with per-zone-only travel — a
player-facing graph over dozens of Locations spanning multiple zones needs a
different UI than four rhombus nodes, and nobody's built its replacement
yet. `map: { polygon, label }` in `docs/zones.yaml` is still synced onto
`Zone.mapPolygon`/`mapLabelX`/`mapLabelY` — **dormant data**, read by
nothing — left in place for the panel's eventual return.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/locationTravel.js` | `performLocationMove` — validation, the cooldown or the Move, dragging, the Caving roll; no Discord |
| `db/lib/locationMove.js` | `applyLocationMoveSideEffects` — the Discord half, shared by every caller |
| `db/lib/roomAccess.js` | `syncCharacterRoomAccess` — private Room membership |
| `db/lib/threadInvites.js` | `applyPendingInvites` — replays standing `/add` invites on arrival |
| `db/lib/seatZone.js` | `seatZoneIdFor` — the presence-zone → seat-zone mapping |
| `db/lib/mounts.js` | `FAST_TRAVEL_SLUGS`, `isMounted`, `fastTravelCapacity` |
| `db/lib/turnFormat.js` | `turnDay` — the in-game day a mount's second crossing is claimed against |
| `docs/zones.yaml` | The master: zones, Locations, Rooms, `connections:`, `map:` node anchors (dormant) |
