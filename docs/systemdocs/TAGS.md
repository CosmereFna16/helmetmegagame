# Tag catalog

How the `Tag`/`TagGroup` catalog is structured, master-sourced, and synced.
Not to be confused with `CharacterTag` (an individual character's *holding*
of a tag) or `Location.tags` (free-text flavor strings on a Location,
unrelated to this system).

## 1. Category -> Group -> Tag

Three levels:

- **Category** — a flat string (`Meta`, `General`, `Skills`, `Status`,
  `Items`, `Assets`). Not its own DB table; `docs/tags.yaml`'s top-level
  `categories:` list is validation-only — `syncTagsFromYaml` rejects any
  tag/group whose `category` isn't in that list.
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

The sync is four passes, since tags/groups can reference each other by slug
before every row necessarily exists yet: TagGroup scalars, then Tag scalars
+ `groupId`, then `parentTag`/`requiredTag` links, then `TagGroup.requiredTag`
links. Each pass only writes a row when something actually changed (a
diff check, same style as `syncLocationsFromYaml`'s `needsUpdate`).

## 3. Two relations that look similar but aren't

- **`parentTag` (tier chain)** — sequential, replacing. Fighting (Basic) ->
  Fighting (Trained) -> Fighting (Skilled) -> ... Acquiring a tier is meant
  to replace the previous one on the character, not stack alongside it.
- **`requiredTag` (prerequisite)** — non-replacing. The character must
  already hold `requiredTag`, but acquiring this tag does **not** remove or
  replace it. Example in the catalog: `Fighting (Archer)` requires
  `Fighting (Basic)` but coexists with `Fighting (Skilled)` — a character can
  hold both at once. Also used for the Companion "requires the base
  Follower/Windlander tag" cases (`Follower (Cook)`, `Windlander (Horse)`,
  etc.).
- **`TagGroup.requiredTag`** — the group-level version of the same
  prerequisite: every tag in that group stays gated behind one required tag,
  so a whole category-of-flavor (e.g. a hypothetical "Cultist" group) can be
  hidden behind a single membership tag without repeating `requiredTag` on
  every tag in it.

**Neither relation is enforced anywhere yet.** No code checks
`requiredTag`/`TagGroup.requiredTag` before showing or granting a tag — this
is catalog structure, ready for that logic when it's built. (`purchasable`
and `purchasableAfterStart` *are* now read, by the point-buy menu — see §4.)

## 4. The point economy

`pointCost` is the price in the point-buy menu, and it is **signed**:
positive costs the player points, negative *grants* them (the drawbacks,
Old at `-2` and Frail at `-3`). Both directions fall out of one subtraction,
so `remaining >= 0` is the only rule for whether a build is legal.

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
  Defaults closed.
- `tradeable` — Items-category flag for a future trade flow; no transfer
  logic exists yet.
- `defaultDurationTurns` (spelled `durationTurns` in the YAML) — catalog-level "how many turns does this last once
  granted," for tags that auto-expire (e.g. Drained is 3). The actual
  per-instance expiry lives on `CharacterTag.expiresTurn` (an absolute turn
  number, computed from this default at grant time), swept by
  `resolveNeeds()` in `db/index.js` once the closing turn's number reaches
  it.
- `removable` — whether a player can strip this tag off themselves mid-game
  without a GM. Catalog data only, same unenforced posture as `tradeable` —
  no self-removal flow reads it yet (the mid-game tag store isn't routed).
- `craftable` — whether this tag represents something a player can
  craft/make, as opposed to one that only ever arrives via role, GM grant,
  or automatic game logic. Catalog data only, same posture as `removable`.
- `requirementTurns` / `requirementResources` / `requirementGambit` /
  `requirementSkills` (YAML: nested under `requirement:` as `turnsCost` /
  `resourceCost` / `gambit` / `skills`) — what it costs a character to add
  or remove this tag in play (e.g. curing Arthritis needs Medical (Skilled)
  and some turns; forging the revolver tag costs turns, resources, and
  Smithing). `requirementSkills` is a many-to-many self-relation onto `Tag`
  (multiple skill tags accepted), resolved in `syncTags.js`'s pass 5. This
  is a GM adjudication reference, also shown to players — not
  automated/enforced by any code, same posture as `requiredTag`/`tradeable`.
  One shared block covers whichever direction (add or remove) is
  narratively relevant to a given tag, rather than separate blocks per
  direction. Rendered everywhere a tag's description already renders, in a
  minified form, via `formatTagRequirement()` (`db/lib/formatTagRequirement.js`,
  exported from `@lifeweb/db`) — see `TagChip.js`, `PointBuy.js`, and the
  🔍-inspect embed in `bot/src/events/messageReactionAdd.js`.

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
backing `{tag:slug}`/`{tag:id}` references,
`web/app/components/RichText.js`/`TagsProvider.js`), `TagChip.js`
(the hover-tooltip chip that renders group color).
