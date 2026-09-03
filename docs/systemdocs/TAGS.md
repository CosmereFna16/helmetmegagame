# Tag catalog

How the `Tag`/`TagGroup` catalog is structured, master-sourced, and synced.
Not to be confused with `CharacterTag` (an individual character's *holding*
of a tag). The old `Location.tags` free-text flavor strings went with
Locations themselves; nothing like them exists on a Zone.

## 1. Category -> Group -> Tag

Three levels:

- **Category** — a flat string (`Meta`, `General`, `Skills`, `Status`,
  `Items`, `Assets`, plus the one hidden one, `Demoness`).
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
  freeform hex string (e.g. `"#6fa8ab"`), rendered directly by
  `web/app/components/ChipLabel.js` (used by `TagChip.js`)
  — not theme-aware, so pick a value that reads on both the dusk and dawn
  backgrounds. Three groups are deliberately **empty**:
  `status-health` (the Health category, §5c, took every tag that used to live
  in it) and `general-restrictions` / `general-interests` (merged into
  `general-personality`, `DESIRES.md` §5). Groups sync upsert-only and are
  never deleted by the sync — `db:prune-tags` will prune one once it's
  absent from `docs/taggroups.yaml` and no surviving tag sits in it, but
  these three stay listed there, so the rows survive; don't reuse those
  slugs and don't put anything back in them.
- **Tag** — the catalog entry itself.

## 2. Master sources: `docs/tags.yaml` and `docs/taggroups.yaml`

`docs/tags.yaml` holds categories and tags; `docs/taggroups.yaml` holds the
`TagGroup` catalog (split into its own file so group colors can be freeform
hex rather than a fixed token set). Same posture as `docs/zones.yaml`:
hand-edited, `slug` is the stable match key across syncs, and syncing is
**upsert-only** — removing an entry from either YAML never deletes its row
by itself, it just stops receiving updates. The separate, opt-in
`npm run db:prune-tags` (§3b) is what actually deletes: it prunes a tag
absent from `docs/tags.yaml`, and once no surviving tag sits in it, a group
absent from `docs/taggroups.yaml`. `db/lib/syncTags.js#syncTagsFromYaml(prisma)`
reads both files and does the sync, run by hand via `npm run db:sync-tags`
(`db/scripts/sync/sync-tags.js`) or automatically at the end of `wipeGameData`'s
"Restart Game" flow (`web/app/(app)/gm/dev/actions.js`), right after
`syncZonesFromYaml` and the special-channels sync.

The sync is five passes, since tags/groups can reference each other by slug
before every row necessarily exists yet: TagGroup scalars, then Tag scalars
+ `groupId`, then `parentTag`/`requiredTag` links, then `TagGroup.requiredTag`
links, then `requirement.skills`. (`consumesInto` is the exception — it is
validated up front against the YAML's own slug set, before any write, so a
typo fails cleanly instead of half-applying.) Each pass only writes a row when something actually changed (a
diff check, same style as the zone sync's hash gate).

### A slug is its name, slugified

`slug` is the name lowercased with punctuation dropped and spaces/colons
turned into hyphens: **Old Ways (Bacchus)** is `old-ways-bacchus`, **True Form:
Serpent** is `true-form-serpent`. `syncTags.js` throws when a tag breaks the
rule, so renaming a tag means renaming its slug in the same pass — and then
every reference to it, since the slug is what desires, taggroups and code
match on. (Names themselves are never referenced that way, with two
exceptions: `roles.yaml`'s `starting_tags` and `documents.yaml`'s `tags` both
resolve tags **by name**.)

The one carve-out is a hidden category (`demoness`), where a
generic power name would collide with a general tag: those may lead with the
category instead, as `demoness-heal` and `demoness-seductive` do.

## 3. Two relations that look similar but aren't


- **`parentTag` (tier chain)** — sequential, replacing. Melee (Basic) ->
  Melee (Trained) -> Melee (Skilled) -> ... Acquiring a tier is meant
  to replace the previous one on the character, not stack alongside it.
  `Laborer (Skilled)` chains off `Laborer (Basic)` the same way.
- **`requiredTag` (prerequisite)** — non-replacing. The character must
  already hold `requiredTag`, but acquiring this tag does **not** remove or
  replace it. Example in the catalog: `Ranged (Archer)` requires
  `Ranged (Basic)` but coexists with `Ranged (Skilled)` — a character can
  hold both at once. Also the right relation for an origin/membership gate the
  gated tag doesn't consume: `Manor` requires `Courtier`, `House`/`Shack`
  require `Ravenhearter`, and
  `Laborer (Farming)` requires `Laborer (Skilled)` — a sidegrade that coexists
  with the tier it builds on.

  One exception: on a **craftable** item, `requiredTag` is a combat/use
  gate, not a workshop gate, and the Add Tag menu's craft route does not
  check it — see §3b.
- **`TagGroup.requiredTag`** — the group-level version of the same
  prerequisite: every tag in that group stays gated behind one required tag,
  so a whole category-of-flavor can be hidden behind a single membership tag
  without repeating `requiredTag` on every tag in it. See §3a.
- **`Tag.exclusive`** — not a relation at all, but the third rule the same
  callers enforce: a character may hold at most **one** tag carrying this
  flag **per tag group**. Set on the nine Beliefs (`general-beliefs`), which
  are a single answer rather than a collection, and on the five Addictions
  (`general-addictions`) — so a character holds at most one belief and at most
  one Addiction, independently. **Nothing in `general-personality` carries it**:
  the 2026-09-01 merge dropped it from the nine ex-Restrictions on purpose, so
  Pacifist + Craven is now a legal character. That is what makes the merged
  group actually merged — leaving the flag on would have kept "one Restriction
  max" alive inside a group that no longer looks capped. Neither of the two above could express it — a `parentTag` chain
  is priced cumulatively and walks one direction, and `requiredTag` is a
  prerequisite rather than a conflict. The one exemption is a pair joined by
  `requiredTag`, checked in both directions: Fundamentalist declares
  `requiredTag: post-christian`, so the two are one belief taken to its
  extreme. `exclusiveConflict(tag, heldOrSelectedIds, byId)` in
  `web/lib/characterCreation.js` returns the conflicting tag or null, and
  every caller's `select` must include `exclusive`, `groupId` and
  `requiredTagId` or the rule silently stops applying (or, missing `groupId`,
  applies across groups). In `PointBuy` a conflict with another *pick*
  swaps (like a chain sibling); a conflict with something already held is
  dimmed and named. Conversion mid-game is "drop one, buy another" — Beliefs
  stay `removable` — and the store's error says exactly that.
- **`Tag.conflictsWith`** — a named pairwise conflict, distinct from
  `exclusive`'s at-most-one-per-group rule: it isn't scoped to a group and
  isn't carved out for a `requiredTag` pair, so it's the right tool for a
  conflict that crosses groups or crosses the belief/drawback line — every
  Addiction lists `conflictsWith: [depressed, prudish]`
  so, say, Alcoholic and Depressed can't stack. Authored one-directional in
  `docs/tags.yaml` and symmetrized by `db:sync-tags` (pass 6, §2), so a
  caller only ever has to check one side; a **custom** GM tag's edge is not
  guaranteed symmetric, which is why `db:prune-tags`'s blocker check reads
  both directions. `conflictingTag(tag, heldOrSelectedIds, byId)` in
  `web/lib/characterCreation.js` is the enforcement predicate, same
  shape/bypass posture as `exclusiveConflict` above — every caller's `select`
  must include `conflictsWith`/`conflictsWithIds`. The one-per-group rule the
  Addiction and Restriction groups themselves enforce (at most one of each)
  is plain `exclusive`, not this field — `conflictsWith` is only for the
  cross-group edges.
- **`Tag.excludedRoleSlugs`** — the one gate that ignores what a character
  holds and looks at their **seat** instead. Authored in `docs/tags.yaml` as
  `excludedRoles: [migrant, mercenary, …]`, a list of role slugs from
  `docs/roles.yaml` (validated against that file by `db:sync-tags`, so a typo
  throws rather than quietly opening the gate). Devoted Follower is the first
  and only user: a Migrant, a Mercenary, a Bum, an Outsider or a Pusher has
  nobody to be devoted to. Plain slugs rather than a `Role` relation, because
  `db:sync-roles` rewrites Role rows and the slug is the stable key the rest
  of the codebase already matches seats on (`CURSED_ROLE_SLUGS`).
  `roleExcluded(tag, roleSlug)` is the predicate. Because it never depends on
  the rest of the build, `purchasableTags()` drops the row from the menu
  outright rather than dimming it — so `PointBuy` takes a `roleSlug` prop from
  both mount sites (the creation wizard's chosen role, and the store's
  `storeRoleSlug` threaded down from `/character`). `createCharacter` and the
  store's `buyTags` re-check it. A GM grant bypasses it, like every gate here.

`web/lib/characterCreation.js` is where the logic lives.
`holdsRequirement(requiredTagId, …)` answers "is this one id satisfied by
anything held or selected, at any tier of its chain"; `requirementSatisfied`
calls it for **both** `tag.requiredTagId` and `tag.group.requiredTagId`, and
is the only place the two are combined. `chainOf`/`cumulativeCost`/
`effectiveCost` price a `parentTag` chain as the sum of its hops, and
`chainSiblingsToRemove` collapses a selection down to one member per chain
(the tiers **below** a pick, since `chainOf` only walks upward), and
`heldHigherTiers` is its downward mirror — the held tiers **above** a tag,
i.e. "is this a downgrade". A chain replaces upward and never re-opens
downward: buying or adding a higher tier **deletes the held lower tier in
the same transaction** (the store's `buyTags` and `addTagRequest` both do
this), and every purchase path rejects a tier below one already held. The
removed tier is snapshotted onto the request's `effect.replaced`, so a GM
Undo restores exactly what came off — see `web/lib/requestEffects.js`.

Enforced in these places, all reading those same helpers: `PointBuy.js`
(creation and `/store`), `createActions.js#createCharacter` and
`store/actions.js#buyTags` (the server-side re-checks, since the menu is
advisory), and `web/lib/referenceData.js#getVisibleTags` (§3a). **A GM grant
still ignores both, deliberately** — a GM handing out a tag is the one path
that should never be second-guessed.

The Add Tag picker in `RequestActionsProvider.js` and its server re-check,
`requestActions.js#addTagRequest`, are the **exception** — see §3b, which
covers a different question (can you make this, not can you use it) with a
different predicate.

Every caller must select `group.requiredTagId` alongside `requiredTagId`.
Miss it and a hidden category silently opens for everyone, with nothing to
show that it has.

### `desires:` locks

A fourth field, `Tag.desireLocks` (YAML: `desires: { locks: [...] }`), is
**not** a relation onto another tag at all — it locks parts of the *Desire
catalog* shut for whoever holds it. Full writeup, including the clause
grammar and how several held tags' locks union together: `DESIRES.md` §3.

## 3b. The Craft menu asks a different question

`requirementSatisfied()` answers "can you **use** this" — the right question
for creation and `/store`, where the whole catalog is bought outright. The
Craft menu (Add Tag, renamed and reworked — `CRAFTING.md`) asks "can you
**make** this" instead, and now it actually checks: the recipe's
`requirement.skills` must be held, or a higher tier of one, the same walk Heal
uses (`db/lib/medicalVision.js#satisfiedSkillIds`). This replaced an earlier
honor-system door where the menu asked almost nothing and the pushed request's
GM review was the only enforcement — that version was a deliberate choice at
the time (a smith with no combat skill forging weapons to sell, a fighter
pulling gear from an armoury the fiction gives them, situations no skill check
could see), but it also meant nothing stopped a player who held no relevant
skill at all. The recipe check now runs server-side; the picker's "To make: …"
line still shows the recipe, but it's the gate, not just advice.

The Craft picker and `craftRequest` therefore don't call
`requirementSatisfied`. They call
`addRequirementSatisfied(tag, tagsById, heldTagIds)` in
`web/lib/tagRequests.js`, which is now **one route onto a tag**:

- **Make it** — `craftable`, plus the recipe's `requirement.skills`
  (`CRAFTING.md` §2). The picker's `knownRecipeIds` shows only recipes whose
  skills you hold; `craftRequest` re-derives the same check before writing
  anything. `resourceCost` is charged up front to a payer (yourself, a Room
  stash here, or a person here); `turnsCost` decides Dead Simple / Routine /
  multi-turn `CraftProject`.

There used to be a second route — **buy it**, `purchasable &&
purchasableAfterStart`, gated on the item's own `requiredTagId`. It is gone.
It offered 155 tags (46 Skills, 60 General, 23 Bacchus, 15 Demoness, 10
Assets, 1 Item), every one of them also priced in `/store`, and Add Tag costs
nothing but a written reason — so it was strictly cheaper than paying Tag
Points for the same tag, and the request log showed players taking it that
way. A menu whose own help text has to ask players not to abuse it is a menu
with the wrong contents. Buying is now `/store`'s job alone.

The **group gate still applies, unconditionally** — same as everywhere else,
it's the hidden-category mechanism and is never bypassed. A Demoness
craftable stays invisible outside the category.

`requirementSkills` is an **OR** list, not an AND: every multi-skill recipe
in `docs/tags.yaml` is a Dead Simple item written `[smithing, crafting]`
specifically so either skill qualifies (`db/lib/formatTagRequirement.js`
joins the list with `/`; SMITHING.md §2 spells the rung's gate as "`crafting`
OR `smithing`"). The picker's "To make:" line renders the list joined with
"or", and `isDeadSimple()` (`web/lib/requests.js`) reads the slugs for the
4-per-turn cap — so callers still select `requirementSkills { name, slug }`,
just no longer as a gate.

## 3a. Hidden categories, and gated groups

**Two tags gate an action rather than an item: `bird` and `literate`.** Holding
both puts the Bird on the Actions grid; holding `literate` alone puts the Read
button there (`BIRD.md`). `literate` is also the key to
`db/lib/gribble.js`, the cipher any future literacy feature should reuse rather
than reinvent — a written thing an illiterate character cannot read should look
the same everywhere in the game.

One whole category is secret: **Demoness** (behind the `demoness` tag). It
contains exactly one `TagGroup` carrying the `requiredTag`, which is where
the whole mechanism lives — the tags inside deliberately do **not** repeat
`requiredTag`, so the gate is written once. (The Cult of Bacchus used to be
a second hidden category, gated the same way behind `cultist`; it's archived
in `docs/archive/bacchus.yaml`, and the mechanism below applies to any future
hidden category the same way it applied to that one.)

The same field also gates a group **inside a visible category**, which is how
body membership is modelled: `general-watch` ("The Watch", behind `watchman`)
and `general-brigand` ("Brigands", behind `brigand`) sit in `general`, so the
General tab stays because `general-traits` and `general-social` are ungated —
only the group vanishes. Same rule about not repeating the gate on the members.

Note where the two keys live: `watchman` and `brigand` are in
`general-traits`, **outside** the groups they open. A gated group cannot hold
its own key — nobody would ever be able to see it. Both are
`purchasable: false` and arrive from `roles.yaml` `starting_tags`, which is
also why the Add Tag picker has to fold held tags into its `byId` map (below).

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
- **`getVisibleTags` withholds them.** That loader
  (`web/lib/referenceData.js`, streamed through `TagsProvider` from
  `layout.js`) is the app-wide tag catalog `RichText`/`TagChip` read, and
  its `/api/tags` predecessor used to be unauthenticated and complete,
  so the whole Demoness catalog was one DevTools tab away. It resolves
  the caller's own character and drops any tag whose group is gated. Gating
  is on the **group** gate only, never a tag's own `requiredTag`: Ranged
  (Archer) isn't a secret, and hiding it would break `{tag:ranged-archer}`
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
| Frail | `-5` | `+5 pts` | `--positive` (pool grows) |
| Melee (Basic) | `7` | `-7 pts` | `--accent` (pool shrinks) |
| Shack | `0` | `0 pts` | `--muted` |

These two functions are the only place that flip lives — every caller
(`TagChip`, `PointBuy`, `RequestActionsProvider`, `CreateCharacterWizard`) passes
the raw signed `pointCost` and lets them decide, so nothing else should ever
negate it. The arithmetic is untouched: `PointBuy`'s affordability check and
`remaining = budget - sum(pointCost)` both still read the raw catalog value.

Before this, the sign was catalog-style while the colour was pool-style, so
Frail read as "`-3`, in green" — two conventions disagreeing on one line.

A character's budget is
`GameConfig.startingTagPoints` (default 12) `+ role.extra_starting_points`
`- 6 if the player is Cursed`, computed by
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
`purchasableAfterStart: false` — *unless* it is deliberately farmable, in
which case it must also be non-removable.** A drawback that can be bought
mid-game and then shed is a point farm, because `REMOVE_TAG` and
`CONSUME_TAG` refund resources but never Tag Points. A deliberate exception
is possible — a negative tag that's `purchasableAfterStart: true` but also
`removable: false, consumable: false`, so it can be taken for the points but
never shed — but nothing in the current catalog uses it (the four
Addictions did, before the Cult of Bacchus was archived). The flag is the
whole rule — there is no second, hardcoded refusal behind it.

That invariant has three enforcement points. `purchasableTags()` honours it
via `PointBuy`'s `afterStartOnly` prop, which **`/store`** mounts — the
mid-game store is routed (`web/app/(app)/store/`), spends
`Character.tagPoints`, and files each cart as one `BUY_TAGS` request
(`REQUESTS.md`). Its server action `buyTags` re-checks the flag per tag,
rejects a tier at or below one already held (`heldHigherTiers` /
`effectiveCost`), and replaces the held lower tier when a higher one is
bought (§3). It does **not** refuse a negative effective cost: it used to,
and that belt-and-braces line was what made the Addictions unbuyable despite
their flag. A negative cart total is credited rather than debited (the write
guards on `totalPoints !== 0`, not `> 0`). The drawback POINT cap (§4a) is a
creation rule only — `/store` passes no cap at all. `/store` is therefore the
**only** menu `purchasableAfterStart` still governs: the **Craft request**
(Add Tag, renamed), the other mid-game path, no longer reads the flag at all.
`addableTags()` test `craftable` and the recipe's `requirement.skills`
(`craftRequest` server-side re-checks both — §3b), which is why most
craftables being deliberately `purchasableAfterStart: false` (43 of 58 —
meals, tonics, explosives) costs them nothing. They are made rather than
bought, and their `requirement` block is the recipe Craft now enforces, not
just GM-review guidance (§3b). No drawback is craftable, so no drawback can
arrive through Craft.

The two mid-game paths deal in different currencies and coexist on purpose:
the store spends Tag Points against catalog prices with no GM in the loop
until review; Add Tag spends turns, skills and ⬢ against a `requirement`
block. They no longer overlap — a tag with a point price is bought, a tag with
a recipe is made, and nothing is both. Armor and weapons showing up under Add
Tag is the crafting economy, not a store leak.

**The Assets are creation-only.** Horse, Bird, Rat, Kitty Cat, Dog, Manor,
House and Shack are
`purchasableAfterStart: false`, so they leave `/store` as well as Add Tag —
mid-game a horse or a house comes from a GM grant, another player, or the
Depot, not a menu. To keep the "another player" half real, the property
tags (Manor, House, Shack) are `tradeable: true`; the companions and Cart
already were. The Plow joined them when it moved out of Items, so it stopped
weighing on a farmer's back (SMITHING.md §3); the Workshop asset was retired
outright in favour of the Workshop Equipment **item** you have to haul
(SMITHING.md §2a).

**Assets weigh nothing**, which is the mechanical point of the category:
a horse carries itself and a house does not move, so neither belongs in
`carryWeight` (CARRY.md §1). Note what that costs, because `tradeable` is
one flag covering both directions (§5): a house deed can now be lifted off a
corpse. That is the accepted price of being able to hand one over.

Full writeup of creation, roles, and the wizard: `CHARACTERS.md`.

## 4a. The price scale

**This is the canonical scale. Price a new or repriced tag against it, not
against whatever its neighbours in the file happen to cost.** The catalog
drifted for 260 tags precisely because the scale was unwritten, and the
inconsistencies that turned up on the first pass against it — a revolver at 4
points, Starting Wares at 4 while consuming into 7 points of goods — were the
kind that only look wrong once there is something to check them against.

The scale is **absolute across categories**. A 3-point item and a 3-point
skill are meant to matter about equally, so "expensive for an item" is not a
reason to price one at 5.

| `pointCost` | Band |
|---|---|
| 2 | Minor. A small edge, a small possession, a narrow competence. |
| 5 | Moderate. A real capability; one rung of a skill chain. |
| 7 | Significant. Reliably changes how a scene goes. |
| 9 | Good. Three-quarters of the default budget. |
| 11 | Very good. |
| 14 | Character defining. The revolver; Giant. |
| −2 | An inconvenience. |
| −5 | A real cost, situational. |
| −7 | A real cost, most of the time. |
| −9 | Severe. Permanent or near-permanent. |
| −11 | Removes a whole sense or capability, with no realistic cure. |

14 is the ceiling and −11 the floor; nothing should be priced outside them
without a deliberate decision recorded here. **Pilgrim is the one deliberate
exception, priced at 1** — off the scale entirely, Gunboat's call. **Pack
Mule is the other, at 4** — between the 2 and 5 bands, Bascinet's call when
the carry caps landed (`CARRY.md`). **Teaching (Drill Instructor) is a third,
at 3** — between the 2 and 5 bands, Bascinet's own call, the same kind of
deliberate outlier as Pack Mule; don't read a pattern into it. Teaching and
Teaching (Lecturing) sit on-scale at 5 each, the ordinary Moderate band
(`LESSONS.md` §1).

**At character creation, a character may buy at most
`GameConfig.maxDrawbackTags` drawback TAGS — 5 by default, live on
`/gm/dev`.** The cap belongs to the wizard and stops existing once play
starts: `/store` passes no cap and shows no drawback readout, since the one
drawback it can sell (an Addiction) is meant to be sellable. This is a cap on
the **count** of drawback tags held, not on their combined point value: a
character with one −8 drawback and one with eight −1 drawbacks now spend a
different slice of the cap (the field replaced the old `maxNegativeTags`,
which — despite its name — summed points; `maxDrawbackTags` does what the
old name always claimed to, for real; the `drawback_tag_cap` migration,
Desires rework). Only what was bought through the point-buy menu counts
(`CharacterTag.source === "POINT_BUY"`): a role's free drawback (the
Meister's Frail, the Headman's Old) arrives as `GM_GRANT`, and so does
anything a GM or a turn effect inflicts, so neither eats into a player's
count. A GM grant can still push someone past the cap, deliberately — the
same bypass every other gate has (§3). `0` is a real setting: no drawbacks
at all.

The cap has three surfaces. `PointBuy.js` sums it live in the build pane
(`negativeCap` / `negativeHeld`), shown in red once the count is over the
cap (`{used} / {cap} drawbacks taken`), dims a drawback that would push the
count past the limit the same way it dims an unaffordable tag, and — like
the budget — lets the click through so the pane can say why the build isn't
legal. `CreateCharacterWizard` folds it into `canAdvance` beside
`remaining >= 0`. `createCharacter` re-checks it server-side, because a
server action is a public endpoint. `/store` shows the same line as a
**readout only**: every drawback is `purchasableAfterStart: false`, so the
shelf never offers one and the total can't move there. `negativeTagCount()`
in `web/lib/characterCreation.js` is the shared predicate, counting tags
with a negative `pointCost` rather than summing `effectiveCost` — a drawback
never sits in a tier chain, so there is nothing to discount.

**0 is a real price, not a missing one**, and it is the most common value in
the file (142 of 268). Everything unpurchasable — injuries, statuses, meals,
role grants — is 0, and every tag must carry the field explicitly. A tag with
no `pointCost` at all is a bug; `intercom` was the one instance, and that tag
has since been deleted outright along with the channel it opened.

### Rules that follow from the scale

- **Addictions and Personality (`general-addictions`,
  `general-personality`) run their own bands, off the same scale.**
  Addictions a flat −4, Personality −8…+5. ‡ The rationale is income-based, not
  severity-based: the price tracks how much of the Desire catalog a tag closes
  against how much it opens. Depressed closes everything and opens nothing, so
  it sits at the floor at −8; Eunuch closes exactly one family and sits at −1.
  Pacifist stays at −2 even though it now opens two Desires of its own, because
  what it opens is narrow and what it forbids is not. An Interest-shaped tag is
  positive because it is pure upside — it widens the catalog with no lock
  attached.

  Addictions are flat rather than a band as of 2026-09-02, when each one
  stopped closing a slice of the whole catalog and started closing exactly one
  thing: the **bottom Desire slot**, to everything outside its own family
  (`DESIRES.md` §3). The old −3…−6 spread priced how much of the catalog each
  shut, and that variable no longer exists — all five now do the same amount of
  damage, so they cost the same.

  **A Personality tag may be negative AND open Desires.** That is the whole
  point of the 2026-09-01 merge that replaced `general-restrictions` and
  `general-interests` with one group; before it, a Restriction was defined as
  a pure dead end. See `DESIRES.md` §5.
- **No drawback is purchasable after start.** Every negative-`pointCost` tag
  carries `purchasableAfterStart: false`, `/store` enforces it server-side,
  and fulfilling a Desire is therefore the only mid-game Tag Point faucet.
  This is what closes the buy-a-drawback → get-cured → keep-the-points loop
  at the door (`DESIRES.md` §7).
- **Skill chains are flat 5 per rung and charged cumulatively**
  (`cumulativeCost`, §3). Do not price a rung off-ladder to make a chain
  cheaper; shorten the chain.
- **Melee and Ranged are the one exception — 7 per rung, Legendary at 14.**
  The Combat Update split the old Fighting ladder into two trees,
  `melee-basic..melee-legendary` and `ranged-basic..ranged-legendary`, in the
  `Combat` group. Rungs are still cumulative, so Melee (Legendary) and Ranged
  (Legendary) are each 42 (7+7+7+7+14) — unreachable from a 12-point creation
  budget by design; you climb into it in play. Sidegrades cost 10 (~1.4x a
  rung) and use `requiredTag` on their tree's Basic, so they are *not*
  cumulative and stack with each other and with any rung: Melee (Shield Wall,
  Duelist, Polearms, Swords, Clubs) and Ranged (Archer, Firearms). Melee
  (Flamboyant) is priced at 7, not the usual 10 — the "without armor"
  condition is a real cost of its own, unlike the other sidegrades'
  situational-but-free conditions. Two sidegrades sit outside both
  trees: Grappler (5, standalone — bare hands are not a rung of either tree,
  so it gates on nothing), and Guerrilla (10, standalone and deliberately
  ungated, since a single `requiredTag` can't say "either tree").
- **Combat items ride a fixed six-tier ladder.** Weapons and armor are priced
  from the tier they sit in, not by feel. See
  [`SMITHING.md`](SMITHING.md) for the table.
- **Every negative tag is `purchasableAfterStart: false` unless it is
  deliberately farmable, in which case it must be non-removable.** Restated
  from §4 because it is the one invariant the scale can be used to violate: a
  drawback that can be bought mid-game *and* shed is a point farm. The four
  Addictions are the deliberate exception and carry `removable: false,
  consumable: false` to close the loop.
- **Items are `purchasableAfterStart: false` too**, without exception. An
  object enters play by being crafted or found; its route in is `craftable`
  plus a `requirement` block, never points. 18 items violated this before the
  first pass against the scale.
- **A consumable is worth what it consumes into.** If `consumesInto` grants
  7 points of tags, the container is not a 4-point tag.
- **Health-category `pointCost` is not a wound severity.** It answers "what is
  this worth at character creation" — 0 for almost all of them, since they are
  not purchasable. What the condition costs to *treat* is the `requirement`
  block, priced off the seven-rung cure ladder in §5c, which is a separate
  scale that must not be conflated with this one.
- **A skill's price is not adjusted for how much content gates on it.**
  `crafting` (5) gates 3 items where `smithing` (5) gates 23. Both stay at 5;
  the fix for that imbalance is content, not price. Noted here so the gap
  reads as known rather than accidental.

## 5. Other fields

- `visible` (`Tag.inspectVisibility`) — whether another player who 🔍-reacts
  to this character's proxied messages sees the tag
  (`bot/src/events/messageReactionAdd.js`). **Three states**, and the YAML
  says them in words:

  | `visible:` | Column | Means |
  |---|---|---|
  | `false` (default) | `HIDDEN` | Never seen. |
  | `true` | `ALWAYS` | Seen whether it is equipped or not. |
  | `worn` | `WORN` | Seen **only while `CharacterTag.equipped`**. |

  **THE RULE, and it is catalog-wide.** `visible: true` means *a stranger
  looking you over would notice*: your body, your face, your gait; your
  clothes and anything large enough that you are visibly hauling it; and a
  reputation already attached to your name in public (Disgraced, Wanted,
  Knighted). **Never** your appetites, your beliefs, your opinions, your
  skills, or your secrets. Hot-Headed, Pacifist, Alcoholic, Eunuch, every
  Belief and every Skill in the catalog are `false`, and that is not an
  oversight — a temper is a thing you find out about someone, not a thing you
  see. The test that settles most arguments is a neighbour: if an
  identical-severity tag two rows away disagrees with you, one of the two is
  wrong. (Feverish was hidden while Infected and Festering were visible;
  Consumptive was hidden while Persistent Cough was visible; Mute was hidden
  while Silenced and Wired Jaw were visible. All three were the same mistake.)

  Health has its own second rule on top of this one — a medic sees what they
  could treat, whatever `visible` says. See §5c, "Visibility, and the
  doctor's eye": that is why an internal illness can safely be `false`
  without becoming undiagnosable.

  `worn` is the concealable middle: a dagger in a pocket is nobody's
  business, a drawn one is, and a badge left at home is a badge you are not
  displaying. It only means anything on an `equippable` tag, so
  `syncTagsFromYaml` **throws** if it is set without one — the same pairing
  discipline as `concealsIdentity`, and for the same reason. See the
  `equippable` section below for the item-by-item rule of thumb.

  Read it through `seenByBystander()` (`db/lib/medicalVision.js`), never by
  comparing the enum at a call site: both of the bot's embeds route through
  that one predicate so they can't drift on what "visible" means. The column
  was renamed off `visibleOnInspect` on purpose when the third state landed —
  a tri-state under the old name would have been *truthy* for `worn`, so every
  surviving `if (tag.visibleOnInspect)` would have leaked every stowed weapon
  the day the migration ran. Under a new name a missed read site gets
  `undefined` and the tag stays hidden. A vision gate should fail closed.

  Note it is a property of the tag being *seen*. The tag that widens what an
  inspect shows is read off the **inspector** instead: Seductive reveals the
  subject's active Desire, resolved by `db/lib/inspectVision.js`, which also
  accepts the discounted Demoness twin. Like the officer-gated Resources
  field (`FACTIONS.md`), an unseen field is absent rather than placeholdered — a placeholder
  advertises that there is something to go after.
- `exclusive` — at most one such tag per character *per group*. Set on the nine Beliefs;
  see §3 for the rule, the `requiredTag` exemption, and where it is enforced.
- `carryMultiplier` — **live**: multiplies both carry caps while held (Pack
  Mule 1.5, Cart 5; they stack). `null` for the rest of the catalog. A
  description ending in `{carry:slug}` renders the exact bonus from the live
  config. `db:sync-tags` rebases every holder afterwards so an edited
  multiplier never reads as "your Cart just left". See `CARRY.md`.
- `tradeable` — **live**: whether the tag can change hands at all. It is
  also what counts against the item carry cap — every unit of every
  tradeable tag (`CARRY.md` §1). One flag
  covers both directions — handing it to someone standing with you
  (`TRANSFER_TAG`) and lifting it off a corpse or a helpless body
  (`LOOT_CHARACTER`). `web/lib/tagRequests.js#isTradeable` is the single
  reader; the Hand Over menu, the Loot dialog's per-target tag list, and both
  server actions all go through it, so the menu and the gate can't drift.

  It used to be a category test — `["Items", "Assets"]` — from back when the
  field was set on almost nothing. That was wrong in both directions at once.
  It let a corpse be stripped of its **House**, its **Manor** and its
  **Drone**, none of which are things you carry away from a body; and it
  ignored the sixteen Items that already said `tradeable: false`, including the
  Quickened Nerve Braid, which is *grafted into the holder's neck*. The catalog
  had been carrying the right answer for months and nothing read it.

  Office regalia (the Bishop's Mitre, the Sheriff's Badge, the clan banners) is
  deliberately `true`. Prying a badge off the body of the man who held the
  office is exactly the kind of thing the game is for, and because this is one
  flag, that also leaves it giftable — which is how it has always behaved, so
  nothing regressed. Splitting give from take would be a second field and a
  migration; do that only if handing an office over by dropdown turns out to be
  a real problem in play.

  `syncTags.js` **throws** if a tag in `items` or `assets` omits the field.
  It reads as `?? false`, so silence would sync a new sword as unmovable and
  nobody would find out until a player couldn't hand over the thing they had
  just forged. Every other category still defaults to `false` — a skill or an
  injury is not a thing you carry. The same trap exists for GM-made tags on
  `/gm/dev/tags`, where the checkbox defaults off; its label spells out the
  consequence rather than relying on the GM knowing.

  One tag outside Items/Assets sets it: `detonation-charge`, a keg of dynamite
  filed under `general`. The old category test blocked it; it is transferable
  now, which is correct.
- `forcesName` (`Tag.forcedName`) — a name the holder is **forced to wear**.
  Apex Form sets it to `Beast`. While any held tag carries one, the character
  proxies under that name with the letter plaque for its initial, Who's here?
  and 🔍 name them that way, and `/conceal` is refused. See "`forcesName`"
  under `equippable` / `concealsIdentity` below, and `PROXYING.md` §5.
- `sellable` / `sellablePrice` — the seller's half of
  `purchasable`/`purchasableAfterStart`: whether the Merchant's Depot will
  buy this tag off him, and for how many ⬢. Added for the Caves Update
  (`CAVING.md` §6) and inert until the Merchant Update, which built the
  counter that reads it (`DEPOT.md` §4). `syncTags.js` requires the two to
  travel together: `sellable` without a positive `sellablePrice` is an error,
  and so is a price set without `sellable: true`.
- `depotPrice` — the buy side of that counter: what the Depot **charges** him
  for one (`DEPOT.md` §3). Null means the station does not stock the tag,
  which is the case for everything Ravenheart makes itself. It travels with
  nothing else — carrying a price is what puts a ware on the shelf — so
  `syncTags.js` only checks it is positive, and warns without throwing if it
  is at or under the same tag's `sellablePrice`, since buying and selling one
  thing in a loop would print ⬢.
- `stackable` — whether a character can hold more than one at a time. Live
  code reads this; see §5a.
- `defaultDurationTurns` (spelled `durationTurns` in the YAML) — catalog-level "how many turns does this last once
  granted," for tags that auto-expire (e.g. Drained is 3). The actual
  per-instance expiry lives on `CharacterTag.expiresTurn` (an absolute turn
  number, computed from this default at grant time), swept by
  `resolveNeeds()` in `db/index.js` once the closing turn's number reaches
  it. Live code reads this — Hunger (1) and every tonic effect compute their
  `expiresTurn` through `expiryFrom` — so it is no longer catalog-only.

  **N turns means N turns, counting the one it was granted in.** The expiry
  turn is itself a turn the tag is live for, because the sweep runs while that
  turn *closes* — so the arithmetic is `firstLiveTurn + duration - 1`, not
  `+ duration`. It used to be the latter, which quietly gave every timed tag
  an extra turn on the sheet and made a 2-turn tag count down "2 left, 1 left,
  last turn": three states for what the catalog called two turns.

  **Which turn is the first live one depends on when you grant.** Mid-turn
  (a request, a GM grant, a purchase) it is the open turn, which is what
  `expiryFor(tag, openTurn)` assumes. A pass that grants while *closing* a
  turn — Hunger, the wound progression, Exhausted, a stack rerolling its
  clock, the staged push — grants for the turn about to open, so it passes
  `turn.number + 1` to `expiryFrom`. Note the ordering it implies: `resolveNeeds()` sweeps *before*
  the Hunger pass grants, so a still-broke character's Hunger is cleared and
  re-granted rather than colliding with `@@unique([characterId, tagId])`. See
  `REQUESTS.md` §4.

  **Every grant path must stamp `expiresTurn`.** The sweep matches
  `expiresTurn <= turn.number`, and `null` never matches — so a timed tag
  granted without a stamp is *permanent*, no matter what `durationTurns` says
  in the YAML. `db/lib/turnFormat.js#expiryFrom(firstLiveTurn, duration)` —
  and its mid-turn wrapper `expiryFor(tag, openTurn)`, re-exported from
  `web/lib/turnFormat.js` — is the one place that arithmetic lives; use it
  rather than open-coding a turn number plus a duration again. This was a real bug: `grantTag`
  on `/gm/dev` and `addTagRequest` both left it null, so a GM-granted
  Paralyzed sat on the sheet forever while its tooltip advertised "Lasts 1
  turn".

### How a duration is displayed

`web/lib/turnFormat.js#tagDuration(left, defaultDurationTurns)` is the single
source for both the chip badge and the tooltip row, so the two can never
disagree. `left` is `turnsLeft()` for a held `CharacterTag`, and `null` for a
bare catalog reference (a `{tag:…}` in prose has no `CharacterTag` behind it).

| State | Tooltip row | Chip badge |
|---|---|---|
| Held, 2+ turns to run | `2 turns left` | `· 2t` |
| Held, final turn | `Expires this turn` | `· last` |
| Catalog reference | `Lasts 1 turn once granted` | `· 1t` |
| No duration at all | *(row omitted)* | *(none)* |

`turnsLeft()` counts **inclusively** — the open turn is one of the turns left —
so the final turn arrives here as `1` and takes the wording rather than a bare
`1t`. A 2-turn tag therefore shows exactly two states, one per turn: `2 turns
left`, then `Expires this turn`. There is no state that says "1 turn left" and
means "and one more after that".

Two details are deliberate. **"once granted"** is what separates a catalog fact
from a live countdown — without it the same tag read two different ways
depending on how it happened to be granted, which is exactly the confusion this
replaced. And the final turn reads **`last`, never `0t`**: the tag is still
active on that turn, so a zero contradicted the tooltip beside it.

`formatTagRequirement` spells its turns out (`1 turn`, not `1t`) for the same
reason — an unlabelled `1t` meaning *turns of work to cure* sat in the same
panel as a `1t` meaning *turns remaining*.

Both formatters are hand-duplicated as `db/lib/turnFormat.js` and
`db/lib/formatTagRequirement.js` for the bot's 🔍 inspect embed, the same
convention as `buildNickname`. Change both copies together; don't collapse them
(the web copies must stay dependency-free so client components can import
them).
- `removable` — whether a player can strip this tag off themselves mid-game
  without a GM. Live: it is the whole filter behind the Destroy menu (Remove
  Tag, renamed — `CRAFTING.md`) (`removableTags()`, `web/lib/tagRequests.js`)
  and is re-checked by `destroyTagRequest`. Never true on a Health tag any
  more — a wound is healed, not destroyed; see `healable` below.
- `craftable` — whether this tag represents something a player can
  craft/make, as opposed to one that only ever arrives via role, GM grant,
  or automatic game logic. Live: `addableTags()` offers Craftable tags in the
  Craft menu (Add Tag, renamed), and Craft now enforces the recipe's
  `requirement.skills` server-side rather than leaving them as GM-review
  guidance — see §3b and `CRAFTING.md` §2.
- `healable` — whether the Heal menu offers this tag. Replaced an older
  heuristic (any Health-category tag with a `requirement:` block); the flag
  is what `web/lib/healRequests.js#isHealable` reads now, and it's what's set
  `true` on every health tag with a cure, `false` everywhere else — see §5c.
- `teachable` — whether this tag is a skill Learn Skill / Teach Skill will
  offer. Set `true` on every entry in the `skills` category, not derived from
  the category itself; the one rule is `db/lib/lessons.js#teachableSkills`
  (`LESSONS.md` §2).
- `consumable` / `consumesInto` — whether a player can use this tag up, and
  what it becomes. Live; see §5b.
- `expiresInto` — what this tag becomes when its `durationTurns` runs out,
  instead of simply being swept away. Live; see §5c.
- `laborBonus` — what this tag adds to one kind of Laboring, e.g.
  `laborBonus: { kind: hunting, amount: 3 }`. `equipped` defaults **true**;
  `requiresTag` gates it on holding something else (the Plow needs a horse).
  Bonuses sum, and `GameConfig.equipSlots` is the real limit. Normalised and
  validated in `db/lib/tagShapes.js`, which throws on an unknown `kind`, on a
  bonus that requires equipping a tag that is not `equippable`, and on a
  `requiresTag` naming a tag that does not exist — a typo'd `kind` would
  otherwise make a tool silently worthless. Full rules in `LABORING.md` §5.
- `requirementItems` (YAML: `requirement.items`) — the recipe's
  **ingredients**, and the first ones this game ever actually enforced. Only
  two recipes carry one: `miasma` needs a corpse, `dreamers-draught` needs a
  Skinless Brain. **Holding it is the check — nothing is consumed**, so you
  keep the corpse you bottled the Miasma over, and a second craft off the same
  body is allowed. An entry is either a tag slug (`items: [skinless-brain]`) or
  a whole **group** (`items: [{ group: items-corpse }]`); the group form is not
  a convenience but a necessity, since a corpse written at death is never in
  `docs/tags.yaml` for a slug to name. Stored as Json rather than a relation
  for that reason, with a denormalized display `label` the sync rewrites every
  run. Validated in `db/lib/tagShapes.js` — which throws on an `items` block on
  a tag that is not `craftable`, because the Craft path is the only enforcement
  point and an `items` block anywhere else would look enforced and do nothing.
  Enforced against the crafter's **own sheet only**, never a room stash. Full
  writeup in [`CORPSES.md`](CORPSES.md) §8.
- `requirementTurns` / `requirementResources` / `requirementGambit` /
  `requirementPerTurn` / `requirementSkills` (YAML: nested under
  `requirement:` as `turnsCost` / `resourceCost` / `gambit` / `perTurn` /
  `skills`) — what it costs a character to add
  or remove this tag in play (e.g. curing Arthritis needs Medical (Skilled)
  and some turns; forging the revolver tag costs turns, resources, and
  Smithing; the `cart` tag costs turns, resources, and `Builder (Skilled)` —
  there is no "Basic" rung of that family, it starts at Skilled).
  `requirementSkills` is a many-to-many self-relation onto `Tag`
  (multiple skill tags accepted), resolved in `syncTags.js`'s pass 5. This
  is mostly a GM adjudication reference, shown to players, with one
  exception: the Heal request (`HEAL_CHARACTER`, REQUESTS.md §5c) enforces
  the *removal* direction on `Status` tags — `requirementResources` is the ⬢
  it charges and `requirementSkills` is what the medic must hold (any
  equal-or-higher tier up the `parentTag` chain counts). In the *adding*
  direction the Add Tag menu shows the skills as its "To make: …" hint but
  does not enforce them (§3b). Turns, ⬢ and Gambit stay reference-only
  everywhere.
  One shared block covers whichever direction (add or remove) is
  narratively relevant to a given tag, rather than separate blocks per
  direction. Rendered everywhere a tag's description already renders, in a
  minified form, via `formatTagRequirement()` (`db/lib/formatTagRequirement.js`,
  exported from `@lifeweb/db`) — see `TagChip.js` and `PointBuy.js`.
  The one surface that does **not** render it wholesale is the 🔍-inspect
  embed (`bot/src/events/messageReactionAdd.js`), which shows it for
  **Health-category tags only**. The same block reads as a doctor's bill on an
  affliction and as a recipe on everything else, and a bystander glancing at a
  worn sword has no business learning what forging one costs. On the Health
  rows the ⬢ *is* shown; every other visible tag is a bare name plus its
  turns-left badge.

## 5a. Stacks

Meals, ammunition, anything a crafting Move makes in a batch — a character
needs to hold four Fine Meals and hand them out one at a time. `stackable:
true` in `docs/tags.yaml` sets `Tag.stackable`; the count lives on
`CharacterTag.quantity` (default `1`).

**A stack is one row carrying a count, never N rows.**
`@@unique([characterId, tagId])` stays exactly as it was, which is the whole
point: every presence check in the codebase — `specialChannels.js`,
`gambitModifier.js`, `laborAccess.js`, the Mortus nav gate — keeps
reading "holds it or doesn't" with no change, and `restoreCharacterTag`'s
upsert stays valid.

Three functions in `web/lib/requestEffects.js` are the only writers that know
about `quantity`; everything else goes through them:

| | |
|---|---|
| `addToStack(tx, characterId, tagId, n, opts)` | create-or-increment. Pins `n` to 1 unless `opts.stackable`, so a caller that forgot to check can't mint a phantom stack. `opts.stackable` is the catalog flag and nothing else — there is no override. |
| `dropCharacterTag(tx, characterId, tagId, n)` | decrement, deleting the row at 0. `n = null` (the default) drops the whole holding — what an ordinary tag always wants. |
| `restoreCharacterTag(tx, characterId, snapshot)` | undo's inverse. **Increments** on the update branch: `snapshot.quantity` is what the request took away, not what the character should end up holding. |

**Nothing stacks a non-stackable tag, a GM surface included.** A GM ignores
`requiredTag`, the `TagGroup` gate and the budget (§6 below), but not this:
`stackable` describes the shape of the row rather than who may hold what, and
a quantity on a holds-it-or-doesn't flag is just a corrupt row. So the
quantity stepper is rendered **only on a `stackable` tag** — in the Dev Panel
Tags tab and in the turn desk's effect composer alike (`DEV-PANEL.md` §5). On
the Dev Panel's Holds row that stepper sets the **resulting count** rather than
a delta, staged as a `patch quantity`, so taking a stack from seven to three is
one gesture; zero there means the whole holding, converted to a `remove` before
it is sent. Elsewhere the stepper still reads as "how many" —
`mergeTagOp` (`web/lib/tagOpAlgebra.js`) pins a non-stackable `add` back to 1
so repeated clicks can't accumulate either, and `validateTagOps`
(`db/lib/tagOps.js`) refuses `quantity > 1` outright. This used to be
overridable: an op could carry `force: true`, which was derived from whatever
number happened to be in the stepper rather than from any deliberate choice.
That flag is gone.

Stacks made under the old rule may still be sitting in the database; they were
deliberately left alone rather than flattened by a script. Two things to know
about one. A stack on a tag with `expiresInto` is progressed as **one row** by
the untreated-wound pass (`db/lib/tagExpiryPass.js`), since that pass only
reads `stackable: false` rows — the whole stack turns into one successor
together. And `sweepExpiredStacks()` only handles catalog-`stackable` tags, so
such a stack sheds nothing on its own: it sits there until a GM removes it
(Remove takes the whole holding) or its chain fires.

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
  consequence worth knowing: drinking a second Alcohol while already Tipsy
  does *not* extend Tipsy. Undo depends on `added: 0` meaning "this
  request didn't grant it", so a refresh here would need its own snapshot.
- **A grant may be conditional.** A `consumesInto` entry can be an object
  rather than a bare slug, and is then granted only to a character holding
  *none* of its `unlessTags`:

  ```yaml
  consumesInto:
    - ate-meal
    - slug: night-vision
      unlessTags: [blind]
  ```

  `Tag.consumesInto` still stores every target slug in order; the conditions
  live beside it in `Tag.consumesIntoUnless` (`Json`, null for the many tags
  that have none), and `syncTags.js` validates both halves against this file.
  `resolveConsumeGrants()` in `web/lib/consumeGrants.js` applies them, and is
  deliberately pure so the server action and the client "Becomes:" preview
  share it — a preview that promised something the grant then withheld would
  be worse than no preview. **No tag uses this today.** Fine Meal was the only
  one, granting `happy` unless `nobility`, and its condition went with the Mood
  system; the mechanism is kept because it is general.
- **A grant may override the target's expiry.** The same object form takes an
  optional `durationTurns`, which replaces the granted tag's own
  `defaultDurationTurns` for that grant only:

  ```yaml
  consumesInto:
    - euphoric
    - slug: high
      durationTurns: 3
  ```

  This exists because one status can mean different things depending on what
  produced it. Raw Cave Fungus leaves you High for 2 turns; Bliss, which
  is Cave Fungus properly worked, leaves you High for 3. The alternative —
  `high-2` and `high-3` as separate tags — pushes an implementation detail
  into the player-facing catalog and multiplies with every future drink.

  It is stored in a second sidecar, `Tag.consumesIntoDurations` (`Json`,
  `{ "<slug>": N }`, null for almost every tag), resolved by the same
  `resolveConsumeGrants()` and applied by `grantTagSlugs()`, which prefers the
  override and falls back to the tag's own duration. An override on a target
  that has no duration of its own is legal and simply gives it one — but never
  point one at `ate-meal`, which is deliberately never swept because the
  Hunger pass consumes it explicitly.

Consuming is a **Request** (`CONSUME_TAG`), so it lands immediately, carries
a reason, and a GM can Undo it — see `REQUESTS.md` §3. The undo snapshot
records what was *actually* added per slug (`added: 0` for a grant that was
skipped as already-held), because Undo may only take back what this request
really put there.

`grantTagSlugs()` in `web/lib/requestEffects.js` is the single writer, a
fourth sibling to the three stack primitives in §5a.

**This replaced the old `grantsOnExpiry` field**, which did the same
conversion on a timer instead of on demand: letting a player choose *when* to
unpack a crate is strictly better than making them wait a turn.

`expiresInto` (§5c) is **not** that field coming back, and the distinction is
worth holding onto, because "two near-identical tag-becomes-other-tags
mechanisms" was the exact objection that killed the old one. The difference is
who decides. `consumesInto` is an action a player takes and is filed as an
undoable Request; `expiresInto` is what happens *to* them on the clock,
whether or not anyone wanted it, and is the whole reason an untreated wound is
frightening. A crate you open is not a wound that opens you. Both exist
because those are genuinely different things — but a new field that could be
written either way belongs in `consumesInto`, which is the one a player can
see coming and a GM can take back.

**Two more sidecars, added for the Caves Update** (see `CAVING.md` §7 for the
Purse/Supply Kit/Skinned Cave Rat tags that use them):

- **`consumesIntoResources`** (`Int?`) — the Resources half of a grant.
  `Purse` consumes into nothing but 3 ⬢ (`consumesInto: []`); `Supply Kit`
  combines both, 8 ⬢ plus one Alcohol. Applied by `consumeTagRequest` through
  the ordinary `creditResources` primitive, snapshotted into `Request.effect`
  so Undo debits it back exactly.
- **`consumesIntoOneOf`** (`Json?`) — a parallel array to `consumesInto`,
  same length and order, for an even random pick between alternatives —
  `{ oneOf: [...] }` in `docs/tags.yaml`, the same shape `expiresInto` (§5c)
  already uses. `Skinned Cave Rat` is the first user: 50/50 `ate-meal` or
  `vomiting`. `resolveConsumeGrants()` rolls the real pick for the server
  action; the client "Becomes:" preview does **not** call it for a `oneOf`
  position, since that would re-roll (and lie about) an outcome on every
  render — it renders "A or B" straight off the sidecar instead.

## 5c. Health, the cure ladder, and `expiresInto`

Health is its own **category**, split out of Status. Status is the
needs/intoxication layer — Hungry, Drained, Tipsy, High, all of it granted and
cleared by machinery — while Health is a system with its own pricing, its own
progression, and its own visibility rule. Seven groups carry it:
`health-wounds`, `health-infection`, `health-illness`, `health-maiming`,
`health-mind`, `health-minor`, `health-recovery`. They split by what **kind**
of medicine an affliction wants, never by how bad it is; severity is carried
by the requirement block instead.

### The cure ladder

Every Health tag is priced off one of eight rungs. **Pick a rung and copy its
block. Do not invent numbers.** The whole point of a ladder is that a player
learns it once and can then read any affliction they meet.

| Tier | Reads as | ⬢ | turns | skill | Gambit |
|---|---|---|---|---|---|
| 0 | Untreatable | — | — | — | — |
| 1 | Very minor — first aid | 1 | 0 | Basic | no |
| 2 | Minor | 2 | 0 | Basic | no |
| 3 | Moderately severe | 2 | 1 | Skilled | no |
| 4 | Severe | 4 | 1 | Skilled | no |
| 5 | Very minor surgery | 6 | 1 | Skilled | no |
| 6 | Severe surgery | 8 | 1 | Expert | no |
| 7 | Complex surgery | 8 | 1 | Expert | yes |

The ladder now runs in both directions. `HARM_CHARACTER` (`REQUESTS.md` §5b)
puts a Health tag **on** somebody — offered from `isInflictable()`'s curated
list of `health-wounds` / `health-maiming` plus four of `health-mind` — so
every rung you price there is also an injury a player can inflict on someone
already helpless. Treatable is a separate question now: a Health tag is
offered to Heal when `Tag.healable` is `true`, not by category or by the
presence of a `requirement:` block (§5, `isHealable`). A rung priced
carelessly can still be wrong twice, on both surfaces — just remember they're
two different flags now, not one inference.

**Remove/Destroy no longer cures anything.** Before `healable` existed, the
old Remove Tag door doubled as a rough cure for some conditions — stripping a
tag off yourself with no medic involved. `removable` and `healable` are
disjoint on every Health tag now: something a doctor treats is `healable`,
never `removable`; nothing in Health can be self-stripped through Destroy any
more. Healing is the only door.

Four things about it are deliberate.

**The top three rungs are the surgical ones, and they carry the whole
balance.** A Serpent closes an arterial bleed and cuts away dead flesh without
rolling — that is tier 5, and it is all the surgery they get. Anything that
means opening a chest or a belly is Esculap's work at tier 6; a Serpent may
still attempt it, but they roll. Tier 7 is the rung even Esculap rolls for,
which is why it shares tier 6's price: what separates the two is the Gambit,
not the bill. Only eleven tags sit above tier 5, and that scarcity is the point —
Esculap's time should be a thing players negotiate over.

**Realism sets the rung, not severity.** Severity and duration matter, but the
question that decides a tier is *what would it actually take a person to fix
this*. A dislocated shoulder is agonising and completely disabling, and it is
tier 1, because someone who has done it before puts it back in a moment. That
is why the table's left column is written as a description of the *work*
rather than of the injury.

**Tier 0 is a rung, not an omission.** Something realistically untreatable,
quick, and harmless — Vomiting, a Migraine, a Concussion, being Hungover —
gets **no `requirement:` block at all**, and `healable` stays `false`.
`isHealable()` (`web/lib/healRequests.js`) keys off the flag, so a tier-0 tag
never appears in the Heal picker and the action refuses it. This is a design
rule before it is a mechanic: charging a player 2 ⬢ and a doctor's afternoon
to shorten a bout of vomiting is silly, and pretending medicine can do it is
worse.

**Above your tier is still possible, and the Heal request now implements it.**
The requirement names what a character does **as routine**, which is why the
three Medical descriptions are phrased that way. A Serpent (Medical (Skilled))
can attempt the tier-6 surgery a punctured lung needs; they just roll for it,
while Esculap (Medical (Expert)) does not.

Reaching above your tier — or treating a tag whose own `requirementGambit` is
set, which is the whole of what separates tier 7 from tier 6, since they share
a price — files a **GAMBIT Move** instead of curing anything
(`isGambitHeal()`, `web/lib/healRequests.js`). It spends the medic's Move, the
die is rolled at file time, and the **affliction is left on the patient** until
a GM reads the roll on `/gm/turns`: an attempt that has not been resolved
cannot have cured anything, and a failed one is supposed to be able to leave
them worse. The shape is copied from a learner's Lesson Gambit
(`db/lib/lessons.js`), and `Action @@unique([characterId, turnId])` is what
makes it one gambit heal a turn without a second check.

**Routine cures are rationed by tier**: 2 a turn on Basic, 3 on Skilled, 4 on
Expert (`MEDICAL_TIER_CAPS`, `web/lib/requests.js`). A cure costing **0 turns**
is a free action and never counts — first aid, bandaging, setting a simple
break are the things you do between patients, and rationing them would make a
nurse refuse a bandage.

**Surgical Equipment is +1 on a medical Gambit**, satisfied by holding one or
by standing in a room that has one (`db/lib/equipmentReach.js`). There is a set
in the Sanctuary's operating theatre, seeded from `docs/zones.yaml`; the old
"procedures in the Sanctuary automatically qualify" line was prose that no code
ever read, and it is gone.

So `requirementResources`, `requirementSkills` and `requirementGambit` are all
enforced now. `requirementTurns` remains reference for the *length* of a
course of treatment, but its zero/non-zero split does real work: it is what
decides whether a cure counts against the day's allowance.

### Six named exceptions

A handful of Health tags sit off the standard rungs on purpose — priced by
Kata's 8/28 review rather than a copy-pasted block. They are exceptions to
"pick a rung," not new reusable rungs; don't copy their numbers onto anything
else.

- **`minor-bleeding`, `dislocated-shoulder`** — 0 ⬢, 0 turns, Medical
  (Basic). Below tier 1: a bandage or a shoulder pop is real medical
  knowledge, but it costs the doctor nothing to do.
- **`severe-bleeding`, `arterial-bleed`, `parasites`** — 3 ⬢, 1 turn, Medical
  (Skilled). Sits between tiers 3 and 4: stopping blood loss is urgent but
  simpler than the rest of what "Severe" covers.
- **`choking`** — 2 ⬢, 1 turn, no skill. A Heimlich needs no training at
  all — the ⬢ buys the doctor's time, not their expertise.
- **`frostbite`** — 2 ⬢, 0 turns, Medical (Skilled). Also gained
  `expiresInto: [necrosis]` — it now progresses like an untreated wound
  instead of sitting inert.

### `expiresInto`

An ordinary timed tag is swept away when its `expiresTurn` comes due. One
carrying `expiresInto` turns **into** something else on the way out. This is
the untreated-wound chain, and it is the thing that makes a doctor worth
finding:

```
Infected ──2t──▶ Festering ──1t──▶ Feverish ──1t──▶ Sepsis ──1t──▶ Dying ──1t──▶ dead
                     └────1t────▶ Necrosis ──2t──▶ Missing Leg *or* Missing Arm

Stuffed ──4t──▶ Exploded Chest ──2t──▶ Dying ──1t──▶ dead
```

Dying is the one step that isn't an `expiresInto` — nothing follows it in the
catalog. Its `durationTurns: 1` is a countdown that `db/lib/dyingDeathPass.js`
reads at the close (`TURN-ENGINE.md` §2 4b), which is why the arrow points at
"dead" rather than at another tag.

Five turns from Infected to Dying, six to dead, and five to a lost limb — the
two branches land together on purpose. It used to be nine, which was long enough that a
player could ignore an infection for a week and a half and still find a doctor
in time. Five is short enough to be a real problem and long enough that a
doctor two zones away is still a plan.

**Five wounds feed the chain, and three of them are a coin flip.** `deep-wound`,
`severe-burns` and `grievous-wound` go septic for certain; `burned` splits
`oneOf: [infected, scarred]` and `minor-wound` splits
`oneOf: [infected, recovering]`, so an untreated lesser wound is a gamble rather
than a sentence. `scarred` and `recovering` are ordinary catalog tags doing duty
as the lucky outcome — nothing special marks them as "the good branch."

Closed injuries deliberately have **no** `expiresInto`: a bruise, a sprain, a
dislocated shoulder, cracked ribs, a broken bone or jaw. Note what that means
for their `durationTurns` — with no successor, the duration is how long you
*suffer*, so shortening one makes medicine **easier**, not harder. The two
fields pull in opposite directions and it is worth stopping to check which
kind of tag you are holding before you touch a number.

The second chain is the larva: `stuffed` is tier 5 (very minor surgery — cut
it out while it is small), `exploded-chest` is tier 7 (the rung even Esculap
rolls for) and runs on into Dying the same way Sepsis does. Both sit in
`health-illness`.

The YAML takes a bare slug, several slugs granted together, or an even random
pick:

```yaml
expiresInto: [festering]                    # one
expiresInto: [feverish, necrosis]           # both, at once
expiresInto:
  - oneOf: [missing-leg, missing-arm]       # a coin flip
```

`normalizeExpiresInto` normalises every entry to `{ oneOf: [...] }` — a bare
slug is a pick of one — so the stored `Tag.expiresInto` Json, the pass, and
`TagChip`'s "Becomes" row all handle a single shape. It validates three things
**before writing anything**:

- every slug exists in `docs/tags.yaml`;
- the tag has `durationTurns` ≥ 1, or nothing would ever fire it;
- **a tag may not list itself.** The grant happens one statement before the
  sweep that deletes the expired row, so a self-loop would be re-granted and
  immediately deleted, doing nothing. A recurring condition is written as a
  **two-tag loop** instead: Migraine expires into No Migraine, which expires
  back into Migraine, forever. That cycle is deliberate and there is no
  cycle detection beyond the self check.

Those rules live in `db/lib/tagShapes.js`, not in `syncTags.js`, because the
YAML is no longer the only door: a GM can author an expiry chain from the tag
form too (`DEV-PANEL.md` §8a). Both surfaces call the same
`normalizeExpiresInto` / `validateExpiresInto` pair, so a chain the form
accepts is one the next `db:sync-tags` would accept as well.

`db/lib/tagExpiryPass.js` applies it, inside `resolveNeeds()` and **before**
the sweep — the sweep is a blind `deleteMany`, so afterwards there is nothing
left to read (`TURN-ENGINE.md` §2). The pass grants and never deletes. Four
rules match the ones §5b lists for consuming, for the same reasons:

- **A successor a character already holds is left completely alone**, its own
  clock included (`skipDuplicates`). Re-granting would silently reset a
  condition they were most of the way through.
- **A successor starts its own clock**, `turn.number + defaultDurationTurns`,
  the same absolute-turn expression every other writer uses. A successor with
  no catalog duration is granted permanent — which is what Missing Leg and
  Scarred want. Dying used to be in that list; it now carries
  `durationTurns: 1`, which is a countdown to death rather than to recovery.
- **Nothing can fire twice in one pass.** Every duration is at least 1 and the
  sweep matches `expiresTurn <= turn.number`, so a tag granted while closing
  turn N cannot also expire on turn N.
- **A dead character's sheet stops moving.** Their rows still get swept; they
  just don't progress into anything.

**Nothing in the pass kills anyone** — but the chain no longer stops at
`dying` either. Every terminal chain still lands there, and `dying` now
carries `durationTurns: 1`: one turn on death's door, then
`db/lib/dyingDeathPass.js` ends it at the next close, automatically
(`TURN-ENGINE.md` §2 4b).

That turn is the whole design. `dying` is visible and carries a tier-7 cure,
so a heroic save is still on the table — a medic with Medical (Expert), a
Gambit, 8 ⬢ and one turn can pull someone back. What went away is the version
where a character sat on death's door indefinitely because no GM had got to
the Kill button. The pass is also careful in one direction: a `dying` row with
a **null** `expiresTurn` is stamped for the next close and its holder warned
rather than killed, so nothing granted before the clock existed dies to a
clock it was never shown. A GM can still end it early by hand
(`web/app/(app)/gm/turns/actions.js`), and can still cancel it entirely by
removing the tag.

### `removesInto`

`expiresInto` is what ignoring a wound costs; `removesInto` is what **curing
one still costs**. A tag carrying it turns into its treated form when it
leaves the sheet through a removal — a Broken Bone treated is a Splinted limb
for four turns, not a clean slate. It fires on five paths, inside each one's
own transaction. Two are player-driven:

- the **Remove Tag** request (`REQUESTS.md`) — self-removal from `/character`;
- the **Heal** request (`HEAL_CHARACTER`) — the aftermath lands on the
  *patient*, and the "treatment didn't take" GM edit takes it back off along
  with restoring the affliction.

Three are a GM taking a tag off a sheet, all through
`applyTagOpsInTx` (`db/lib/tagOps.js`) except the last:

- a **staged `remove`** on `/gm/turns`, applied at the turn close
  (`ADJUDICATION.md`);
- a **Dev Panel** `remove` op, applied on Apply (`DEV-PANEL.md`);
- a **bulk revoke** from `/gm/players` (`bulkTagCharacters`), which rolls the
  chain per character rather than once for the batch, so a `oneOf` doesn't
  hand a hundred people the same coin flip.

A GM removal used to be godmode and skip the chain. It doesn't, because most
GM removals *are* treatments — a staged effect resolving a wound, a revoke
after a scene — and a cure that costs nothing makes medicine pointless. The
one holdout is the bot's `/heal` slash command, which stays godmode: it is the
"put this sheet right" tool, not a treatment.

Expiry doesn't fire it either — that is `expiresInto`'s job, and the two
chains on one tag answer different questions (Deep Wound ignored goes
`infected`; Deep Wound treated goes `stitched-up`).

Same YAML shape as `expiresInto` — a bare slug, several at once, or an
`oneOf:` coin flip — normalised and validated by the same
`db/lib/tagShapes.js` pair on both authoring doors (the sync and the GM tag
form). Two differences: no `durationTurns` requirement, because the removal
fires it rather than any clock, and the self-reference error is its own
("removing it would grant it right back"). How long the aftermath lingers is
the granted tag's **own** `durationTurns` — Splinted's 4, Drained's 3 — or
forever for a permanent one (Scarred, Limp).

The grants go through `grantTagSlugs` (`db/lib/tagWrites.js`, re-exported by
`web/lib/requestEffects.js` — it moved down when the GM paths needed it, since
`db/` cannot import `web/`), so the rules match consuming and the expiry pass:
a successor the character already holds is left completely alone (`added: 0`
in the snapshot), and Undo takes back only what the request really added, off
the `effect.granted` snapshot rather than today's catalog. The `oneOf` picks
are rolled once, up front (`rollTagChain`), so the snapshot records exactly
what happened.

On the GM paths the same `granted` snapshot rides along on the `remove` entry
`applyTagOpsInTx` returns, so it lands in the Dev Panel's audit row and the
staged effect's snapshot. A removal that removed nothing — the character
wasn't holding the tag — grants nothing, so a stale staged op can't mint an
aftermath out of thin air. Those paths have no Undo, which is unchanged.

The `health-recovery` group is where the aftermaths live — its header comment
has said "what good treatment leaves behind" since before anything granted
them mechanically. Which afflictions carry `removesInto` (34 as of the
introduction) is authored in `docs/tags.yaml`; the deliberate *non*-carriers
are the trivial cures (a bruise, a popped shoulder, a Heimlich), where an
aftermath would make cheap medicine pointless. TagChip and the Tag Catalog's
detail sheet both show the chain as a **Treated** row beside **Becomes**.

### Visibility, and the doctor's eye

`visible` on a Health tag is a question about **realism, not severity**: could
a bystander tell? That is the catalog-wide rule in §5, applied here — the
addition is the doctor's eye below. A gaping wound, a missing arm, Paralyzed and Severe Burns
are obvious. Appendicitis, cracked ribs, parasites, chronic pain and Shell
Shocked are not, and are `visible: false`. Only `true` or `false` here —
nobody wears appendicitis, so no Health tag is `equippable` and `worn` never
applies to the category.

That would make the internal cases invisible to the one person who should
notice them, so there is a second rule: **if you could treat it as routine,
you can see it.** `db/lib/medicalVision.js#medicallyVisibleTags` unions the
subject's visible tags with the Health tags the *inspector* is
qualified for, and the 🔍 embed marks the second kind `· your diagnosis` —
because the patient isn't showing it to the room, and a medic who repeats it
as common knowledge has said something nobody else could know.

Routine is doing real work in that sentence. A tag whose cure needs a Gambit
stays hidden **even from an Expert**, since guessing isn't diagnosing; and a
tier-0 tag has no `requirementSkills` at all, so it is nobody's professional
business. The skill-tier walk (`buildSkillAncestry`/`satisfiedSkillIds`) lives
in `db/lib/medicalVision.js` rather than `web/lib/healRequests.js` precisely
so the bot's inspect and the web's Heal request cannot drift on the question
of who is qualified; `healRequests.js` re-exports it.

### Adding a health tag

1. Pick the group by what kind of medicine it wants.
2. Pick a ladder rung by what the work would really take, and copy its block
   verbatim. Tier 0 means no `requirement:` at all, and `healable: false`.
   Any rung above 0 gets `healable: true` — and `removable: false`; Health
   tags are cured, not destroyed.
3. Set `visible` by whether a bystander could tell.
4. If it worsens, give it `durationTurns` and `expiresInto` — **and say so in
   the description**, naming what it becomes. The tooltip's "Becomes" row is
   reinforcement; the sentence is what makes someone act in time.
5. Negative `pointCost` (a drawback bought at creation) requires
   `purchasableAfterStart: false`, per §4.
6. `npm run db:sync-tags`.

## 5d. GM-authored tags

A tag can also be written in the UI, at `/gm/dev/tags`, instead of in
`docs/tags.yaml`. Such a row carries `Tag.custom = true` and lives only in the
database.

The two halves of the catalog behave differently on purpose:

|  | From `docs/tags.yaml` | GM-authored |
|---|---|---|
| Editable in the UI | No — the next `db:sync-tags` would revert it | Yes |
| Touched by `db:sync-tags` | Upserted every run | Never (the sync is keyed by slug and has no entry for it) |
| Touched by `db:prune-tags` | Deleted if unreferenced and no longer in the YAML | Never — skipped explicitly |
| Deletable in the UI | No | Superadmin only, and only if nothing references it |

**Slugs are generated, never typed**: `custom-${slugify(name)}`. A GM naming a
tag "Arthritis" would otherwise collide with the YAML slug, and the next sync
would upsert straight over their row — silently converting their homebrew into
a YAML tag and clobbering every field. The prefix also guarantees a custom slug
can never appear in the prune script's YAML slug set by accident.

**There is a third author, and it is neither of these: the game itself.**
`db/lib/corpseMint.js` writes one Tag row per death ("Ada's Corpse") and
`db/lib/headstone.js` writes one per Engrave. Both set `custom: true` so the
syncs leave them alone, exactly as a GM's homebrew is protected — what tells
them apart is `Tag.corpseKind` and `Tag.corpseOfCharacterId`. That distinction
earns its keep three times: it is the join that walks a dead sheet after its
corpse, it is how the Butcher yield table tells a person from a Nekker, and its
`onDelete: Cascade` is the only thing stopping these rows outliving a Restart
Game. Full writeup in [`CORPSES.md`](CORPSES.md) §9.

A system-authored row is also the one exception to the rule below: a corpse
carries a decay chain, which no GM may hand-author. It does not go through
`expiresInto` to get one — it renames itself in place (`CORPSES.md` §3).

What a GM can set is the tag's own behaviour — cost, category, group,
description, the `stackable`/`equippable`/`consumable`/`removable`/
`purchasable` flags, the three-state "seen by others on 🔍", plus a duration. What they cannot set is
catalog *structure*: `parentTag`, `requiredTag`, `requirementSkills` and
`consumesInto` all wire tags to each other, and that belongs in the YAML where
it can be reviewed alongside the tags it connects.

## 6. Things that used to be tags and aren't anymore

`Leader` and `Treasurer` were retired as tags in the same rework that
introduced this system (and were finally removed from `docs/roles.yaml`'s
`starting_tags` too, in favor of per-role `leader:`/`treasurer:` booleans) — both are now plain booleans on `Character`
(`isLeader`, `isTreasurer`), assigned dynamically by a GM (Leader) or by a
GM/the faction's own Leader (Treasurer) from `/faction`
(`web/app/(app)/faction/actions.js`), exactly as before — only the storage
mechanism changed, not who can assign what. `Courtier` survived too, and still gates `Manor` via that tag's `requiredTag` (§3). `Mortus` survived the
"Role" category's retirement as an ordinary General tag since it drives real
logic elsewhere — it gates `/lifeweb` nav visibility. `Hunter` survived
alongside it for the same reason, but has since been retired: hunting is now
just a flavor of laboring (`LABORING.md`), and no `hunter` entry remains in
`docs/tags.yaml`.

## 7. Where the code lives

`db/lib/syncTags.js` (the sync itself), `db/scripts/sync/sync-tags.js` (terminal
entry point, `npm run db:sync-tags`), `docs/tags.yaml` /
`docs/taggroups.yaml` (content), `web/lib/referenceData.js#getVisibleTags`
(the catalog backing `{tag:slug}`/`{tag:id}` references, and the gate from
§3a),
`web/app/components/RichText.js`/`TagsProvider.js`, `TagChip.js` (the
hover-tooltip chip that renders group color, and the "Becomes" row from §5c),
`db/lib/inspectVision.js` (Seductive, §5),
`db/lib/medicalVision.js` (the cure-skill walk and the doctor's eye, §5c),
`db/lib/tagExpiryPass.js` (the `expiresInto` progression, §5c), and
`web/lib/healRequests.js` (what a medic may treat, `REQUESTS.md` §5c).

**Tag descriptions carry `{tag:…}`/`{resource:…}` tokens
too**, not just documents — that's how a True Form names the {tag} it inflicts. The three
places a description renders all forbid an *interactive* chip, though: a
`TagChip` nested in a hover tooltip could never be hovered to reach its own
tooltip, and the point-buy / Add Tag rows are `<button>` elements. So they
render through `ChipText.js`, which resolves the same tokens to a plain
`ChipLabel`. `RichText.js` stays the full-fat renderer for prose the reader
can point at (documents, a character's appearance). Both share the parser in
`richTokens.js` — which exists in its own file precisely because `RichText`
renders `TagChip` and `TagChip` renders `ChipText`, so importing one from
the other would close an import cycle.

There are three token kinds. `{tag:slug|id}` and `{resource:field:tier}` are
described above; `{document:key}` names another paper by its `Document.key`
(`DOCUMENTS.md`), rendering as a chip that links to it. The
parser in `richTokens.js` is kind-agnostic — `{(\w+):([^}]+)}` — so a new kind
never touches it or `remarkTokens.js`. What a new kind *does* touch is the
three renderers, which is the whole edit surface: `RichText.js`'s
`BUBBLE_KINDS` map (the only real dispatch table), and the hardcoded if-chains
in `ChipText.js` and `DocumentMarkdown.js`'s `RichTokenRenderer`. Miss
`ChipText` and the token renders literally in a tag tooltip and in the
`/documents` card preview; miss `DocumentMarkdown` and it renders literally in
an open document. Every kind falls through to the raw `{…}` text when it can't
resolve, so a bad reference is visible rather than silently dropped.

A kind whose data the browser doesn't already hold also needs a read API and a
provider mounted in `layout.js`, the way `{tag:…}` has `getVisibleTags` +
`TagsProvider`. `{document:…}` is the case to copy if the data is
access-controlled: `/api/documents` ships every document's *name* but a body
only to a reader who may open it, so a chip for a paper you have not been
handed renders inert rather than either vanishing or leaking.

`hungry`, `hungerless` and `ate-meal` are the first tags granted and consumed
by automatic game logic rather than by a player, a GM, or a starting package —
`db/lib/hungerPass.js` is their only writer, and `db/lib/gambitModifier.js`
their only reader. `db/lib/constants.js` holds the slugs so neither file
hardcodes a string. `catatonic-afk` is a third: `db/lib/catatonicPass.js` (gated on
`GameConfig.catatonicEnabled`/`catatonicTurns`) and
`db/lib/playerDeparture.js` (a guild leave, ungated — departure is a fact,
not a dial) are its two writers, it now carries a consequence — held for
`GameConfig.catatonicDeathTurns` turns straight, the character dies at close
(`TURN-ENGINE.md` §2 7b, the engine's one auto-kill) — and it
is also the only tag in the game that a pass both grants **and** clears
itself — it carries no `durationTurns`, deliberately, because there is no
sweep to hand the clear to; see `TURN-ENGINE.md` §2 for why that's the
correct exception to "every grant must stamp `expiresTurn`" rather than a
repeat of the Paralyzed bug. Because its whole purpose is broadcasting
"this player is AFK", it surfaces further than any other tag: a chip on the
`/faction` member roster (visible to ordinary members — the deliberate
exception to that roster's no-fate rule), a Catatonic column on
`/gm/players`, a muted dot on `CharacterAvatar` across the GM desks, a
Condition row on the player's own `/character` sheet, and the character's
personal Discord role renamed to `<name> • Catatonic` in flat grey. The
role's name/colour are composed only by
`db/lib/characterRoleAppearance.js` — shared by `ensureCharacterRole` and
the pass's returned `roleUpdates` — so a profile save can't strip the
suffix, and the doctor/pruner skip claimed roles before their signature
test ever sees the grey. The Health chain (§5c) is another such system,
and it
deliberately holds **no** slugs in `constants.js`: the whole chain is catalog
data, so `tagExpiryPass.js` never names a tag and a new chain needs no code
at all.

## `equippable` / `concealsIdentity`

`equippable: true` marks a tag as something a character can wear or carry
readied, and so occupies one of `GameConfig.equipSlots` (default 6). The state
lives on `CharacterTag.equipped`, not on a join table: equipping is a property
of holding the tag, so `@@unique([characterId, tagId])` stays and every
"holds it or doesn't" check in the codebase is unaffected. A `stackable` tag
takes one slot however many units are held.

`CharacterTag.equipped` is **cleared on death** — `killCharacter` runs an
`updateMany` over the corpse's held tags. A corpse doesn't wield things, and
a Revive later shouldn't walk back in with gear locked to slots that may
have moved. It also keeps the loot panel (`CHARACTERS.md` §5) from rendering
an item as if it's still worn.

`concealsIdentity: true` marks gear that hides who the wearer is — a mask, a
hood, a closed helm. It is currently **inert**: `/conceal` is open to every
character with nothing equipped (`PROXYING.md` §5), and the field is kept only
so that gate can be restored without a migration. It is only meaningful
alongside `equippable`, and `syncTagsFromYaml` **throws** if it is set without
it rather than syncing a tag that could never do anything — the kind of quiet
failure that is miserable to debug from inside the game.

`equippable` **does** interact with `visible`, through its third state. A tag
authored `visible: worn` is shown to a bystander's 🔍 only while
`CharacterTag.equipped` is true — see §5 for the table and the throw. What
gets it is a question about size, not secrecy: anything small enough to keep
out of sight when you aren't using it.

- **`worn`** — the sidearms and short blades (Dagger, Silver Knife, Work
  Knife, Knuckle Duster, Sling, Sword Cane, Bomb, and every pistol including
  the Sawn-Off), armor that goes under clothes (Padded Armor, Brigandine), and
  the small worn signals: Watch Badge, Sheriff's Badge, Hand's Pin, Incarn's
  Key, Bishop's Mitre, Headman's Cap, Esculap's Vest, Jewelry, Spectacles,
  Radio Bracelet, Dark-Eye Lenses. The badges are the interesting half — an
  officer can now go about unmarked, and displaying the thing is a choice,
  which is what the Watch Badge's own description always claimed.
- **`true`** — everything you cannot hide by not holding it: swords,
  polearms, bows, shields, plate, banners, the Baron's Scepter, the Power
  Fist, the Flamethrower, and all the garb and robes. Carrying one reads the
  same as wearing one.

A concealed character's 🔍 embed applies the same gate through the same
predicate, so a hidden cuirass stays hidden even while worn, and a stowed
dagger stays hidden even from someone standing next to it. What conceal takes
away is the *identity* — name, appearance, Desire, Resources — not the
inventory.

## `forcesName`

`forcesName: Beast` is the opposite of a hood: a tag that **fixes** how its
holder presents instead of hiding it. It exists for transformations — Apex Form
turns a Demoness into a monster, and a monster does not get to keep posting as
`Lady Ysolde "the Fair" Marrow` with her portrait.

What it does, all resolved at **read time** by `db/lib/presentedIdentity.js`
(`PROXYING.md` §5), with the precedence **forced > concealed > own name**:

- Every proxied message — typed, the Speak modal, and the REST twin that posts
  staged public posts — goes out under the forced name, with the letter
  plaque for its initial (`/assets/letters/B.webp` for Beast). Never the
  character's own face, uploaded or built.
- **Who's here?** lists them under the forced name, with no Role, and never on
  the concealed line even if `Character.concealed` is still true on the row.
- The player-facing 🔍 embed titles itself with the forced name and shows the
  plaque. The GM's ⚜️ dossier keeps the real name and face and adds a
  `Presents as` line — a GM needs to know who it is.
- ⭐ files the note under the forced name, and the archive freezes it into
  `ArchiveEntry.concealedAlias`, so `/archive` reads `Beast (Ysolde Marrow)`
  exactly as it reads a hood.
- `/conceal` and the switch on `/character` both refuse. The portrait maker,
  the upload and Reset to Default are hidden on the sheet, and the server
  actions behind them re-check the tag, since a hidden button is a hint and
  not a lock.

What it deliberately does **not** touch: the `Character` row (no rename, so two
Beasts never collide on `Character.name`, and every GM table still says who it
is), the personal @-mention role, and the server nickname — both keep the real
bare name, by decision. The `/add` picker naming the character is intended, not
a leak.

One consequence of the precedence worth knowing: a character who had their hood
**up** when the tag landed stops being concealed. Their 🔍 embed goes back to
the full one — tags, Desire, Resources under whatever gates apply — titled with
the forced name. A Beast is not hiding, and the row's stale `concealed` flag
does not get a vote.

Because nothing is written when the tag lands, there is no grant hook and no
catch-up pass: the first message after any door grants it — the store, the dev
panel, a Desire — already posts as the forced name, and removing the tag
reverts every surface on the next message.

`syncTagsFromYaml` **throws** on an empty `forcesName`, on one longer than the
first-name budget (`NAME_LIMITS.firstName`, 24), and on a tag that sets it
beside `concealsIdentity` — a tag cannot hide who you are and dictate it. The
GM's custom-tag form has no editor for it, the same posture as `desireLocks`;
`/gm/dev/tags` shows it as a `Forces name: …` chip.

### The equipment panel

`EquipmentPanel.js` on `/character` is **click-to-toggle**, not drag-and-drop —
drag would need a touch fallback that is exactly this anyway — and is its own
surface rather than an affordance on `TagChip`, whose click already opens the
Consume dialog.

Equipping is **instant and writes neither a `Request` nor an `AuditLog` row**,
unlike everything in `REQUESTS.md`. It costs nothing, the player undoes it in
one tap, and at 100+ players a row per toggle would drown `/gm/audit`.

`toggleEquip` (`web/app/(app)/character/equipActions.js`) resolves the character
from the session rather than trusting a posted id, re-checks `tag.equippable`,
and counts the slots inside a transaction — **but the count alone is not
sufficient.** Prisma runs at READ COMMITTED, so two tabs both read the same free
slot and both write. The transaction opens with

```sql
SELECT id FROM "Character" ... FOR UPDATE
```

which serializes equips per character. Without it, a burst of 8 concurrent
equips all land against a cap of 6 (verified).
