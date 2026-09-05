# Geography and travel

Where characters are and how they move. For the *Discord* side — channel
layout, provisioning, who can see what — see `CHANNELS.md`. This page is the
game side.

## 1. The model

There are two levels now. A **`Zone`** (Town, Fortress, Forest, Black Hills,
Marshes, and the two underground levels Caves and Depths) is a region — a
category, and for a `SURFACE` zone a `#summary` channel. A **`Location`** is
where a character actually **stands**: one text channel under its zone's
category, opened by a **per-member permission overwrite** rather than a role
of its own (`CHANNELS.md` §3 for why).
`Character.locationId` is the authoritative "where is this character"
answer; `Character.zoneId` is a **denormalized mirror** of
`location.zoneId` — every writer of `locationId` writes both, and the
channel doctor's `character-place` check flags a mismatch (`CHANNELS.md`
§6).

`docs/zones.yaml` is the sole master (`SYNC.md` for the sync's destructive
semantics, including the format).

**How a Location is slugged.** A built place takes a bare slug and a bare
name — `keep`, `factory`, `cathedral`, `customs`. Open country takes its zone as
a prefix — `forest-river`, `hills-ravine`, `marshes-village`,
`depths-runnel` — because a ravine and a river are things every zone has one
of, and the slug is also the Discord channel name. The wilderness used to be
numbered instead (`forest-7`, `Depths 3`), with the hand-drawn map's number
buried in the slug and a different one in the display name; the drawing's
number now lives in `map_node:`, which nothing but a person reads. The Black
Hills zone slug is `hills`.

Zones still come in three kinds:

| `kind` | Zones | Standable itself? | Discord |
|---|---|---|---|
| `SURFACE` | Town, Fortress, Forest, Black Hills, Marshes | no — its Locations are | category + `#summary`; each Location its own channel |
| `CAVE_GROUP` | Underground | no | the shared "Underground" category only |
| `CAVE_LEVEL` | Caves, Depths | no — its Locations are | no channels of its own; its Locations parent onto the Underground category |

`Underground` exists only to be that parent. The kinds are kept rather than
promoting Caves and Depths to surface zones because the Caving Die fires on a
`CAVE_LEVEL` arrival and a `CAVE_LEVEL` needs a `CAVE_GROUP` above it; sharing
one parent also means Caves and Depths share one GM seat, which is what the old
Caves seat already did across three levels. The consequence to know about is
that neither has a `#summary` of its own, so **a gate underground would have
nowhere to announce** — none is drawn there today.

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

### 1a. What a Location is worth

A Location also carries up to three `LocationYield` rows — one per `LaborKind`
(HUNTING / FARMING / FISHING) — authored as a `yield:` block in
`docs/zones.yaml` and drifted every turn. **No row means that labor is
impossible there**, which is why no Location needs a "wilderness" or "water"
boolean anywhere in the schema: the row is the gate. See `LABORING.md`.

### 1b. What else a Location is

Beyond its name and description, a Location carries a sparse map of
**attributes** — `Location.attributes`, a JSON object authored as an
`attributes:` block in `docs/zones.yaml`:

```yaml
customs:
  name: Customs
  attributes:
    depot: true
```

Every key must exist in the registry in `db/lib/locationAttributes.js`, which
is the only module that reads the column. An unknown key is reported as a sync
**problem** rather than dropped, because a typo would otherwise be a place that
quietly never says what it is.

The registry maps each key to the sentence the **Examine** button prints
(`LABORING.md` §9). Systems that own a place should ask `hasAttribute(location,
"depot")` rather than comparing slugs — that is the point of the layer.

Two things are deliberately *not* attributes. `indoors` stays a real column,
because carts and mounts act on it (`db/lib/indoors.js`, `db/lib/mounts.js`)
and a JSON field is not something to query on; Examine merely prints it
alongside the attributes as though it were one. And gate state is never
authored — it is read live off the `LocationLink` rows, since a GM can flip an
edge at any time.

JSON rather than a column per fact because these are sparse, additive prose
triggers. The moment something needs a `where` clause, it wants a column.

## 2. The adjacency graph

`connections:` in `docs/zones.yaml` is the master. Each entry becomes **one
`LocationLink` row** — one row per undirected edge, not a mirrored pair, with
`aId`/`bId` held in ascending Location slug order. That is what makes an
attribute impossible to disagree between the two directions, and a modular gate
impossible to leave open one way and shut the other. The graph is over
Locations, not zones, and spans zones freely.

**Nothing decides passability outside `db/lib/locationGraph.js`.** A few places
read `LocationLink` rows for other reasons — the doctor validates the slugs an
edge names, and the bot's gate and keyed handlers read one row to check
*authority* — but no second implementation of "may this character cross"
exists, and none should. `db/lib/locationGraph.js` is the one
module that knows an edge could have your location on either side:

| Function | Use |
|---|---|
| `linksFor(prisma, locationId)` | every edge touching a location |
| `linkBetween(prisma, a, b)` | the one edge between two locations, either way round |
| `crossingCheck(link, { tagSlugs })` | the pure verdict: `{ listed, passable, refusal }` |
| `canToggleGate(link, { tagSlugs, roleSlug })` | may this character work a modular gate |
| `resolveNeighbors(prisma, character, locationId)` | every destination, gated and sorted |
| `travelOptions(…)` | the same, filtered to what may be *shown* |

`performLocationMove` refuses a hop with no edge — or one the character may not
use — with the verdict `crossingCheck` returns, and refuses standing still with
"You're already there." An unreachable Location is a sync **warning**, not an
error.

### 2a. Typed edges

An edge is not just "you may walk this." Six behaviours, and they **compose** —
the Gatehouse-to-Road edge is a manned gate *and* a modular one at once, which
is why `LocationLink` carries fields rather than one enum.

| Behaviour | Column | Effect |
|---|---|---|
| Open | — | the default |
| Gate | `announce: TRUE_NAME` | posts the crosser's **real name** into the destination zone's `#summary`. `/conceal` does not help: there is a Cerberus here reading papers |
| Unmanned gate | `announce: CONCEALED` | posts only what a passer-by would have seen — "An old woman has entered the Gate" |
| Locked | `requiredTagSlug` | crossing needs the tag, and the way is **listed**, so a player sees the door and learns what opens it |
| Hidden | `requiredTagSlug` + `hidden` | needs the tag **and** is absent from every travel list. Refuses in the same words a nonexistent edge does, deliberately — a different refusal would tell a player the way is there |
| Modular | `modular`, `isOpen`, `openerRoleSlugs`, `openerTagSlugs` | an Open/Close button on **both** endpoints' anchors; impassable while shut |
| Keyed | `keyed`, `openUntil` | on crossing, DMs the key-holder "Leave open for the next 24 hours?" — yes and the way ignores its tag and becomes listed until the window lapses |
| On foot | `onFoot` | too tight, steep or enclosed for a horse or a cart. A **mounted** character is refused at the threshold |

Two things about the gating that are easy to get wrong:

- **`listed` is weaker than `passable`.** A locked edge is listed and refuses.
  A hidden one is neither. Any surface that renders a list must filter on
  `listed`; the mover checks `passable`. `travelOptions` does the first for you.
- **The refusal is re-derived server-side, every time.** A picker that dropped
  an option is a hint; `performLocationMove` and the web's `MOVE_CHARACTER`
  both run `crossingCheck` again on their own, because a server action is a
  public endpoint and a client can post any location id it likes.
- **A propped-open keyed way satisfies its own tag requirement**, which also
  makes a hidden one listed. That is not a leak, it is the whole feature: a
  door somebody held open has to be visible to the people meant to follow them
  through it.
- **A modular edge marked `structural` answers differently while shut,
  depending on whether anything holds it.** With no `COMPLETE`/`DAMAGED`
  structure claiming it (`Structure.linkId`, `HOLDS_EDGE`), a shut structural
  edge is listed and refuses with "Nothing spans the way here — it would have
  to be built. ‡" — the discovery hook, telling a player the crossing exists
  but has to be raised, not merely opened. Once something holds it, a shut
  structural edge answers exactly like an ordinary modular one: "The way is
  shut. ‡" A **`locked:`** structural edge still answers as locked first,
  ahead of the structural branch — a key-gated crossing that also happens to
  be structural stays a locked door, not an unbuilt one, deliberately.

A gate's **announcement is posted from the Discord half**
(`applyLocationMoveSideEffects`), derived from the edge rather than passed in,
so every writer of `Character.locationId` gets it for free and a GM's teleport
onto a non-adjacent Location announces nothing. It is a plain bot message, not
`postAsCharacter` — a webhook post under the traveller's own name and face
would defeat the whole point of the unmanned form.

### 2b. Keyed ways

A **keyed** way asks the person who just used their key whether to hold it open
behind them. `shouldPromptKeyed` gates that: only a key-holder is asked, because
propping a door is the key-holder's decision and not a courtesy anyone walking
through inherits, and only while the way is shut, so a stream of traffic through
an open one does not re-ask every single person.

The ask is a **DM**, never anything in a channel — a keyed way is usually
secret, and asking in the open would tell the room it exists. The crossing
itself only poses the question; `openUntil` is stamped by the button handler,
so a player who never answers leaves the door shut, which is the safe default.

Nothing closes it again. `isHeldOpen` compares `openUntil` against the clock,
so the window lapses on its own with no pass, no cron and no row to clean up.
`resolveNeighbors` takes one clock reading for a whole list, so a way cannot
lapse halfway down it and render as both open and shut at once.

`db:sync-zones` never rewrites `openUntil`, for the same reason it never
rewrites `isOpen`: both are play state, not authoring.

### 2c. On-foot ways

`onFoot` is the edge-level sibling of `Location.indoors`: same effect, earlier
moment. Both keep a horse and a cart out of somewhere they do not fit, but
`indoors` **parks** the mount on arrival (`db/lib/indoors.js#parkMountsIndoors`)
whereas `onFoot` **refuses the crossing**.

That difference is the whole reason it exists. An equipped mount buys one extra
free zone-crossing per turn (`freeZoneMoves`, `db/lib/locationTravel.js`), so a
rider who is only dismounted on arrival has already spent it — which made every
secret passage into the Fortress rideable. Refusing at the threshold is the only
thing that closes that.

It is also the one gate that reads what a character has **equipped** rather than
what they hold: `isMounted(equippedSlugs(tags))`, so a horse stowed in a pack is
not a horse you are riding. `resolveNeighbors` therefore loads tags in
equip-shape rather than through `heldTagSlugs`, which returns bare slugs and
would have counted a stowed horse. The refusal is listed rather than hidden,
because unequipping the horse is a fix the traveller can apply on the spot.

The **modular button** is `loc:gate:{linkId}` on the Location anchor
(`db/lib/locationAnchorRow.js#locationGateRow`). Authority is re-checked in the
handler against the edge's opener Roles and tags; the flip is a conditional
`updateMany` carrying the state the clicker saw, so two watchmen clicking at
once means one close and one "somebody just did." Both endpoints' anchors are
reposted, because the gate has a button on each side. **A re-sync never reopens
a gate somebody shut in play** — `modular.open` in the YAML is the value a link
is *born* with, not one the sync re-asserts.

A **structural** edge (`modular.structural` in the YAML, `LocationLink.structural`)
renders no Open/Close button at all until something built holds it:
`gateOperable` (`db/lib/locationGraph.js`) requires a `COMPLETE` or `DAMAGED`
structure claiming the edge **and** at least one authored opener (a Role or a
tag) before it counts as a working mechanism — an unheld ford is open water
with nothing to click, and a held one with no openers is a fixture, not a
gate. Once both hold, the button appears on **both** endpoints exactly like
any other modular edge. Examine's own gate line (`LABORING.md` §9) reads the
same verdict: an unheld shut structural edge prints "Nothing spans the way to
X — it would have to be built. ‡" rather than the ordinary "The way to X is
closed. ‡".

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

**A hop whose edge crosses into another zone spends a FREE ZONE MOVE first,
and only costs the character's Move once those run out.** Everyone gets
`GameConfig.freeZoneMovesPerTurn` a turn (default 1), an **equipped** mount
adds one, and being Overburdened takes them all away — the full rule lives in
[`CARRY.md`](CARRY.md) §2a. So a peasant walks Town → Forest for nothing,
spends their Move to reach the Fortress, and the way home waits for next turn.

Spending the Move is written as a real, auto-resolved `Action`
(`type: MOVE`, `status: CONFIRMED`, `moveReviewStatus: SOLVED`,
`gmNotes: "auto:zone_change"`), landing in `/gm/turns`' Moves history rather
than the pending queue. Its `zoneId` is the **seat** zone of the destination
(`seatZoneIdFor`) — a hop into the Depths files work the Caves GM can see.
A free move files no Action at all. **Acting and crossing on your Move are
mutually exclusive within a turn, in either order** — the enforcement is
`@@unique([characterId, turnId])` on `Action`.

**Mounts.** `horse` and `steam-automobile`
(`db/lib/mounts.js#FAST_TRAVEL_SLUGS`) each add one free crossing, **and it refreshes every
turn** rather than once a day — a horse carries you at Dawn and again at Dusk.
They only count while **equipped**, and they are unequipped for you at the door
of any indoors Location (`CARRY.md` §3).

The allowance is tracked on `Character.zoneMovesTurnId` / `zoneMovesUsed`,
claimed by a conditional `updateMany` whose WHERE is the check, so two tabs
cannot both spend the last one. The **`FAST_TRAVEL` Request is retired** —
there's no separate route through `requestActions.js`; a mount is just a
larger allowance.

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
yet. The dormant `map: { polygon, label }` block is gone from
`docs/zones.yaml` as well: it described the retired plate's four rhombi, and
the geography it described no longer exists. The
`Zone.mapPolygon`/`mapLabelX`/`mapLabelY` columns remain, now always null.

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
| `db/lib/locationGraph.js` | `LocationLink` reads and the gating verdict — the only module that touches the edge model |
| `db/lib/locationAttributes.js` | The attribute registry, its sync-time validation, and the prose Examine prints |
| `docs/zones.yaml` | The master: zones, Locations, Rooms, and `connections:` with its edge types |
