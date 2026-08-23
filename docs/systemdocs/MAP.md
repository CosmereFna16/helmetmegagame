# Geography, travel, and the Map panel

Where characters are, how they move, and the two front-ends over one rule set.
For the *Discord* side of a Location — channel layout, provisioning, who can
see what — see `CHANNELS.md`. This page is the game side.

## 1. The model

Two levels: **`Zone`** (e.g. "Town") and **`Location`** (e.g. "cathedral",
nested under a Zone via `Location.zoneId`).

`docs/locations.yaml` is the sole master; see `SYNC.md` for the sync's
destructive semantics. Per entry: `id` (slug), `name`, `zone`, `description`
(the short intro string, rendered into the summary channel's topic),
`extendedDescription` (long-form, rendered into the generated description post —
`CHANNELS.md` §2b), `publicSubLocations` (each a `name` plus its own long-form
`description`), `privateSubLocations`, free-text `tags`, and `map: {x, y}`.

**`Character.locationId` is authoritative.** `Character.zoneId` is a
denormalized mirror of `location.zoneId`, written in the same update, kept only
so the pre-existing zone-stamping on `Action`/`DefaultEffort`/`Note` and the
zone filters across `/gm/players`, `/gm/turns` and `/notes` keep working. Any
new writer of `locationId` must write `zoneId` alongside it.

New characters get their starting Location from their role
(`role.startingLocationId`, set in `createCharacter`), not null — channel
access is synced immediately after creation.

## 2. The adjacency graph

A hop is only legal between Locations that are **connected**.
`locationConnections` in `docs/locations.yaml` is a flat list of pairs, synced
into the `Location.connectsTo` / `connectedFrom` self-relation. `performTravel`
refuses anything not in the graph with "You can't get there directly from here."

This is the part that's easy to forget exists: adding a Location to the YAML
without adding any connection to it makes it unreachable, and nothing warns you
at sync time. `map:check` (§5) is where you'd notice.

## 3. What a move costs

One pure function: `db/lib/travelCost.js#isTravelFree`, matched on Location
**slug** — same posture as `narrowcastAccess.js` and `laborAccess.js`.

- **Same Zone is free.** No `Action` is created.
- **A different Zone spends the turn.** Submitted as a real, auto-resolved
  `Action` (`status: CONFIRMED`, `moveReviewStatus: SOLVED`, no GM step, tagged
  `gmNotes: "auto:zone_change"`), so it lands in `/gm/turns`' Moves history
  rather than the pending queue.

**One hardcoded exception: `DEPTHS_SLUGS`** — `caverns`, `railroad`,
`aberrant-pits`. All three sit in the Caves zone, but moving between any two of
them costs a Move anyway. This is the only place in the game where two
Locations in one Zone aren't a free walk apart, and it's deliberate: going
deeper is supposed to hurt. Entering the Depths *from Customs* is still free —
Customs isn't one of the three, so only level-to-level costs.

Migrants start on the **Railroad**, the line everyone who comes to Ravenheart
from elsewhere arrives on, so "make it to the fortress" is two paid Moves
rather than a figure of speech.

`DEPTHS_SLUGS` is also what `narrowcastAccess.js` reads for the `#radio` dead
zone, so all three levels are dead air.

**Acting and travelling are mutually exclusive within a turn, in either
order.** `bot/src/lib/actionSubmission.js` checks for any existing `Action` on
the open turn before accepting a Move, and `performTravel` makes the same check
in reverse.

## 4. Two front-ends, one `performTravel`

`db/lib/travel.js#performTravel` owns validation, the cost decision and the
database writes. It performs **no Discord side effects** — the same split
`advanceTurn()`/`runSideEffects()` uses, and for the same reason: the bot has a
gateway client and the web app only has REST. It returns `oldLocation` and each
caller runs its own twin.

| Surface | Entry | Runs afterwards |
|---|---|---|
| Discord | The ⚜ button in the guild's single `location` channel → ephemeral Zone → Location select cascade → Confirm (`bot/src/events/interactionCreate.js`, prompt maintained by `bot/src/lib/location.js#ensureLocationPrompt`) | `swapLocationAccess`, `syncCharacterNarrowcastAccess` (gateway) |
| Web | `/map` (`web/app/(app)/map/travelActions.js#travelTo`) | `syncCharacterLocationAccess`, `syncCharacterNarrowcastAccess` (REST) |

The `location` channel is read-only for `@everyone` and carries one tracked
message. It's a button rather than a reaction because Discord modals can't
contain dropdowns and reactions can't open ephemeral UI.

## 5. The Map panel

`/map` is a **pointcrawl**: rhombus nodes with the location name on a stem
above them, over one of three grounds — **Forest** (the default photographic
plate), **Plate** (the drawn `Map_Basic.png`), and **Bare**.

The Plate carries **no pointcrawl at all** — nodes, labels and roads are hidden
over it, because a rhombus grid on top of a hand-drawn map fights the drawing.
The ground choice persists in `localStorage`, read through
`useSyncExternalStore` rather than an effect (`react-hooks/set-state-in-effect`
is an error in this repo; the server snapshot is simply `null`).

**Node positions are data, not code.** `map: {x, y}` in the YAML — 0–100
percentages of the 4:3 plate — synced into `Location.mapX`/`mapY` on every run.
Retuning the layout is a YAML edit and a re-sync.

**`npm run map:check`** (`db/prisma/check-map.js`) is the fast loop: pure
geometry over the YAML, no DB and no Discord, reporting crossing roads, nodes
drawn on top of each other, and roads grazing a location they don't connect to.
A road touching a Depths level is drawn **dashed**, as a tunnel, and its
crossings are reported separately rather than as failures — the Gatehouse stair
down to the Caverns has to pass beneath the town band, and no arrangement of
nodes avoids that.

Two things carry the panel:

- **Tiers are resolved server-side** in `page.js`, by asking the same
  `isTravelFree` the server action will ask on submit — so the map can never
  colour a hop green and then charge for it. Five tiers: `here`, `free`
  (green), `cost` (amber, confirms that the Move is spent), `noroad`, and
  `spent` — a costing hop the character can't afford because they already acted
  this turn, greyed out **up front** rather than failing after the confirm.
- **The destination list beneath the plate is always rendered**, not a
  mobile-only branch. It's the usable surface at 390px, the keyboard and
  screen-reader path on any screen, and the only way to travel while the Plate
  ground is up.

Confirmation goes through the shared `useConfirm()` dialog.

The plate's colours are `--map-*` tokens in `globals.css` that deliberately
**do not** flip with the theme — the pointcrawl rides on a photograph, so a
light theme would put black labels on a night picture.

## 6. Where the code lives

| File | Role |
|---|---|
| `db/lib/travel.js` | `performTravel` — validation, cost, DB writes, no Discord |
| `db/lib/travelCost.js` | `isTravelFree`, `DEPTHS_SLUGS` |
| `bot/src/lib/location.js` | The ⚜ prompt, `performMove`, `swapLocationAccess` |
| `web/app/(app)/map/` | The panel, `travelActions.js#travelTo` |
| `db/prisma/check-map.js` | `map:check` geometry |
| `docs/locations.yaml` | The master, including `map:` coords and `locationConnections` |
