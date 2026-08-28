# The Caves: the Caving Die and its loot

The Depths' one piece of automatic mechanics. Companion to `MAP.md` (zones
and travel), `TURN-ENGINE.md` (where this hooks into a turn advance),
`REQUESTS.md` (the apply-first-review-after pattern a loot find reuses),
`ADJUDICATION.md` (the `/gm/turns` desk this adds a third lens to) and
`TAGS.md` (the catalog fields `sellable`/`sellablePrice`/
`consumesIntoResources`/`consumesIntoOneOf` live in).

## 1. The three levels

`docs/zones.yaml`'s `caves` entry is a `kind: group` row — a GM seat and a
Discord category, never a place a character can stand — whose `levels:` list
is flattened by the sync into three real, standable `CAVE_LEVEL` zones:
Caverns, Railroad, Aberrant Pits (`caverns` / `railroad` / `aberrant-pits`).
They're chained one Move apart, same as any other hop on the map — since the
zone rework there is no free walking anywhere, so the levels need no special
cost rule, only their place in `zoneConnections`. Moving from Caverns to
Railroad to Aberrant Pits costs three separate turns.

The public **Caving** document (`docs/documents.yaml`, key `caving`) is the
player-facing brief — what the three levels are, what to bring, and that the
die exists. `Role.docElements` grants it to `migrant` and `mercenary`, the
two roles that start in the Depths (Railroad and Caverns respectively), and
it's public so anyone else can find it too.

## 2. The Caving Die

Every `ALIVE` character standing in a `CAVE_LEVEL` zone gets one roll per
turn — a flat `1d6`, no Gambit modifier, rolled by `db/lib/cavingPass.js`'s
`rollCaving(prisma, character, turn, zone)`. Written to a `CavingRoll` row.

Two triggers share that one primitive:

- **Turn start** — `runCavingPass(prisma, turn)`, called from
  `db/index.js#resolveNeeds()`, rolls for every qualifying character in one
  pass. Registered in `TURN_PASSES` as `"caving"`, slotted **after
  `expirySweep`, before `hunger`**: loot granted just now must not be swept
  this same turn, and a Skinned Cave Rat eaten last turn needs to be swept
  before Hunger reads whether the character ate.
- **On arrival** — `db/lib/travel.js#performTravel` rolls once more the
  moment a hop lands a character in a `CAVE_LEVEL` zone (including a first
  placement — Migrant and Mercenary start there). `travel.js` performs no
  Discord side effects itself; the roll's DM comes back on the result as
  `cavingDm` for the caller (`bot/src/lib/zoneTravel.js`,
  `web/app/(app)/map/travelActions.js`) to send, the same split
  `performTravel` already uses for the zone-role swap.

`CavingRoll.@@unique([characterId, turnId])` is what makes firing both
triggers in the same turn safe: whichever gets there first wins the row, and
`rollCaving` swallows the loser's `P2002` as "already rolled this turn" —
never a second roll, never an error surfaced to the player.

### What each face means

| Die | Kind | What happens |
|---|---|---|
| 1 | `TROUBLE` | Nothing auto-applies. The row lands **unresolved** on the Caving lens for a GM to adjudicate — monsters are a GM call, briefed by the GM-only `cavingmonsters` document (`documents.yaml`). The player gets one short DM immediately: *"Something is wrong down here. A GM has been notified."* |
| 2–5 | `QUIET` | Stamped resolved at creation. No DM, no GM attention — the row exists purely as a record (so the lens' default filter, and a GM skimming the log, both read the truth). |
| 6 | `FIND` | Draws a loot tier and a tag (below), grants it, and DMs the player what they found. Also resolved at creation — the grant already landed. |

## 3. The loot table

`db/lib/cavingLoot.js` — **code, not YAML**, because this is mechanics (a
weighted draw), not player-facing catalog data the way a tag's price is. A
`FIND` draws in two stages: a tier by the standing zone's column below, then
a slug uniformly within that tier.

| Tier | Caverns | Railroad | Aberrant Pits |
|---|---|---|---|
| Ultracommon | 65% | 35% | 15% |
| Common | 25% | 30% | 22% |
| Uncommon | 8% | 22% | 28% |
| Rare | 1.95% | 12.0% | 25% |
| Extremely rare | 0% | 0.5% | 7% |
| Nearly impossible | 0.05% | 0.5% | 3% |

Each column sums to 1. The Caverns is where ultracommon loot dominates —
that's where people go to farm `{tag:cave-fungus}` — while Nearly
Impossible barely exists there (a fixed 0.05%) and grows to 3% in the Pits;
that top tier is meant to come mostly from GM-run quests, not the die.

`LOOT_TABLE`'s contents, by tier — see the file for the exact slug lists;
weapon/armor entries pull representative slugs off `SMITHING.md` §3/§4's
ladder rather than every entry in it:

- **Ultracommon** — Cave Fungus, Saltpeter.
- **Common** — Cudgel, Purse, Cracked Bone Club, Sling, Skinned Cave Rat, Old
  Coin.
- **Uncommon** — Alcohol, Cleaning Powder, Fine Meal, Manacles, Bear Trap,
  plus low-tier weapons and armor.
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
`db/lib/cavingPass.js#rollCaving` directly rather than force-advancing a real
turn — see the file's own comment for the cleanup order (delete the Request
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
current catalog value, same rule every Undo in the game follows. A GM who
thinks a find was a mistake undoes it there, not from the Caving desk.

## 5. The Caving lens

A third lens on `/gm/turns`, next to Moves and Requests
(`web/app/(desk)/gm/turns/QueueRail.js`), keyed `c` alongside `m`/`r`. Rows
show the die face, the character, the zone, and — for a `FIND` — the tier
and what was found. Default filter is **"Needs attention"**, which in
practice only ever matches an unresolved `TROUBLE` row — a hundred players
in the Depths would otherwise put a hundred quiet 2–5s in front of a GM every
day. Flip the filter to see the full log.

`CavingDesk.js` (modeled on `MoveDesk.js`, much thinner) is where a GM
narrates a `TROUBLE` roll: GM notes, the same `EffectComposer` /
`MessageComposer` / `PublicComposer` trio every desk uses (wired to
`cavingRollId` instead of `moveId` — both `StagedMessage` and `StagedEffect`
carry the column, `SetNull` on delete same as `moveId`), and a **Mark
resolved** button. No cooperative lock like a Move — two GMs opening the same
roll can't race a solve that pays anyone twice, since resolving is a one-way
stamp with nothing to apply. A `FIND` row opens read-only-ish: what was
found, and a pointer to undo it from the Requests lens instead.

## 6. `sellable` / `sellablePrice`

Two `Tag` columns, the seller's half of `purchasable`/`purchasableAfterStart`
— whether the Merchant's Depot (`docs/roles.yaml`'s Merchant role,
`docs/documents.yaml`'s still-thin Merchant document) will buy a tag off a
player, and for how many ⬢. Catalog data only for now, same status
`purchasable` has always had — no sell flow reads it yet. `syncTags.js`
requires the two to travel together: `sellable` without a positive
`sellablePrice` is an error, and so is a price set without `sellable: true`.

Set on six tags so far: Graga Sac (8), Cave Fungus (3), Saltpeter (3),
Jewelry (8), Old Coin (1), Military Autoinjector (10).

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
`radio-bracelet-watch` ("Radio System (Watch)" / "Radio Bracelet (Watch)"),
both descriptions gaining "Tuned to the Watch's frequency." Because
`syncTags.js` upserts by slug and never renames, this needed a one-off
repair script — `npm run db:backfill-radio-rename`, run after
`db:sync-tags` and `db:sync-roles` — to repoint every `CharacterTag` holding
the old rows onto the new ones before the orphans are pruned. See the
script's own header for the exact order.

## 9. Where the code lives

| Concern | File |
|---|---|
| The die, both triggers | `db/lib/cavingPass.js` |
| The loot table | `db/lib/cavingLoot.js` |
| Turn-start registration | `db/index.js` — `TURN_PASSES`, `resolveNeeds()` |
| Arrival trigger | `db/lib/travel.js#performTravel` |
| Arrival DM senders | `bot/src/lib/zoneTravel.js`, `web/app/(app)/map/travelActions.js` |
| Loot grant → Request/Undo | `web/lib/requestEffects.js` (`CAVING_LOOT`) |
| Consume mechanics | `web/lib/consumeGrants.js`, `db/lib/syncTags.js` |
| The Caving lens | `web/app/(desk)/gm/turns/QueueRail.js`, `CavingDesk.js` |
| The document | `docs/documents.yaml` (key `caving`) |
| The public brief text | same entry — kept in sync with players by hand |

See also `docs/item-sources.md`, the shopping list several of this update's
new tags were drawn from.
