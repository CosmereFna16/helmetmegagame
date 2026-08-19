# Tag catalog

How the `Tag`/`TagGroup` catalog is structured, master-sourced, and synced.
Not to be confused with `CharacterTag` (an individual character's *holding*
of a tag) or `Location.tags` (free-text flavor strings on a Location,
unrelated to this system).

## 1. Category -> Group -> Tag

Three levels:

- **Category** — a flat string (`Meta`, `General`, `Skills`, `Status`,
  `Items`, `Companions`). Not its own DB table; `docs/tags.yaml`'s top-level
  `categories:` list is validation-only — `syncTagsFromYaml` rejects any
  tag/group whose `category` isn't in that list.
- **Group** (`TagGroup`) — optional, scoped to exactly one category, exists
  purely to color tags for display (e.g. Status's Health/Food/Buffs/Debuffs
  groups). A tag with no group renders uncolored. `TagGroup.color` is a key
  into a small fixed palette of theme-aware CSS custom properties defined in
  `web/app/globals.css` (`--tag-rose`, `--tag-amber`, `--tag-cyan`,
  `--tag-violet`, `--tag-sage`, `--tag-slate`) — never a raw hex value, so
  colors stay correct across the dusk/dawn theme swap the same way every
  other color in the app does.
- **Tag** — the catalog entry itself.

## 2. Master source: `docs/tags.yaml`

Same posture as `docs/locations.yaml`: hand-edited, `slug` is the stable
match key across syncs, and syncing is **upsert-only** — removing an entry
from the YAML never deletes its row, it just stops receiving updates.
`db/lib/syncTags.js#syncTagsFromYaml(prisma)` does the sync, run by hand via
`npm run db:sync-tags` (`db/prisma/sync-tags.js`) or automatically at the end
of `wipeGameData`'s "Restart Game" flow
(`web/app/(app)/gm/dev/actions.js`), right after `syncLocationsFromYaml`.

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

**Neither relation is enforced anywhere yet.** There's no player-facing
purchase flow (`purchasable`/`purchasableAfterStart` are catalog data for a
future store to read, same idea) and no code currently checks
`requiredTag`/`TagGroup.requiredTag` before showing or granting a tag — this
is catalog structure, ready for that logic when it's built.

## 4. Other fields

- `visibleOnInspect` — shown to another player who 🔍-reacts to this
  character's proxied messages (`bot/src/events/messageReactionAdd.js`).
  Defaults closed.
- `tradeable` — Items-category flag for a future trade flow; no transfer
  logic exists yet.
- `defaultDurationTurns` — catalog-level "how many turns does this last once
  granted," for tags that auto-expire. Purely additive; does **not** replace
  the bespoke `GameConfig.lifewebDrainedDurationTurns` knob that mechanic
  already uses. The actual per-instance
  expiry lives on `CharacterTag.expiresTurn` (an absolute turn number,
  unrelated to this default), swept by `resolveNeeds()` in `db/index.js`
  once the closing turn's number reaches it.

## 5. Things that used to be tags and aren't anymore

`Leader` and `Treasurer` were retired as tags in the same rework that
introduced this system — both are now plain booleans on `Character`
(`isLeader`, `isTreasurer`), assigned dynamically by a GM (Leader) or by a
GM/the faction's own Leader (Treasurer) from `/faction`
(`web/app/(app)/faction/actions.js`), exactly as before — only the storage
mechanism changed, not who can assign what. `Courtier` was deleted outright
(it only ever gated the now-ungated `Manor` tag). `Mortus` and `Hunter`
survived the "Role" category's retirement as ordinary tags (General and
Skills respectively) since both drive real logic elsewhere — Mortus gates
`/lifeweb` nav visibility, Hunter drives a production-tier check in
`bot/src/lib/labor.js`.

## 6. Where the code lives

`db/lib/syncTags.js` (the sync itself), `db/prisma/sync-tags.js` (terminal
entry point, `npm run db:sync-tags`), `docs/tags.yaml` (content),
`web/app/api/tags/route.js` (read API backing `{tag:slug}`/`{tag:id}`
references, `web/app/components/RichText.js`/`TagsProvider.js`), `TagChip.js`
(the hover-tooltip chip that renders group color).
