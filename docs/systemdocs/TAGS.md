# Tag catalog

How the `Tag`/`TagGroup` catalog is structured, master-sourced, and synced.
Not to be confused with `CharacterTag` (an individual character's *holding*
of a tag) or `Location.tags` (free-text flavor strings on a Location,
unrelated to this system).

## 1. Category -> Group -> Tag

Three levels:

- **Category** — a flat string (`Meta`, `General`, `Skills`, `Status`,
  `Items`, `Assets`, plus the two hidden ones, `Demoness` and `Bacchus`).
  Not its own DB table; `docs/tags.yaml`'s top-level `categories:` list is
  validation-only — `syncTagsFromYaml` rejects any tag/group whose
  `category` isn't in that list. Because a category has no row of its own, a
  **hidden** category isn't a category-level field either: it's a group-level
  `requiredTag` on the one group that category contains (§3a). **Items are the portable
  half and Assets the standing half**: a revolver or a meal you carry and
  hand over, versus a Manor, a House, or a Follower you simply have. There is
  deliberately no third `Companions` category — the property-vs-companion
  split inside Assets is carried by the `assets-property` /
  `assets-companions` groups, which keeps `TRANSFERABLE_CATEGORIES` (Transfer
  Tag's filter, `web/lib/tagRequests.js`) a two-item list.
- **Group** (`TagGroup`) — optional, scoped to exactly one category, exists
  purely to color tags for display (e.g. Status's Health/Food/Buffs/Debuffs
  groups). A tag with no group renders uncolored. `TagGroup.color` is a
  freeform hex string (e.g. `"#6fa8ab"`), rendered directly by `TagChip.js`
  — not theme-aware, so pick a value that reads on both the dusk and dawn
  backgrounds.
- **Tag** — the catalog entry itself.

## 2. Master sources: `docs/tags.yaml` and `docs/taggroups.yaml`

`docs/tags.yaml` holds categories and tags; `docs/taggroups.yaml` holds the
`TagGroup` catalog (split into its own file so group colors can be freeform
hex rather than a fixed token set). Same posture as `docs/locations.yaml`:
hand-edited, `slug` is the stable match key across syncs, and syncing is
**upsert-only** — removing an entry from either YAML never deletes its row,
it just stops receiving updates. `db/lib/syncTags.js#syncTagsFromYaml(prisma)`
reads both files and does the sync, run by hand via `npm run db:sync-tags`
(`db/prisma/sync-tags.js`) or automatically at the end of `wipeGameData`'s
"Restart Game" flow (`web/app/(app)/gm/dev/actions.js`), right after
`syncLocationsFromYaml`.

The sync is five passes, since tags/groups can reference each other by slug
before every row necessarily exists yet: TagGroup scalars, then Tag scalars
+ `groupId`, then `parentTag`/`requiredTag` links, then `TagGroup.requiredTag`
links, then `requirement.skills`. (`consumesInto` is the exception — it is
validated up front against the YAML's own slug set, before any write, so a
typo fails cleanly instead of half-applying.) Each pass only writes a row when something actually changed (a
diff check, same style as `syncLocationsFromYaml`'s `needsUpdate`).

## 3. Two relations that look similar but aren't

- **`parentTag` (tier chain)** — sequential, replacing. Fighting (Basic) ->
  Fighting (Trained) -> Fighting (Skilled) -> ... Acquiring a tier is meant
  to replace the previous one on the character, not stack alongside it. Also
  used where a specialization *is* the base thing rather than a second copy of
  it: `Follower (Cook)`/`(Laborer)`/`(Goon)` all chain off `Follower`, so
  picking one gives you a follower who cooks — not a follower plus a cook.
- **`requiredTag` (prerequisite)** — non-replacing. The character must
  already hold `requiredTag`, but acquiring this tag does **not** remove or
  replace it. Example in the catalog: `Fighting (Archer)` requires
  `Fighting (Basic)` but coexists with `Fighting (Skilled)` — a character can
  hold both at once. Also the right relation for an origin/membership gate the
  gated tag doesn't consume: `Windlander (Horse)` requires `Windlander`,
  `Manor` requires `Courtier`, `House`/`Shack` require `Ravenhearter`, and the
  `Laborer (…)` specializations require `Laborer` — those stack, several
  specializations on one Laborer, each charged once.
- **`TagGroup.requiredTag`** — the group-level version of the same
  prerequisite: every tag in that group stays gated behind one required tag,
  so a whole category-of-flavor can be hidden behind a single membership tag
  without repeating `requiredTag` on every tag in it. See §3a.

`web/lib/characterCreation.js` is where the logic lives.
`holdsRequirement(requiredTagId, …)` answers "is this one id satisfied by
anything held or selected, at any tier of its chain"; `requirementSatisfied`
calls it for **both** `tag.requiredTagId` and `tag.group.requiredTagId`, and
is the only place the two are combined. `chainOf`/`cumulativeCost`/
`effectiveCost` price a `parentTag` chain as the sum of its hops, and
`chainSiblingsToRemove` collapses a selection down to one member per chain.

Enforced in five places, all reading that one function: `PointBuy.js`
(creation), the Add Tag picker in `TagRequestButtons.js` (mid-game),
`createActions.js` and `requestActions.js#addTagRequest` (the server-side
re-checks, since both menus are advisory), and `web/app/api/tags/route.js`
(§3a). **A GM grant still ignores both, deliberately** — a GM handing out a
tag is the one path that should never be second-guessed.

Every caller must select `group.requiredTagId` alongside `requiredTagId`.
Miss it and a hidden category silently opens for everyone, with nothing to
show that it has.

## 3a. Hidden categories

Two categories are secret: **Demoness** (behind the `demoness` tag) and
**Bacchus** (behind `follower-of-bacchus`, displayed as "Cultist of
Bacchus"). Each contains exactly one `TagGroup` carrying the `requiredTag`,
which is where the whole mechanism lives — the tags inside deliberately do
**not** repeat `requiredTag`, so the gate is written once.

Three things make a category actually hidden rather than merely empty:

- **The tabs are derived after the filter, not before.** `unlockedTags()`
  runs first and `menuCategories()` reads its output, so a fully-gated
  category has *no tab*. It used to be the other way round, which left a tab
  reading "Nothing available in this category" — an advertisement.
  `unlockedTags` takes a `keepIds` list for the menu's current picks, since
  selecting a tag doesn't satisfy that tag's own requirement and it would
  otherwise vanish under the cursor.
- **The Add Tag picker folds the character's held tags into its `byId` map.**
  The catalog it gets is purchasable-or-craftable only, so the tags that
  *open* a gate (both are `purchasable: false`, GM-assigned) aren't in it —
  without the fold, the chain walk dead-ends and the category stays shut for
  the one person meant to see it.
- **`/api/tags` withholds them.** That route is the app-wide tag catalog
  `RichText`/`TagChip` read, and it used to be unauthenticated and complete,
  so the whole Demoness catalog was one DevTools tab away. It now resolves
  the caller's own character and drops any tag whose group is gated. Gating
  is on the **group** gate only, never a tag's own `requiredTag`: Fighting
  (Archer) isn't a secret, and hiding it would break `{tag:fighting-archer}`
  in public documents for everyone who hasn't bought it.

## 4. The point economy

`pointCost` is the price in the point-buy menu, and it is **signed**:
positive costs the player points, negative *grants* them (the drawbacks,
Old at `-2` and Frail at `-3`). Both directions fall out of one subtraction,
so `remaining >= 0` is the only rule for whether a build is legal.

**The display inverts it, and both axes agree.** `formatCost`/`costColor`
(`web/lib/characterCreation.js`) show the effect on the player's *point
pool*, never whether the tag is a good thing to have:

| tag | `pointCost` | shown as | colour |
|---|---|---|---|
| Frail | `-3` | `+3 pts` | `--positive` (pool grows) |
| Fighting (Basic) | `3` | `-3 pts` | `--accent` (pool shrinks) |
| Shack | `0` | `0 pts` | `--muted` |

These two functions are the only place that flip lives — every caller
(`TagChip`, `PointBuy`, `TagRequestButtons`, `CreateCharacterWizard`) passes
the raw signed `pointCost` and lets them decide, so nothing else should ever
negate it. The arithmetic is untouched: `PointBuy`'s affordability check and
`remaining = budget - sum(pointCost)` both still read the raw catalog value.

Before this, the sign was catalog-style while the colour was pool-style, so
Frail read as "`-3`, in green" — two conventions disagreeing on one line.

A character's budget is
`GameConfig.startingTagPoints` (default 12) `+ role.extra_starting_points`
`- 3 if the player is Cursed`, computed by
`web/lib/characterCreation.js#computeBudget`. Anything unspent is kept on
`Character.tagPoints`.

`purchasable` gates whether a tag can ever be bought — role-granted identity
tags (Courtier, Chaplain, Nobility) are `false`, so they arrive with the role
and never through the menu.

`purchasableAfterStart` splits the two menus that share
`web/app/components/PointBuy.js`: character creation offers every
`purchasable` tag, while the mid-game store offers only those still marked
`purchasableAfterStart`. That's what lets a pick like "Secretly an Android"
exist at launch and never afterward. **Every negative-cost tag must be
`purchasableAfterStart: false`** — a drawback buyable mid-game is a point
farm.

Full writeup of creation, roles, and the wizard: `CHARACTERS.md`.

## 5. Other fields

- `visibleOnInspect` — shown to another player who 🔍-reacts to this
  character's proxied messages (`bot/src/events/messageReactionAdd.js`).
  Defaults closed. Note it is a property of the tag being *seen*. The two
  tags that widen what an inspect shows are read off the **inspector**
  instead: Seductive reveals the subject's active Desire and Torturer their
  Worst Fear, resolved by `db/lib/inspectVision.js`, which also accepts the
  discounted Demoness twins of each. Like the Silo-gated Resources field, an
  unseen field is absent rather than placeholdered — a placeholder
  advertises that there is something to go after.
- `tradeable` — Items-category flag for a future trade flow; no transfer
  logic exists yet (Transfer Tag filters on `category`, not this).
- `stackable` — whether a character can hold more than one at a time. Live
  code reads this; see §5a.
- `defaultDurationTurns` (spelled `durationTurns` in the YAML) — catalog-level "how many turns does this last once
  granted," for tags that auto-expire (e.g. Drained is 3). The actual
  per-instance expiry lives on `CharacterTag.expiresTurn` (an absolute turn
  number, computed from this default at grant time), swept by
  `resolveNeeds()` in `db/index.js` once the closing turn's number reaches
  it. Live code reads this — Mood (2) and Hunger (1) both compute their
  `expiresTurn` as `turn.number + defaultDurationTurns` — so it is no longer
  catalog-only. Note the ordering it implies: `resolveNeeds()` sweeps *before*
  the Hunger pass grants, so a still-broke character's Hunger is cleared and
  re-granted rather than colliding with `@@unique([characterId, tagId])`. See
  `REQUESTS.md` §4.
- `removable` — whether a player can strip this tag off themselves mid-game
  without a GM. Live: it is the whole filter behind the Remove Tag menu
  (`removableTags()`, `web/lib/tagRequests.js`) and is re-checked by
  `removeTagRequest`.
- `craftable` — whether this tag represents something a player can
  craft/make, as opposed to one that only ever arrives via role, GM grant,
  or automatic game logic. Live too: `addableTags()` offers Purchasable *or*
  Craftable tags in the Add Tag menu.
- `consumable` / `consumesInto` — whether a player can use this tag up, and
  what it becomes. Live; see §5b.
- `requirementTurns` / `requirementResources` / `requirementGambit` /
  `requirementSkills` (YAML: nested under `requirement:` as `turnsCost` /
  `resourceCost` / `gambit` / `skills`) — what it costs a character to add
  or remove this tag in play (e.g. curing Arthritis needs Medical (Skilled)
  and some turns; forging the revolver tag costs turns, resources, and
  Smithing). `requirementSkills` is a many-to-many self-relation onto `Tag`
  (multiple skill tags accepted), resolved in `syncTags.js`'s pass 5. This
  is mostly a GM adjudication reference, shown to players, with one
  exception: the Heal request (`HEAL_CHARACTER`, REQUESTS.md §5c) enforces
  the *removal* direction on `Status` tags — `requirementResources` is the ⬢
  it charges and `requirementSkills` is what the medic must hold (any
  equal-or-higher tier up the `parentTag` chain counts). Turns and Gambit
  stay reference-only everywhere, as do all four in the adding direction.
  One shared block covers whichever direction (add or remove) is
  narratively relevant to a given tag, rather than separate blocks per
  direction. Rendered everywhere a tag's description already renders, in a
  minified form, via `formatTagRequirement()` (`db/lib/formatTagRequirement.js`,
  exported from `@lifeweb/db`) — see `TagChip.js`, `PointBuy.js`, and the
  🔍-inspect embed in `bot/src/events/messageReactionAdd.js`.

## 5a. Stacks

Meals, ammunition, anything a crafting Move makes in a batch — a character
needs to hold four Fine Meals and hand them out one at a time. `stackable:
true` in `docs/tags.yaml` sets `Tag.stackable`; the count lives on
`CharacterTag.quantity` (default `1`).

**A stack is one row carrying a count, never N rows.**
`@@unique([characterId, tagId])` stays exactly as it was, which is the whole
point: every presence check in the codebase — `narrowcastAccess.js`,
`gambitModifier.js`, `mood.js`, `labor.js`, the Mortus nav gate — keeps
reading "holds it or doesn't" with no change, and `restoreCharacterTag`'s
upsert stays valid.

Three functions in `web/lib/requestEffects.js` are the only writers that know
about `quantity`; everything else goes through them:

| | |
|---|---|
| `addToStack(tx, characterId, tagId, n, opts)` | create-or-increment. Pins `n` to 1 unless `opts.stackable`, so a caller that forgot to check can't mint a phantom stack. |
| `dropCharacterTag(tx, characterId, tagId, n)` | decrement, deleting the row at 0. `n = null` (the default) drops the whole holding — what an ordinary tag always wants. |
| `restoreCharacterTag(tx, characterId, snapshot)` | undo's inverse. **Increments** on the update branch: `snapshot.quantity` is what the request took away, not what the character should end up holding. |

Add Tag, Remove Tag and Transfer Tag all carry a quantity, clamped
server-side to what the sender actually holds, and record it on
`Request.effect` so Undo stays an exact inverse (`REQUESTS.md` §2). A GM's
Revoke button takes one unit off a stack rather than the whole larder.

**Point-buy never stacks.** `PointBuy.js` is a toggle-set with no quantity
anywhere, so a bought tag lands on `quantity`'s default of 1 and a stackable
tag cannot be point-farmed at creation. Stacks are built in play only.

**`stackable` combines safely with `durationTurns`.** It didn't used to —
the sweep deleted whole rows, stack and all — but `sweepExpiredStacks()`
(`db/index.js`) now sheds a single unit per expiry and rerolls the
remainder's timer, deleting the row only when the last unit goes. So three
of a two-turn tag lose one every two turns.

## 5b. Consuming

`consumable` marks a tag a player can **use up** from their own character
sheet, and `consumesInto` (a list of tag *slugs*) is what it turns into. A
meal is `consumable` with `consumesInto: [ate-meal]`; `ate-meal` carries
`durationTurns: 1` and the Hunger pass consumes it — so the whole chain falls
out of machinery that already existed. Nothing here is meal-specific: the one
rule that *is* about meals (a Fine Meal cheers everyone but a noble) is
expressed as catalog data in `docs/tags.yaml`, not as code.

Five rules carry it:

- **Always exactly one unit.** Consuming from a stack of three meals takes
  one, so there is deliberately no quantity field in this path at all.
- **Slugs, not a relation, specifically so a slug may repeat.** Listing one
  twice is the only way to ask for two of something — and that only
  multiplies for a `stackable` target; a non-stackable repeat collapses to
  one, exactly like §5a's rules elsewhere.
- **A granted tag starts its own clock.** `expiresTurn` is computed as
  `turn.number + defaultDurationTurns` at the moment of the grant — the same
  absolute-turn expression every other writer uses — which is what makes
  chains work (meal -> Ate Meal that the sweep then clears).
- **An already-held non-stackable grant is left completely alone**, expiry
  included: the character's existing one is the live truth, and clobbering it
  would silently extend or cut short something they already had. One
  consequence worth knowing: eating a Lavish Meal while already Happy does
  *not* extend Happy, unlike `setMoodRequest`, which deletes and re-creates the
  tag and so refreshes its clock. Undo depends on `added: 0` meaning "this
  request didn't grant it", so a refresh here would need its own snapshot.
- **A grant may be conditional.** A `consumesInto` entry can be an object
  rather than a bare slug, and is then granted only to a character holding
  *none* of its `unlessTags`:

  ```yaml
  consumesInto:
    - ate-meal
    - slug: happy
      unlessTags: [nobility]
  ```

  `Tag.consumesInto` still stores every target slug in order; the conditions
  live beside it in `Tag.consumesIntoUnless` (`Json`, null for the many tags
  that have none), and `syncTags.js` validates both halves against this file.
  `resolveConsumeGrants()` in `web/lib/consumeGrants.js` applies them, and is
  deliberately pure so the server action and the client "Becomes:" preview
  share it — a preview that promised a noble the Happy they won't get would be
  worse than no preview. Fine Meal is the only conditional entry today:
  it cheers an ordinary person, while Nobility expect one as a matter of
  course.

Consuming is a **Request** (`CONSUME_TAG`), so it lands immediately, carries
a reason, and a GM can Undo it — see `REQUESTS.md` §3. The undo snapshot
records what was *actually* added per slug (`added: 0` for a grant that was
skipped as already-held), because Undo may only take back what this request
really put there.

`grantTagSlugs()` in `web/lib/requestEffects.js` is the single writer, a
fourth sibling to the three stack primitives in §5a.

**This replaces the old `grantsOnExpiry` ("expires into") field**, which did
the same conversion on a timer instead of on demand. It was removed outright:
letting the player choose *when* to unpack a crate is strictly better than
making them wait a turn, and two near-identical "tag becomes other tags"
mechanisms in one catalog is one too many.

## 6. Things that used to be tags and aren't anymore

`Leader` and `Treasurer` were retired as tags in the same rework that
introduced this system (and were finally removed from `docs/roles.yaml`'s
`starting_tags` too, in favor of per-role `leader:`/`treasurer:` booleans) — both are now plain booleans on `Character`
(`isLeader`, `isTreasurer`), assigned dynamically by a GM (Leader) or by a
GM/the faction's own Leader (Treasurer) from `/faction`
(`web/app/(app)/faction/actions.js`), exactly as before — only the storage
mechanism changed, not who can assign what. `Courtier` was deleted outright
(it only ever gated the now-ungated `Manor` tag). `Mortus` and `Hunter`
survived the "Role" category's retirement as ordinary tags (General and
Skills respectively) since both drive real logic elsewhere — Mortus gates
`/lifeweb` nav visibility, Hunter drives a production-tier check in
`bot/src/lib/labor.js`.

## 7. Where the code lives

`db/lib/syncTags.js` (the sync itself), `db/prisma/sync-tags.js` (terminal
entry point, `npm run db:sync-tags`), `docs/tags.yaml` /
`docs/taggroups.yaml` (content), `web/app/api/tags/route.js` (read API
backing `{tag:slug}`/`{tag:id}` references, and the gate from §3a),
`web/app/components/RichText.js`/`TagsProvider.js`, `TagChip.js` (the
hover-tooltip chip that renders group color), and
`db/lib/inspectVision.js` (Seductive/Torturer, §5).

**Tag descriptions carry `{tag:…}`/`{resource:…}` tokens too**, not just
documents — that's how a True Form names the {tag} it inflicts. The three
places a description renders all forbid an *interactive* chip, though: a
`TagChip` nested in a hover tooltip could never be hovered to reach its own
tooltip, and the point-buy / Add Tag rows are `<button>` elements. So they
render through `ChipText.js`, which resolves the same tokens to a plain
`ChipLabel`. `RichText.js` stays the full-fat renderer for prose the reader
can point at (documents, a character's appearance). Both share the parser in
`richTokens.js` — which exists in its own file precisely because `RichText`
renders `TagChip` and `TagChip` renders `ChipText`, so importing one from
the other would close an import cycle.

`hunger`, `hungerless` and `ate-meal` are the first tags granted and consumed
by automatic game logic rather than by a player, a GM, or a starting package —
`db/lib/hungerPass.js` is their only writer, and `db/lib/gambitModifier.js`
their only reader. `db/lib/constants.js` holds the slugs so neither file
hardcodes a string.

## `equippable` / `concealsIdentity`

`equippable: true` marks a tag as something a character can wear or carry
readied, and so occupies one of `GameConfig.equipSlots` (default 6). The state
lives on `CharacterTag.equipped`, not on a join table: equipping is a property
of holding the tag, so `@@unique([characterId, tagId])` stays and every
"holds it or doesn't" check in the codebase is unaffected. A `stackable` tag
takes one slot however many units are held.

`concealsIdentity: true` marks gear that hides who the wearer is — a mask, a
hood, a closed helm. It is currently **inert**: `/conceal` is open to every
character with nothing equipped (see "Equipment and concealed identity" in
`CLAUDE.md`), and the field is kept only so that gate can be restored without a
migration. It is only meaningful
alongside `equippable`, and `syncTagsFromYaml` **throws** if it is set without
it rather than syncing a tag that could never do anything — the kind of quiet
failure that is miserable to debug from inside the game.

Neither field interacts with `visible` (`Tag.visibleOnInspect`), which does
double duty here: a concealed character's 🔍 embed lists only their
`visibleOnInspect` equipped gear and their `visibleOnInspect` health statuses,
so a hidden cuirass stays hidden even while worn.
