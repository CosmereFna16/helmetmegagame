# The Caves: the Caving Die and its loot

The Depths' one piece of automatic mechanics. Companion to `MAP.md` (zones
and travel), `TURN-ENGINE.md` (where this hooks into a turn advance),
`REQUESTS.md` (the apply-first-review-after pattern a loot find reuses),
`ADJUDICATION.md` (the `/gm/turns` desk this adds a third lens to) and
`TAGS.md` (the catalog fields `sellable`/`sellablePrice`/
`consumesIntoResources`/`consumesIntoOneOf` live in).

## 1. The two levels

`docs/zones.yaml`'s `underground` entry is a `kind: group` row — a GM seat and
a Discord category, never a place a character can stand — whose `levels:` list
is flattened by the sync into two real, standable `CAVE_LEVEL` zones: **Caves**
and **Depths** (`caves` / `depths`). Each is its own zone with its own
Locations, joined by ordinary zone-crossing edges in `docs/zones.yaml`'s
`connections:` — so they need no special cost rule. Going from the surface to
the Caves to the Depths costs a separate turn each, mount or no.

The kinds are kept, rather than promoting both to surface zones, because the
Die fires on a `CAVE_LEVEL` arrival and a `CAVE_LEVEL` needs a `CAVE_GROUP`
above it. Sharing `underground` as that parent also means the two share one GM
seat, which is what the old Caves seat already did across three levels.

The Bascinet 2 map replaced the old three levels — Caverns, Railroad and
Aberrant Pits, with their Customs, Station and Chrome City — with this pair.
Caves keeps Customs and gains the **Depot** as a Location of its own; the
Station and Chrome City are retired, their prose kept in a comment at the
bottom of `docs/zones.yaml`.

The public **Caving** document (`docs/documents.yaml`, key `caving`) is the
player-facing brief — what the levels are, what to bring, and that the die
exists. `Role.docElements` grants it to `migrant` and `mercenary`, and it's
public so anyone else can find it too.

**The Caving *skill* is a different thing entirely.** `caving` (5 points) opens
the four hidden crawls between the caves and the surface (`MAP.md` §2a). It has
no effect on the Die, and the Die does not care whether you have it — one is a
key, the other is what the dark does to you regardless.

## 2. The Caving Die

**Walking is what wakes the dark.** The Die rolls when a character *arrives* on
a Location in a `CAVE_LEVEL` zone, and at no other moment — a flat `1d6`, no
Gambit modifier, rolled by `db/lib/cavingPass.js#rollCaving(prisma, character,
turn, location, trigger)` and written to a `CavingRoll` row. Going deeper rolls.
Retreating rolls. Standing still does nothing at all.

There used to be a second trigger — `runCavingPass`, a turn-start sweep over
every `ALIVE` character already underground — and it is **gone**. It punished
the one thing a cave ought to reward, which is not moving: a party camped in a
dead end paid the same 1-in-6 as a party pushing into new tunnels, so there was
never a reason to stop. The arrival roll was a *bonus* on top of it; now it is
the whole rule. `CavingTrigger.TURN_START` stays in the Postgres enum rather
than being dropped, the same posture every other retired enum value in this
codebase gets — nothing writes it any more.

**`rollCavingOnArrival(prisma, character, location)`** owns the whole gate.
Four ways it quietly returns `null`, and one of them is new:

- the Location's zone is not a `CAVE_LEVEL`;
- the Location is **safe** — `hasAttribute(location, "safe")`, see below;
- there is no `OPEN` turn (mid-restart);
- anything at all threw.

It sends nothing itself; the DM comes back for the caller's own side-effect
half, the same split `performLocationMove` already uses for the zone-role swap.
Three callers:

- `db/lib/locationTravel.js#performLocationMove` — player travel, including a
  first placement and a mount's second crossing, which is just a second pass
  through the same function. Rolls for the mover and every dragged character;
  the DM(s) ride back on `moved[].cavingDm`.
- The Dev Panel's zone edit and **Bulk Move** — the raw GM relocations. They
  roll too, on purpose: being *dropped* into the Depths by a GM used to be the
  one free walk in, which is exactly how the die first looked broken. Both send
  the DM plainly rather than through `notifyCharacter()`, since the die is the
  game speaking, not the GM.
- The staged **"Relocate to"** on `/gm/turns` still does not call it —
  `rollCaving` opens its own transaction and `applyOneStagedEffect` is already
  inside one. With the turn-start pass gone, that character is now caught by
  their *next* move rather than by the next turn. A GM who wants the roll can
  use the Dev Panel instead.

### 2a. Customs is safe

`Location.attributes.safe` (`db/lib/locationAttributes.js`) exempts a Location
from the Die, and **Customs is the only place that wears it**. It is a cave
mouth with a sentry, a floodlight, a campfire and a shop in it; nothing stalks a
place that busy. It is also where every migrant lands, and rolling a 1 on
somebody's first step into the game was the worst first impression the map had.

It is an attribute rather than a slug comparison in `cavingPass.js` for the
reason `MAP.md` §1b gives: a system that owns a place should ask what is true
about the place. Examine prints it on the spot — "**Safe**: nothing down here
stalks this place." — so a player choosing where to camp can read the answer
instead of inferring it from a week of quiet rolls.

### 2b. One roll per Location per turn

`CavingRoll.@@unique([characterId, turnId, trigger, locationId])` is the cap.
Walk from one cave into the next and each of them rolls; walk *back* into
somewhere you already saw today and it is silent. `rollCaving` swallows that
repeat's `P2002` as "already rolled" — never a second roll, never an error
surfaced to the player.

That is the anti-pacing rule, and it is what makes the Die a cost of
*exploration* rather than a slot machine you feed by walking in and out of a
doorway. The 60-second intra-zone move cooldown is a second brake on top of it.

`CavingRoll.locationId` is nullable only because the rows written before this
change have none; every new row sets it.

### What each face means

| Die | Kind | What happens |
|---|---|---|
| 1 | `TROUBLE` | Nothing auto-applies. The row lands **unresolved** on the Caving lens for a GM to adjudicate — monsters are a GM call, briefed by the GM-only `cavingmonsters` document (`documents.yaml`). The player gets one short DM immediately: *"Caving Die: 1 — Something is wrong down here. A GM has been notified."* |
| 2–5 | `QUIET` | Stamped resolved at creation. No GM attention — the row exists as a record (so the lens' default filter, and a GM skimming the log, both read the truth). The player still gets one line: *"Caving Die: 3 — Nothing happens."* |
| 6 | `FIND` | Draws a loot tier and a tag (below), grants it, and DMs the player what they found. Also resolved at creation — the grant already landed. |

Every DM leads with the face — *"Caving Die: 6 — You found something: Padded
Armor."* — so a player reads their own roll and not just its outcome. A
`QUIET` used to send nothing, but players could not tell a quiet roll from
a die that never rolled, so it now says so in one line.

## 3. The loot table

`db/lib/cavingLoot.js` — **code, not YAML**, because this is mechanics (a
weighted draw), not player-facing catalog data the way a tag's price is. A
`FIND` draws in two stages: a tier by the standing zone's column below, then
a slug uniformly within that tier.

| Tier | Caves | Depths |
|---|---|---|
| Ultracommon | 65% | 15% |
| Common | 25% | 22% |
| Uncommon | 8% | 28% |
| Rare | 1.95% | 25% |
| Extremely rare | 0% | 7% |
| Nearly impossible | 0.05% | 3% |

Each column sums to 1, asserted by `validateCavingLoot()` at startup. The Caves
is where ultracommon loot dominates — that's where people go to farm
`{tag:cave-fungus}` — while Nearly Impossible barely exists there (a fixed
0.05%) and grows to 3% in the Depths; that top tier is meant to come mostly
from GM-run quests, not the die.

The Depths took the **old Aberrant Pits column unchanged**, rather than the
middle Railroad one, because it is now the only deep place on the map and has
to carry what all three tiers below the surface used to.

`LOOT_TABLE`'s contents, by tier — see the file for the exact slug lists;
weapon/armor entries pull representative slugs off `SMITHING.md` §3/§4's
ladder rather than every entry in it:

- **Ultracommon** — Cave Fungus, Saltpeter.
- **Common** — Cudgel, Purse, Cracked Bone Club, Sling, Skinned Cave Rat, Old
  Coin.
- **Uncommon** — Alcohol, Cleaning Powder, Fine Meal, Bear Trap, plus
  low-tier weapons and armor.
- **Rare** — Ravenheart Red, Cat, Salvage Plate, Supply Kit, Jewelry, Bliss,
  Spyglass, Gas Mask, plus mid-tier weapons and armor.
- **Extremely rare** — EMP Grenade, refined gunpowder, Skeleton Wedge,
  Jester Outfit, Starting Wares, Military Autoinjector, Autocannon Shell,
  plus top-tier weapons and armor.
- **Nearly impossible** — Energy Shield, Power Fist, the Neoclassic
  Revolver, Stepstone, Dark-Eye Lenses, Motorcycle.

`validateCavingLoot(prisma)` checks every table slug against the live Tag
catalog and every column's weights sum to 1, and throws loud if not — call it
once at process startup, not per roll, so a typo in the table fails the
deploy instead of handing a player nothing on the one 6 they rolled all
week.

Smoke test one loot draw from a scratch character with
`db/lib/cavingPass.js#rollCaving` directly rather than walking a real character
into a real cave — see the file's own comment for the cleanup order (delete the Request
before the character; `CavingRoll`/`CharacterTag` cascade).

## 4. A FIND is a Request

The grant goes through the same apply-first-review-after machinery every
player action uses (`REQUESTS.md`), just system-filed instead of
player-initiated: `rollCaving` grants the tag and writes a `Request` of type
`CAVING_LOOT`, status `PASSED`, in the same transaction as the `CavingRoll`
row and the grant — a roll can never exist without its loot, or the reverse.

That buys the whole GM workflow for free. A `CAVING_LOOT` request shows up
in the **Requests** lens exactly like any other, with its own
`REQUEST_EFFECTS` entry (`web/lib/requestEffects.js`) whose `undo` drops the
granted tag off the `effect` snapshot — never re-derived from the tag's
current catalog value, same rule every Undo in the game follows.

A GM can reach that Undo from **either** lens. The Requests row stays where it
was, and the Caving desk grew an "Undo this find" button of its own so nobody
has to leave the caving log to correct a caving roll. It is the same call —
`resolveRequest({ requestId: roll.lootRequestId, mode: "undo" })`, through the
same `CAVING_LOOT` handler — so there is exactly one way the tag ever comes
back off, and `resolveRequestImpl` is already idempotent on an `UNDONE` row, so
pressing it twice cannot re-grant. The desk finds the request through
`CavingRoll.lootRequestId`; that column is `SetNull`, so a roll whose request
was deleted shows the find with no button.

## 5. The Caving lens

A third lens on `/gm/turns`, next to Moves and Requests
(`web/app/(desk)/gm/turns/QueueRail.js`), keyed `c` alongside `m`/`r`. Rows
show the die face, the character, the zone, and — for a `FIND` — the tier
and what was found. Default filter is **"Needs attention"**, which in
practice only ever matches an unresolved `TROUBLE` row — a hundred players
in the Depths would otherwise put a hundred quiet 2–5s in front of a GM every
day. Flip the filter to see the full log.

Rows show the die face, the kind, the character, the zone, and — for a `FIND`
— the tier and what was found. The kind's label comes from
`CAVING_KIND_LABELS` in `web/lib/cavingLabels.js`, shared by the rail's DTO
and the desk header; it lives in its own module because when the desk owned
the only copy, the rail printed every row's kind as "undefined" for months.

`CavingDesk.js` (modeled on `MoveDesk.js`, much thinner) is where a GM
narrates a `TROUBLE` roll. It carries the same **Result** box and **Stage as
message** bridge the Move desk has: the box is the GM-facing canon of what
happened, and Stage as message promotes it into a real DM to the roll's own
character (a `StagedMessage` wired to `cavingRollId`, delivered at the push
like any other). The Result box is *not* itself the thing the player receives
— Mark resolved only stamps the roll and stores the notes, so narration left
in the box alone never reaches anyone. That gap is exactly why caving-desk
messages used to go missing: the desk had the notes box but no Stage-as-message
button, so a GM working "the same as a Move" had no send step. Alongside it are
the same `EffectComposer` / `MessageComposer` / `PublicComposer` trio every
desk uses (wired to `cavingRollId` instead of `moveId` — both `StagedMessage`
and `StagedEffect` carry the column, `SetNull` on delete same as `moveId`), and
a **Mark resolved** button. No cooperative lock like a Move — two GMs opening
the same roll can't race a solve that pays anyone twice, since resolving is a
one-way stamp with nothing to apply. A `FIND` row has nothing to resolve, so it
opens without that button: what was found, and the **Undo this find** button
described in §4.

**The History lens reads Caving too.** `/gm/turns`'s History lens carries a
**Moves / Caving** switch beside its Turn picker (`historyKind` on the rail's
sessionStorage). Flip it to Caving and the lens lists that resolved turn's
rolls, mapped by the same `cavingRollRow` (`web/lib/moveRows.js`) the open turn
uses. Opening one shows `CavingDesk` in **read-only** mode — no composers, no
Mark resolved, the Result box disabled — but its staged rows still show, and an
unapplied one stays editable, the same rule `MoveHistoryDesk` follows. A
`/gm/turns/caving/<id>` link naming a past roll deep-links straight to it
(`page.js`'s `initialCaving`, the Caving twin of `initialHistory`).

## 6. `sellable` / `sellablePrice`

Two `Tag` columns, the seller's half of `purchasable`/`purchasableAfterStart`
— whether the Merchant's Depot will buy a tag off him, and for how many ⬢.
`syncTags.js` requires the two to travel together: `sellable` without a
positive `sellablePrice` is an error, and so is a price set without
`sellable: true`.

This update set them on six tags and left them inert, with no sell flow
reading either. **The Merchant Update built that flow** — `/depot` and the
`DEPOT_SELL` request — and widened the six to about 106, across brews, smithed
gear, bulk goods and salvage. The six originals kept their numbers: Graga Sac
(8), Cave Fungus (3), Saltpeter (3), Jewelry (8), Old Coin (1), Military
Autoinjector (10). See [`DEPOT.md`](DEPOT.md) §4, which is now canonical for
all of it.

Two of the caving artifacts are also on the Depot's *buy* shelf — the
Motorcycle and the Flamethrower, which the station has no trouble sourcing and
Ravenheart has every trouble hauling out of the Caves. Nothing else on the loot
table is purchasable at any price.

## 7. Two catalog fields this update added

Both documented in full in `schema.prisma`'s `Tag` model comments and read by
`web/lib/consumeGrants.js`; see `TAGS.md` §5b for `consumesInto` itself.

- **`consumesIntoResources`** — the Resources half of consuming a tag.
  `Purse` (consumes into 3 ⬢, no tag) and `Supply Kit` (8 ⬢ plus one
  Alcohol) are the first users. Applied by `consumeTagRequest`
  (`web/app/(app)/character/requestActions.js`) through the ordinary
  `creditResources` primitive, and snapshotted into `Request.effect` so
  `CONSUME_TAG`'s Undo debits it back exactly.
- **`consumesIntoOneOf`** — a parallel array to `consumesInto`, same length
  and order, for an even random pick between alternatives —
  `{ oneOf: [...] }` in `docs/tags.yaml`, the same shape `expiresInto`
  already used. `Skinned Cave Rat` is the first user: 50/50 Ate Meal or
  Vomiting. The "Becomes:" previews on `/character` render an unresolved
  `oneOf` position as "A or B" rather than rolling a real pick on every
  render or hover — `resolveConsumeGrants` still exists for the server
  action, which does commit to one.

## 8. The Radio rename

Unrelated to the die itself but shipped in the same update: `radio-system`
and `radio-bracelet` were renamed to `radio-system-watch` /
`radio-bracelet-watch`, both descriptions gaining "Tuned to the Watch's
frequency." `syncTags.js` upserts by slug and never renames, so the old rows
are simply left behind for `db:prune-tags` once nothing holds them.

They were renamed a second time when the Watch became the Cerberon, and are
now `radio-system-cerberon` / `radio-bracelet-cerberon` ("Radio System
(Cerberon)" / "Radio Bracelet (Cerberon)"). Same mechanic, same leftovers.

## 9. Where the code lives

| Concern | File |
|---|---|
| The die | `db/lib/cavingPass.js` |
| The loot table | `db/lib/cavingLoot.js` |
| The one trigger | `db/lib/cavingPass.js#rollCavingOnArrival` |
| Its callers | `db/lib/locationTravel.js#performLocationMove` (mover + dragged), the Dev Panel's `teleportCharacterImpl`, `web/app/(app)/gm/dev/actions.js#bulkMoveCharacters` |
| The safe-Location exemption | `db/lib/locationAttributes.js` (`safe`), authored in `docs/zones.yaml` |
| Arrival DM senders | whichever face's location-move caller runs `performLocationMove` sends `moved[].cavingDm`; the two GM paths send their own |
| Kind labels | `web/lib/cavingLabels.js` |
| Loot grant → Request/Undo | `web/lib/requestEffects.js` (`CAVING_LOOT`) |
| Consume mechanics | `web/lib/consumeGrants.js`, `db/lib/syncTags.js` |
| The Caving lens | `web/app/(desk)/gm/turns/QueueRail.js`, `CavingDesk.js` |
| The document | `docs/documents.yaml` (key `caving`) |
| The public brief text | same entry — kept in sync with players by hand |
