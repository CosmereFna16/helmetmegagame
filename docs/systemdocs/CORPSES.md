# Corpses, butchering, and freeing a soul

What a body is once nobody is using it. This doc owns `db/lib/corpses.js`,
`db/lib/corpseMint.js`, `db/lib/corpseFollow.js`, `db/lib/corpseRotPass.js`,
`db/lib/headstone.js`, `bot/src/lib/deathSmell.js`, the Butcher/Bury/Engrave
actions, and `Tag.requirementItems`. Related: `CHARACTERS.md` (death and the
Cursed role), `CARRY.md` (room stashes and the reach rule), `REQUESTS.md`
(the three request types), `BREWING.md` (the two enforced ingredients).

## 1. The one idea

**A corpse is a handle to a dead character's sheet, not a container.**

When someone dies, `applyDeathToRow` writes one `Tag` row — "Ada's Corpse" —
and drops it into a random public Room at the Location they fell in. Their ⬢
and their gear do **not** move; they stay on the `Character` row exactly as
before, and `LOOT_CHARACTER` is completely unchanged.

What the tag adds is *position*. `db/lib/corpseFollow.js` keeps the dead
character's `locationId`/`zoneId` equal to wherever their corpse tag currently
is. Because `db/lib/presence.js#isHere` is Location-grain and already accepts
an unburied corpse, that one reconcile is the whole feature: carry a body to
another Location and it becomes lootable there, draggable there, and buriable
there, with **no edit to Loot, Move Player or Harm at all**.

The alternative — dumping the inventory on the floor — was considered and
dropped. It would have made `LOOT_CHARACTER` pointless for corpses while
leaving it necessary for the bound and the helpless, which is two mechanisms
for one verb.

## 2. Why the follow reconcile is pull-based

The obvious design is to push from whatever moved the tag. It cannot work.

**The case the feature exists for involves no tag write whatsoever.** You pick
a body up and walk somewhere: the only row that changed is *your own*
`locationId`. No tag writer fired, so no push from a tag writer could catch it.

So `reconcileCorpses(prisma)` takes no arguments and recomputes from current
state, the same reasoning `settleCarry` and `roomAccess.js#syncCharacterRoomAccess`
both give. It is bounded by the number of deaths in the game. Three call sites:

| Where | Why |
|---|---|
| `db/lib/locationMove.js#applyLocationMoveSideEffects` | **The important one.** Somebody arrived somewhere carrying a body. |
| `web/lib/afterInventoryChange.js` | A body changed hands, or went into or out of a room stash. Once per batch, not per character — a transfer has both ends in `ids`. |
| the `corpseFollow` turn pass | After `carry`, because the overflow drop can put a corpse on a floor. |

Precedence is: in someone's hands → that holder's Location; lying in a Room →
that Room's Location; **nowhere → leave the dead row alone.** That last case is
real (a buried or butchered body's tag has no holdings) and must never be read
as "move them to null", which would unplace every buried character on the next
pass. The update is also filtered to `status: DEAD, buriedAt: null`, so a
revived character never gets teleported by their own old body.

**`MOVE_CHARACTER` still drags corpses, and the tag is authoritative.** The
reconcile is strictly one-directional — tag position decides sheet position,
never the reverse. Do not add a reverse sync; two movers that can disagree is
how this gets confusing.

## 3. Rotting: the row is renamed, not chained

Three turns after death, "Ada's Corpse" becomes "Ada's Rotten Corpse".
`db/lib/corpseRotPass.js` does it by **mutating the same `Tag` row** — name,
description, `corpseKind`. `Tag.expiresInto` is sitting right there and is the
wrong tool, three times over:

- it names catalog **slugs**, and "Ada's Rotten Corpse" is per-character and
  never in `docs/tags.yaml`. There is no slug for it to name.
- `tagExpiryPass.js` walks `CharacterTag` only, and a corpse is almost always a
  `RoomTag` lying on a floor.
- a chain would leave the *holding* pointing at the old row, so a body someone
  was carrying would rot into a tag somewhere else.

Renaming sidesteps all three, and a body in your bag rots in your bag.

**The pass must run before `expirySweep`, and `TURN_PASSES` puts it there.**
That sweep is a blind `deleteMany` over `expiresTurn <= turn.number`, so a
corpse that reached its clock would be *deleted* rather than rotted. Nulling
`expiresTurn` on both holdings is what takes the row out of the sweep's reach —
no exemption list, no special case in `db/index.js`.

**Monster corpses never rot.** The three in `docs/tags.yaml` carry no
`durationTurns`, so nothing ever matches them. A Nekker left lying around stays
butcherable; only a person stinks.

## 4. Names collide, and both writers handle it

`Tag.name` and `Tag.slug` are both `@unique`, and two characters can share a
name. Both the mint and the rot rename retry with a `(2)` suffix on the unique
violation rather than pre-checking — two deaths resolving in the same turn
close would both pass a pre-check and then one would throw.

The rot rename re-derives its suffix rather than parsing the old name, because
the old name is the thing being replaced.

## 5. The smell

`bot/src/lib/deathSmell.js` posts **"It smells like death… ‡"** to the channel
of every Location holding a rotten corpse — in a Room there, or in the pocket
of somebody standing there. A body in a bag smells as much as one on the floor.

**Every 4–10 hours, randomized, via a self-rescheduling `setTimeout` chain.**
`node-cron` cannot express that, and the randomness is the point: a fixed
cadence would make the smell a clock players could read, when what it is for is
nagging unpredictably until somebody buries the body. Each firing schedules the
next, so nothing may throw out of the tick or the chain dies silently.

**It needs no cleanup code.** The Dawn wipe already deletes every top-level
message in a Location channel except the pinned anchor (`CHANNELS.md`). So the
obligations here are negative, and they matter: never pin the line, and never
record its id as an anchor. Do neither and it clears itself every Dawn.

## 6. Butcher

A new button, gated on the `butcher` tag (now a Mercenary starting tag).
**Free — no ⬢, no Move — and it consumes the body.**

The tag pays twice: it also carries `laborBonus: { kind: hunting, amount: 2 }`,
so a Butcher hunting produces +2 ⬢. That bonus used to apply to every kind of
laboring except farming and was hardcoded in `db/lib/laborAccess.js`; it is
hunting-only now and lives in `docs/tags.yaml` like every other tool
(`LABORING.md` §5). It needs no equipping — it is a skill, not a kit.

| Corpse | Yields |
|---|---|
| Nekker Corpse | `nekker-pheromones` |
| Graga Corpse | `graga-sac` |
| Skinless Corpse | `skinless-brain` |
| anybody's corpse | `human-flesh` |

`nekker-pheromones` **stopped being brewable** in the same change. It is
butchered now, and its row is gone from `BREWING.md` §2 and from the Alcohol &
Drugs document.

`human-flesh` is consumed exactly as a `fine-meal` is — it feeds you and settles
the turn's hunger — and is deliberately **not sellable**. Butchering is free and
every death mints a corpse, so a priced Human Flesh would be a code-enforced ⬢
faucet hanging off a free action. It stays `tradeable`, so players can still
sell it to each other for whatever they can get, which is the right market.

**Butchering does not free the soul.** Cutting someone up destroys the body
without burying it, so their player stays Cursed. That is a decision, not an
oversight, and Engrave is the way out of it.

Two Desires reward eating a person: `eat-human-flesh` (tier 2, gated on `cruel`,
repeatable) and `feast-on-human-flesh` (tier 4, gated on `glutton`, once per
life — an appetite has a first time exactly once). Neither is wired to the
Butcher action; a player claims it and writes what they did, and the
`request_butcher_corpse` audit row is the receipt a GM checks it against.

## 7. Bury and Engrave

Both spend the filer's Move, via `fileAutoRoutine` — the generalized
`fileCraftAction`, now taking its `gmNotes` as a parameter because three
callers use it.

**Bury needs the actual body.** It used to match a typed first name against the
dead in your zone; now you pick a corpse you hold or can reach, which is
strictly tighter (Location-grain, and you have to have it). It consumes the
corpse tag, stamps `buriedAt`, and lifts the Cursed role as before. A monster
corpse is refused — "There's no soul in that one."

**Engrave is the answer to a body nobody can find**, so it is the one action
here with no corpse and no reach check, and it searches **every zone**. It costs
**4 ⬢** and a Move, frees the soul the way burying does, and leaves a
`{name}'s Headstone` tag on the engraver.

Engrave inherited Bury's **typed** first name, and the reasoning that kept it
typed is unchanged and now stronger: a dropdown would answer "who is dead?" to
anyone who opened the dialog, and the list would be every unburied body in
Ravenheart rather than the ones at your feet. **The `>1 match` refusal came
with it and matters more than it used to** — it is the only thing standing
between a mourner and freeing the wrong soul.

The headstone mint is an **upsert**: two mourners can engrave the same person,
and the second gets a grant of the row the first made. One stone; more than one
person can have helped.

## 8. `Tag.requirementItems` — the first enforced ingredient

`BREWING.md` was explicit that no code enforced a recipe, "least of all the
ingredient". Two recipes now do:

```yaml
  miasma:
    requirement:
      items:
        - group: items-corpse      # any corpse, incl. a per-character one
  dreamers-draught:
    requirement:
      items: [skinless-brain]      # a bare string is a tag slug
```

**HOLDING IT IS THE CHECK. Nothing is consumed.** No quantity moves, and
crafting twice off one corpse is allowed — the recipe says you need one to
hand, not that you use it up.

**Json, not a `Tag[]` relation**, and the group form is why: a corpse written at
death is never in `docs/tags.yaml`, so no authored relation could ever name one.
Each normalized entry carries a denormalized `label`, because
`formatTagRequirement` is pure and synchronous and is called from four surfaces
with four different selects; the sync rewrites the label every run.

Validated by `db/lib/tagShapes.js#validateRequirementItems`, which throws on an
unknown slug or group, on a duplicate, and on an `items` block on a tag that is
**not craftable** — the only enforcement point is the Craft path, so an `items`
block anywhere else would sit in the catalog looking enforced and do nothing.

Enforced in `requireRecipeItems` (`requestActions.js`), against the crafter's
**own sheet only** — never a room stash they could reach. A multi-turn project
re-runs it on every continue, and "there was a corpse in a room nearby at the
time" would mean something different on turn 3 than on turn 1.

**Adding a surface that renders a Recipe line means adding `requirementItems`
to its select.** A caller that forgets it renders no ingredient line rather
than throwing, which is the quiet failure to watch for.

## 9. The three kinds of Tag row

`TAGS.md` §5d describes two authoring doors. There are three:

| | `docs/tags.yaml` | GM, at `/gm/dev/tags` | **System** |
|---|---|---|---|
| Written by | the sync | a person | `corpseMint.js`, `headstone.js` |
| `custom` | false | true | **true** |
| `corpseKind` | FRESH, if in `items-corpse` | never | FRESH → ROTTEN |
| `corpseOfCharacterId` | null | null | **the body** |
| Touched by `db:sync-tags` | upserted | never | never |
| Touched by `db:prune-tags` | if unreferenced | never | never |

`corpseOfCharacterId` is `@unique` (one corpse per death, so the mint is an
upsert and a revive is a delete-by-character) and **`onDelete: Cascade`**, which
is load-bearing: it is the only thing stopping these rows outliving a Restart
Game. `wipeGameData` deliberately never touches the catalog, and its existing
order already clears `CharacterTag` and `RoomTag` before `character.deleteMany()`
— so the cascade lands clean and **the wipe needed no edit at all.**

## 10. Two traps

**`CharacterTag.tagId` is RESTRICT; `RoomTag.tagId` is Cascade.** Deleting a
corpse tag somebody is *carrying* throws a foreign-key error. Use
`corpseMint.js#deleteCorpseFor`, which clears both holding tables first. This
is exactly the bug that bit `reviveCharacterImpl`, and `CARRY.md`'s claim that
"deleting a Tag from the catalog cascades its stacks too" is only half true.

**A GM Revive must clear the corpse** (`deleteCorpseFor`). The Cascade fires on
a Character *delete*, and a revive is an update — so without it a walking
person leaves a body anyone could pick up, and the follow reconcile would keep
dragging their sheet to wherever it went.

**Butcher and Bury deliberately do NOT delete the Tag row** — only the holding.
A GM's Undo has to be able to put the body back.

## 11. Where the code lives

| Piece | File |
|---|---|
| Reach, yields, the shared vocabulary | `db/lib/corpses.js` |
| Minting a body, and removing one | `db/lib/corpseMint.js` |
| Sheet-follows-corpse | `db/lib/corpseFollow.js` |
| Rot | `db/lib/corpseRotPass.js` (`TURN_PASSES` `"corpseRot"`) |
| The smell | `bot/src/lib/deathSmell.js`, armed in `bot/src/events/ready.js` |
| Headstones | `db/lib/headstone.js` |
| The three actions | `web/app/(app)/character/requestActions.js` |
| Undo | `web/lib/requestEffects.js` |
| Buttons, dialogs | `actionRegistry.js`, `RequestActionsProvider.js`, `icons.js` |
| Ingredient shape | `db/lib/tagShapes.js`, `db/lib/syncTags.js`, `db/lib/formatTagRequirement.js` |
| Constants | `CORPSE_GROUP_SLUG`, `BUTCHER_SLUG`, `HUMAN_FLESH_SLUG`, `ENGRAVE_RESOURCE_COST`, `CORPSE_ROT_TURNS` in `db/lib/constants.js` |
