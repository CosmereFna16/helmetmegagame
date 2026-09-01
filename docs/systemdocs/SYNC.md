# YAML masters and the sync scripts

Four hand-edited YAML files under `docs/` are the sole source of truth for
their tables. Each has a sync that reconciles the database to it. The four look
alike and **differ on every axis that matters**, which is the reason for this
page.

There is deliberately **no admin UI** for any of this. Editing the YAML and
running the sync is the only way these rows change.

## 1. The four at a glance

| Master | Script | Table(s) | Match key | Removal behaviour |
|---|---|---|---|---|
| `docs/zones.yaml` | `db:sync-zones` | `Zone`, `LocationTopic` | `slug` | **Destructive** — a dropped Zone loses its DB row, its Discord category/channels *and* its `Zone: {Name}` role; a dropped topic loses its forum post |
| `docs/tags.yaml` + `docs/taggroups.yaml` | `db:sync-tags` | `Tag`, `TagGroup` | `slug` | **Upsert-only** — never deletes; a removed entry just stops receiving updates. `db:prune-tags` is the opt-in destructive half (§3b) |
| `docs/roles.yaml` | `db:sync-roles` | `Faction`, `Role` | `slug` | **Prunes only if unreferenced** — a Faction with members, roles, or a non-zero silo is left in place and reported |
| `docs/documents.yaml` | `db:sync-documents` | `Document` | `key` | **Destructive** — pure reference content, no player state to preserve |

**Run order matters:** zones → tags → roles → documents. Roles resolve a
`starting_zone` by slug and a Faction's zone by name, and validate
`starting_tags` against the tag catalog; documents validate against tags, roles
*and* factions. Running them out of order throws on a reference that would have
existed.

`db:sync-narrowcast-channels` (§4) belongs right after `db:sync-zones`, because
`#intercom`'s static view grants name the zone roles the zone sync creates.

## 2. Where they differ, in detail

### Match keys

`slug` everywhere except `Document`, which uses `key`. **Zone and
`LocationTopic` share one slug namespace** — a topic named like a zone would
make "which thing is `town`?" ambiguous everywhere slugs are read, so the sync
rejects a duplicate across both lists. (This is why the old `town` Location is
the `town-square` topic.)

A changed `id` is not a rename: the old entry is pruned and a new one
provisioned from scratch, losing its Discord objects. Rename by editing `name`.

### Create-only fields

`Faction.silo` is **computed** — the sum of the faction's role weights,
scaled by `GameConfig.playerCount` (`db/lib/factionSilo.js`) — and seeded
**on CREATE only**. An existing faction's silo is live game state and an
ordinary re-sync must never overwrite it. The one deliberate exception is
`seedSilos: true` (`db:sync-roles -- --seed-silos`, and the Restart Game
wipe), which re-seeds every silo at its computed opening balance — without
it, a wipe would leave every silo at the 0 it was zeroed to, since no
faction row is ever *created* again after the first sync. Unaffiliated is
excluded and stays silo-less.

`Faction.parentFactionId` is create-only for the same reason. The hierarchy is
authored in `roles.yaml` (`parent:`), but once a faction row exists its parent
is **live game state** — a clan can break away mid-game, or be absorbed by
another, and that is a GM edit on `/gm/dev/factions`. An ordinary re-sync
leaves it alone, so it can't quietly re-parent a faction under the one it
rebelled against. `seedSilos: true` (`--seed-silos`, and the Restart Game
wipe) reasserts the authored hierarchy along with the authored silos — so
editing `parent:` in the YAML for a *future* game is still the right move, it
just doesn't reach a game already in progress.

### One-time vs every-run

`syncZones` is the one with a split personality:

- **One-time:** Discord category, channel and role *creation*, and their
  *names*. Keyed on the id columns being null. Renaming a zone in the YAML
  never renames a live channel. (One exception: a zone role recorded in the DB
  but **missing from the guild** is recreated — someone deleted it by hand, the
  doctor reports it, this repairs it.)
- **Every run:** channel topics and slowmode, permission overwrites, forum
  tags, category and channel ordering, the Create-a-Topic anchors, the
  `#private` anchor messages, the generated Location topic posts, the travel
  graph, `seatZoneId`, the map polygons, and the cursed role's colour.

The anchors and the topic posts are the every-run items that also cover
*freshly* provisioned zones — provisioning creates channels, never posts. All
three are gated on a content hash (`Zone.createTopicHash`,
`Zone.privateAnchorHash`, `LocationTopic.postHash`), so a re-sync with no YAML
edits makes no Discord writes for them at all, and a changed body is rewritten
in place rather than recreated. See `CHANNELS.md` §4.

### The zones.yaml format

```yaml
zones:
  - id: town              # stable slug; the match key
    name: Town            # display name, used only at first provisioning
    kind: surface         # surface | group  (a group's levels become CAVE_LEVELs)
    sort: 1
    description: >-       # the blurb on the Create-a-Topic anchor
    map:
      polygon: [[50, 30], [95, 30], ...]   # % of the 4:3 plate, or [] for a group
      label: { x: 74, y: 50 }
    topics:               # → LocationTopic rows → generated forum posts
      - id: church
        name: Cathedral
        description: >-
        subLocations:
          - name: Crypt
            description: ""
    levels:               # groups only; each becomes a standable CAVE_LEVEL zone
      - id: caverns
        ...

zoneConnections:          # the whole travel graph; every hop costs the Move
  - [town, fortress]
```

A `kind: group` zone may carry `levels:` but **not** `topics:` (topics belong
on its levels), and may never appear in `zoneConnections` — it isn't a place
you can stand. A non-group zone may not carry `levels:`. All of that is checked
in pass 0.

### Strict vs soft validation

Most references throw rather than half-apply — an unknown `parentTag`,
`requiredTag`, `starting_zone` or `starting_tags` name aborts the run. A
`starting_zone` must additionally be a **presence** zone: the Caves group is a
container, and a character can't start inside a container.

The one soft case is `zoneConnections` coverage: a presence zone in no pair at
all is **warned** about, not thrown on. It's legal in principle (a one-way
starting zone) and almost always a typo.

`documents.yaml`'s `tags:` list is the other deliberate exception. It conflates
real Tag names, the Leader/Treasurer booleans, and free-text authoring notes
like `"any of the medical tags"`. Each entry is routed to whichever bucket it
belongs in, and **anything matching nothing is reported, not thrown** — a
placeholder is a note to a human. The explicit `roles:`/`factions:`/`flags:`
keys next to it are strict and throw on a typo.

`syncTags` validates `consumesInto` up front against the YAML's own slug set,
before any write, so a typo fails cleanly instead of half-applying. It also
throws on `concealsIdentity` without `equippable` — a mask nobody can equip
could never conceal anything.

### Pass structure

`syncTags` runs **five passes**, because tags and groups reference each other
by slug before every row necessarily exists: TagGroup scalars → Tag scalars +
`groupId` → `parentTag`/`requiredTag` links → `TagGroup.requiredTag` links →
`requirement.skills`. Each pass writes only when something actually changed.

`syncZones` runs **five**:

0. **Parse + validate.** No writes at all. A malformed master fails the whole
   run before anything is touched.
1. **DB upsert.** Zones by slug (cave levels flattened out of their group's
   `levels:` list, parents before children so `parentZoneId` resolves in one
   sweep) → a second sweep stamping `seatZoneId` (`parentZoneId ?? id`) once
   every id exists → `LocationTopic` rows by slug → the connection graph,
   written both directions.
2. **Discord provisioning**, create-only: each presence zone's `Zone: {Name}`
   role, then categories and channels per `zoneChannelSpec`. Groups before
   levels, so a level can parent onto its group's category.
3. **Reconcile**, every run, for everything already provisioned — the list
   above. Freshly provisioned zones skip the overwrite reconcile (creation just
   applied the spec) but still get their anchors and posts.
4. **Prune.** Topics first (their posts live in zone forums), then zones —
   Discord objects and the role, then the row.

Two implementation details in pass 3 are load-bearing:

- Overwrites are reconciled **one request per target**, never a `PATCH` of the
  whole array. A wholesale replace would evict overwrites this sync doesn't own
  — the special channels' member grants, on the channels this same function is
  reused for.
- The delete half only touches a **managed set**: the GM role, the spectator
  role, the cursed role and the zone roles. `@everyone` is deliberately *not*
  in it — its `ViewChannel` deny is the single overwrite the entire privacy
  model rests on, and excluding it structurally means no future edit to the
  spec can turn this pass into the thing that strips a zone's privacy. Having
  the zone roles in the set is what makes a stray `Zone: Fortress` overwrite on
  a Town channel self-heal.

## 3. Restart Game

`wipeGameData` (`web/app/(app)/gm/dev/actions.js`, superadmin only) is the one
caller that runs the syncs together, from a retrying step runner. The full
order — and why each step sits where it does — is in `LAUNCH.md`; the sync half
is zones → special channels → tags → roles → documents, then the channel
doctor.

**This flow has been bitten by foreign-key ordering before.** Anything deleted
there has to come out in dependency order, and it's the main reason new log-ish
tables (`ArchiveEntry`, `SiloTransaction`, `AuditLog`, `SystemReport`)
deliberately use plain indexed id columns rather than real relations — see
`ARCHIVE.md`.

## 3b. Pruning tags

`db:sync-tags` never deletes, which is the right default — a tag a character
holds must not vanish because someone tidied a YAML file — but it means the
catalog only ever grows. `npm run db:prune-tags` is the separately-invoked
counterpart, and the only tag operation in this repo that deletes anything.

**It is a dry run by default.** Nothing is removed without `-- --apply`, the
same posture as `db:prune-orphan-roles` and `db:doctor`.

**Retiring a chain may take two applies.** Blockers are computed per run, so
a parent (`laborer-basic` under a removed `laborer-skilled`, a base tag under
its removed variants) is reported as still-referenced until the run that
deleted its children is over — run `-- --apply` again and it goes.

A Tag is deleted only when *every* one of these holds. Anything failing even
one is reported with its reason and skipped — never cascaded, never forced,
because a prune that skips silently is worse than one that deletes:

- its slug is absent from `docs/tags.yaml`;
- `Tag.custom` is false (a GM's homebrew is not orphaned just because the
  YAML never mentioned it — see `DEV-PANEL.md` §8);
- no `CharacterTag` references it;
- nothing names it as a `Tag.parentTagId`, a `Tag.requiredTagId`, a
  `requirementSkills` entry, or a **`TagGroup.requiredTagId`** — that last one
  is the hidden-category gate, and dropping it would silently open Demoness to
  everyone;
- nothing consumes into it (`Tag.consumesInto`);
- no `Role.startingTagSlugs` grants it and no `Document.tagSlugs` is assigned
  by it. Note `Role.startingTagSlugs` is misnamed and holds tag **names**,
  while `Document.tagSlugs` really does hold slugs.

It is deliberately terminal-only and **not** wired into Restart Game: a wipe
clears every `CharacterTag` first, so a prune running there would find every
custom tag unheld and delete the lot.

## 4. Repair and one-off scripts

The zone rework retired most of what used to be on this list. Every backfill
that patched per-Location channel overwrites (`db:backfill-member-access`,
`db:backfill-gm-permissions`, `db:backfill-spectator-access`,
`db:backfill-cursed-access`, `db:backfill-persistent-tag`,
`db:backfill-tupper-attachment-restriction`, `db:backfill-archive-channel-ids`)
is gone, along with `db:prune-orphan-categories` and `map:check`. What replaced
them is the every-run reconcile in `db:sync-zones` plus the channel doctor,
which fixes drift by diffing rather than by a script per symptom.

| Command | What it does |
|---|---|
| `db:doctor` | The channel doctor from a terminal. **Dry run by default**; `-- --apply` repairs, `-- --full` adds the expensive scope (overwrites, threads, invites, narrowcast) on top of the cheap role-membership checks. See `CHANNELS.md` §6. |
| `db:prune-orphan-roles` | Dry-run by default (`-- --apply`): deletes Discord character roles no living character claims. Only touches roles carrying the character-role signature (mentionable + `hashNameToColor` colour), so zone, divider and GM cosmetic roles are never candidates. Guards the 250-role guild cap. |
| `db:backfill-roles` | Creates the personal Discord role for characters that predate it. Does not assign it — nobody holds these. |
| `db:backfill-name-parts` | Repair pass for the four-part character name; also the drift check on the denormalized `Character.name`. |
| `db:backfill-fighting-split` | One-off: retires the `fighting-*` tag tree in favour of `melee-*`/`ranged-*` and rescales the point economy. No Discord. |
| `db:prune-tags` | Dry-run by default (`-- --apply`): the destructive counterpart to `db:sync-tags` — deletes any Tag row absent from `docs/tags.yaml`, skipping GM-created and referenced tags. |
| `db:sync-narrowcast-channels` | Provisions **and reconciles** the `radio` category and its `#watch`/`#intercom` channels from the special-channels registry. Run after `db:sync-zones`. |
| `db:rebuild-info-channel` | Destructive rebuild of `#info` from `infochannel.yaml` (`INFOCHANNEL.md`). |

## 5. Where the code lives

`db/lib/syncZones.js`, `syncTags.js`, `syncRoles.js`, `syncDocuments.js`,
`syncSpecialChannels.js`, each with a thin `db/prisma/sync-*.js` terminal
wrapper. `db/lib/zoneChannelSpec.js` is the one description of a zone's Discord
layout; `db/lib/channelDoctor.js` is the reconciler; `db/lib/fullWipe.js` is
the Restart Game nuke.
