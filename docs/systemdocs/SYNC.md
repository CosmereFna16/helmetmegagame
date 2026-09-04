# YAML masters and the sync scripts

Five hand-edited YAML files under `docs/` are the sole source of truth for
their tables. Each has a sync that reconciles the database to it. The five look
alike and **differ on every axis that matters**, which is the reason for this
page.

There is deliberately **no admin UI** for any of this. Editing the YAML and
running the sync is the only way these rows change.

## 1. The four at a glance

| Master | Script | Table(s) | Match key | Removal behaviour |
|---|---|---|---|---|
| `docs/zones.yaml` | `db:sync-zones` | `Zone`, `Location`, `Room`, `LocationYield` | `slug` | **Destructive** — a dropped Zone loses its DB row, its category, its `#summary` and its `Zone: {Name}` role; a dropped Location loses its channel and its `Location: {Name}` role; a dropped Room loses its thread and its stash (`RoomTag` cascades, `CARRY.md` §5). A `yield:` kind that leaves the YAML has its `LocationYield` row deleted; `base` is always written, but live drifted `current` is only reset when `base` itself changed (`LABORING.md` §3) |
| `docs/tags.yaml` + `docs/taggroups.yaml` | `db:sync-tags` | `Tag`, `TagGroup` | `slug` | **Upsert-only** — never deletes; a removed entry just stops receiving updates. `db:prune-tags` is the opt-in destructive half (§3b): it prunes a tag absent from `docs/tags.yaml`, and once no surviving tag sits in it, a group absent from `docs/taggroups.yaml` too |
| `docs/roles.yaml` | `db:sync-roles` | `Faction`, `Role` | `slug` | **Prunes only if unreferenced** — a Faction with members or roles is left in place and reported |
| `docs/desires.yaml` | `db:sync-desires` | `DesireTemplate` | `slug` | **Soft-retire** — a dropped slug is never deleted, only marked `retired: true` (hidden from every picker; existing `Desire` rows referencing it keep running). A slug that comes back has it cleared. See `DESIRES.md` §10 |
| `docs/documents.yaml` | `db:sync-documents` | `Document` | `key` | **Destructive** — pure reference content, no player state to preserve |

**Run order matters:** zones → tags → roles → desires → documents. Roles
resolve a `starting_zone` and an optional `starting_location` by slug, and a
Faction's zone by name, and validate
`starting_tags` against the tag catalog; desires validate `requires.anyRoles`/
`notRoles` against the Role catalog and `requires.anyTags`/`notTags` against
the Tag catalog, so it runs after both; documents validate against tags,
roles *and* factions. Running them out of order throws on a reference that
would have existed.

`db:sync-narrowcast-channels` (§4) belongs right after `db:sync-zones`, because
a registry entry's static `roleViewZones` grants name zone roles the zone sync
creates.

## 2. Where they differ, in detail

### Entry format: keyed maps, not sequences

Every catalog block in the masters is a **map keyed by the entry's own id** —
`town:`, `hungerless:`, `drink-alcohol:` — not a sequence of `- id: town`. The
reason is authoring, not parsing: an editor's outline labels a map entry with
its key and a sequence entry with its index, so 500 tags used to read as
"{} 0, {} 1, {} 2". A sequence with no id of its own (`subLocations:`,
`roles.yaml`'s four `zones:`, every scalar list) stays a sequence.

Each sync reads its block through `entriesOf()` in `db/lib/yamlEntries.js`,
which accepts either shape and hands back the old array of objects with the
key folded back in — so document order, and every sync that depends on it,
is unchanged.

### Match keys

`slug` everywhere except `Document`, which uses `key`. **Zones, Locations and
Rooms share one slug namespace** — a Location named like its own zone would
make "which thing is `town`?" ambiguous everywhere slugs are read, so the sync
rejects a duplicate across all three lists. (This is why Town's own Square is
`town-square`, not `town`.)

A changed `id` is not a rename: the old entry is pruned and a new one
provisioned from scratch, losing its Discord objects. Rename by editing `name`.

### Create-only fields

`Faction.parentFactionId` is create-only. The hierarchy is authored in
`roles.yaml` (`parent:`), but once a faction row exists its parent is **live
game state** — a clan can break away mid-game, or be absorbed by another, and
that is a GM edit on `/gm/dev/factions`. An ordinary re-sync leaves it alone,
so it can't quietly re-parent a faction under the one it rebelled against —
so editing `parent:` in the YAML for a *future* game is still the right move,
it just doesn't reach a game already in progress. A Leader secedes from
`/faction` too, not just a GM (`FACTIONS.md` §3).

`Faction.siloRoomId` is a **floor** rather than create-only, which is one
notch weaker. `roles.yaml`'s `silo:` names a Room slug, and the sync writes it
only while the faction has no silo at all. Re-pointing a silo in play writes a
non-null id, which the sync never touches — so a Leader's choice is as safe as
under create-only, and a faction that predates the column still gets the one
the YAML names for it. Rooms come from `db:sync-zones`, which runs first; an
unknown slug warns and skips rather than throwing.

A room's `stash:` is the same shape of promise. It takes either a flat list of
slugs (one each) or a map with `resources:` and an `items:` map of slug →
count. A stack already at or above the authored quantity is left alone, and
`resources` is written only while the room holds none — so a re-sync can
neither undo a player carrying the anvil off nor quietly duplicate it.

### One-time vs every-run

`syncZones` is the one with a split personality:

- **One-time:** Discord category, channel and role *creation*, and their
  *names*. Keyed on the id columns being null. Renaming a zone or Location in
  the YAML never renames a live channel. (One exception: a zone or Location
  role recorded in the DB but **missing from the guild** is recreated —
  someone deleted it by hand, the doctor reports it, this repairs it.)
- **Every run:** channel topics, permission overwrites, category and channel
  ordering, each Location's Room threads, its pinned anchor message, the
  travel graph, `seatZoneId`, the map polygons (dormant), and the cursed
  role's colour.

The Room threads and the anchors are the every-run items that also cover
*freshly* provisioned Locations — provisioning creates channels, never
threads or messages. Both are gated on a content hash (`Room.postHash`,
`Location.anchorHash`), so a re-sync with no YAML edits makes no Discord
writes for them at all, and a changed body is rewritten in place rather than
recreated. See `CHANNELS.md` §4.

### The zones.yaml format

```yaml
zones:
  town:                   # the key IS the stable slug the sync matches on
    name: Town            # display name, used only at first provisioning
    kind: surface         # surface | group  (a group's levels become CAVE_LEVELs)
    sort: 1
    description: >-       # zone-level blurb; prose only, not shown on any anchor
    map:
      polygon: [[50, 30], [95, 30], ...]   # dormant — see MAP.md
      label: { x: 74, y: 50 }
    locations:             # → Location rows → one text channel + role each
      town-square:          # zones/locations/rooms share ONE slug namespace
        name: Square
        description: >-     # the anchor's -# subtext and the channel topic
        yield: { hunting: 0.5, farming: 0.3, fishing: 0.7 }
                             # → LocationYield rows. Optional, 0–2, omit a kind
                             #   rather than writing 0. An absent kind CANNOT be
                             #   worked here at all. See LABORING.md §3.
        rooms:               # → Room rows → threads under the Location channel
          the-charon:
            name: The Charon
            description: >-
            access: [the-barons-key]   # non-empty ⇒ PRIVATE; any-of these tags admits
    levels:               # groups only; each becomes a standable CAVE_LEVEL zone
      caves:
        locations:
          ...

connections:              # the whole travel graph. ONE entry per edge — it is
                          # undirected, and listing it twice is an error.
  - [town/town-square, fortress/gatehouse]   # crosses zones: costs the Move
  - [town/town-square, town/cathedral]       # same zone: free, on the cooldown

  - pair: [fortress/gatehouse, fortress/road]   # the mapping form, for an
    announce: true_name                         #   edge that is not a plain
    modular:                                    #   open road
      roles: [watchman]
      tags: [watch-badge]
      open: true
  - pair: [fortress/undercroft, forest/forest-2]
    hidden: elevator-key
  - pair: [fortress/road, east-forests/east-forests-12]
    locked: mountaineering
    on_foot: true
```

A `connections` entry is either a **bare pair** — a plain open road, which is
most of the map — or a **mapping** carrying the edge's type. The keys compose,
because one real edge is a manned gate *and* a modular one at once:

| Key | Effect |
|---|---|
| `announce: true_name` | a **manned gate**: posts the crosser's real name into the destination zone's `#summary`. `/conceal` does not help |
| `announce: concealed` | an **unmanned gate**: posts only their concealed alias |
| `locked: <tag-slug>` | crossing needs the tag; the way is still **listed** |
| `hidden: <tag-slug>` | needs the tag **and** is absent from the travel list |
| `modular: { roles, tags, open }` | an Open/Close button on both anchors, impassable while shut |
| `keyed: true` | on crossing, DMs the key-holder "Leave open for the next 24 hours?" — needs a `locked` or `hidden` tag, since an open way has nothing to hold |
| `on_foot: true` | no horse or cart fits: a **mounted** character is refused at the threshold (`MAP.md` §2c) |

`locked` and `hidden` are the same requirement with different visibility, so an
entry may carry one or the other, never both. Each entry becomes exactly one
`LocationLink` row with endpoints in ascending slug order — see `MAP.md` §2a.

**`modular.open` is what a link is BORN with, not something the sync
re-asserts.** A gate somebody shut in play stays shut across a re-sync;
otherwise every sync would silently reopen the Gatehouse. `openUntil` is left
alone for the same reason — a keyed way somebody is holding open keeps standing
open for its 24 hours.

A `kind: group` zone may carry `levels:` but **not** `locations:` (locations
belong on its levels), and its own id may never appear in `connections` — it
isn't a place you can stand, only its levels' locations are. A non-group zone
may not carry `levels:`. Every presence zone needs **at least one** Location —
the parser throws otherwise. All of that is checked in pass 0.

`access:` slugs are **not** validated against the tag catalog — zones sync
before tags, so `docs/tags.yaml` doesn't exist to check against yet. A typo
there doesn't fail the sync; it just makes a room nobody can ever hold a key
to, and the channel doctor's `room-membership` check (`CHANNELS.md` §6) is
where that shows up, not this one.

The Tag and Role slugs a connection names — `locked`, `hidden`, and
`modular`'s `roles`/`tags` — are unvalidated here for exactly the same reason,
and the doctor's **`connection-slug`** check is where a typo surfaces. It
matters more than the room case: a locked way naming a tag that does not exist
is a way nobody can ever pass, and a *hidden* one is that plus invisible, so
nobody would even report it missing.

### Strict vs soft validation

Most references throw rather than half-apply — an unknown `parentTag`,
`requiredTag`, `starting_zone` or `starting_tags` name aborts the run. A
`starting_zone` must additionally be a **presence** zone: the Underground group
is a container, and a character can't start inside a container.

The one soft case is `connections` coverage: a Location in no pair at all is
**warned** about, not thrown on. It's legal in principle (a dead end nobody
walks to) and almost always a typo.

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

`syncZones` runs more passes now that a zone, a Location and a Room are three
separate tables:

0. **Parse + validate.** No writes at all. A malformed master fails the whole
   run before anything is touched.
1. **DB upsert**, in sub-passes: **1a** zones by slug (cave levels flattened
   out of their group's `levels:` list, parents before children so
   `parentZoneId` resolves in one sweep); **1b** a second sweep stamping
   `seatZoneId` (`parentZoneId ?? id`) once every zone id exists; **1c**
   Locations by slug (a Location whose zone changed keeps its channel and
   role — a text channel *can* reparent, done later by the ordering pass);
   **1c-bis** Rooms by slug (a Room whose location or `kind` changed can't
   just move — a thread can't reparent and can't change type — so its old
   thread is deleted and it's recreated fresh by the room-thread pass); **1d**
   the travel graph, both directions explicit.
2. **Discord provisioning**, create-only, in two sub-passes: **2a** one role
   per presence zone and one per Location; **2b** categories, `#summary`
   channels and Location channels per `zoneChannelSpec`/`locationChannelSpec`.
   Groups before levels, so a level's Locations can parent onto its group's
   category.
3. **Reconcile**, every run, for everything already provisioned — channel
   topics and overwrites. Freshly provisioned zones/Locations skip the
   overwrite reconcile (creation just applied the spec) but still get
   ordered, threaded and anchored below. Category and channel ordering run
   next, then **Room threads, then anchors** — in that order, because an
   anchor's body embeds its Rooms' thread mentions.
4. **Prune.** Rooms first (their threads live under Location channels), then
   Locations (channel, role, row — characters standing there are set null and
   the doctor reports them), then zones.
5. **`#turns` access**, last — its view grants are keyed on zone roles, and
   pass 2a can recreate a role with a new id partway through the run.

Two implementation details in pass 3 are load-bearing:

- Overwrites are reconciled **one request per target**, never a `PATCH` of the
  whole array. A wholesale replace would evict overwrites this sync doesn't own
  — the special channels' member grants, on the channels this same function is
  reused for.
- The delete half only touches a **managed set**: the GM role, the spectator
  role, the cursed role and every zone/Location role. `@everyone` is
  deliberately *not* in it — its `ViewChannel` deny is the single overwrite
  the entire privacy model rests on, and excluding it structurally means no
  future edit to the spec can turn this pass into the thing that strips a
  zone or Location's privacy. Having the zone/Location roles in the set is
  what makes a stray `Zone: Fortress` overwrite on a Town channel self-heal.

## 3. Restart Game

`wipeGameData` (`web/app/(app)/gm/dev/actions.js`, superadmin only) is the one
caller that runs the syncs together, from a retrying step runner. The full
order — and why each step sits where it does — is in `LAUNCH.md`; the sync half
is zones → special channels → tags → roles → desires → documents, then the
channel doctor.

**This flow has been bitten by foreign-key ordering before.** Anything deleted
there has to come out in dependency order, and it's the main reason new log-ish
tables (`ArchiveEntry`, `AuditLog`, `SystemReport`)
deliberately use plain indexed id columns rather than real relations — see
`ARCHIVE.md`.

## 3b. Pruning tags

`db:sync-tags` never deletes, which is the right default — a tag a character
holds must not vanish because someone tidied a YAML file — but it means the
catalog only ever grows. `npm run db:prune-tags` is the separately-invoked
counterpart, and the only tag/group operation in this repo that deletes
anything: it prunes a `Tag` absent from `docs/tags.yaml`, and — once no
surviving tag sits in it — a `TagGroup` absent from `docs/taggroups.yaml`
too.

**It is a dry run by default.** Nothing is removed without `-- --apply`, the
same posture as `db:prune-orphan-roles` and `db:doctor`.

**Retiring a chain may take two applies.** Blockers are computed per run, so
a parent (`laboring-basic` under a removed `laboring-skilled`, a base tag under
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
- no other tag lists it in `conflictsWith` (checked in both directions —
  `db:sync-tags` writes the edge symmetrically, but a custom tag's edge isn't
  guaranteed symmetric, so the blocker check reads both `conflictsWith` and
  `conflictedBy`);
- no **non-retired** `DesireTemplate` gates on it via
  `requiresAnyTags`/`requiresNotTags` — a gate held only by a retired
  template (`DESIRES.md` §10) no longer counts as a blocker;
- no `Role.startingTagSlugs` grants it and no `Document.tagSlugs` is assigned
  by it. Note `Role.startingTagSlugs` is misnamed and holds tag **names**,
  while `Document.tagSlugs` really does hold slugs.

It is deliberately terminal-only and **not** wired into Restart Game: a wipe
clears every `CharacterTag` first, so a prune running there would find every
custom tag unheld and delete the lot.

**A `TagGroup` prunes the same way, once it has no tags left.** After tags
are pruned, any group absent from `docs/taggroups.yaml` and holding no
surviving tag is deleted too. The `TagGroup.requiredTagId` blocker above
also has the mirror exception: a gate held by a group that's itself absent
from `docs/taggroups.yaml` no longer counts as a blocker on the tag it
gates, since that group is on its way out in the same run. Tag-to-tag
references work the same way: a `parentTag`, `requiredTag`, `conflictsWith`,
cure/craft skill or `consumesInto` reference made by a tag that is itself
being pruned does not pin its target, so a spell and its expiry marker can go
together. The prune loops to a fixpoint, so a tag that a character still
holds keeps everything it references.

## 4. Ops scripts

Everything that runs from a terminal lives under `db/scripts/`: `sync/` for
the YAML masters (§1) and `ops/` for the tools below. There are no repair
backfills left; the every-run reconcile in `db:sync-zones` plus the channel
doctor fix drift by diffing rather than by a script per symptom, and a
pre-launch wipe rebuilds everything else from YAML.

| Command | What it does |
|---|---|
| `db:sync` | All six masters in the working order (zones, narrowcast channels, tags, roles, desires, documents). |
| `db:doctor` | The channel doctor from a terminal. **Dry run by default**; `-- --apply` repairs, `-- --full` adds the expensive scope (overwrites, threads, invites, narrowcast) on top of the cheap role-membership checks. See `CHANNELS.md` §6. |
| `db:prune-tags` | Dry-run by default (`-- --apply`): the destructive counterpart to `db:sync-tags` — deletes any Tag row absent from `docs/tags.yaml`, skipping GM-created and referenced tags, then any TagGroup absent from `docs/taggroups.yaml` once no surviving tag sits in it. |
| `db:prune-orphan-roles` | Dry-run by default (`-- --apply`): deletes Discord character roles no living character claims. Only touches roles carrying the character-role signature (mentionable + `hashNameToColor` colour), so zone, divider and GM cosmetic roles are never candidates. Add `-- --include-catatonic` to also accept the Catatonic repaint (`CATATONIC_ROLE_COLOR` + the ` • Catatonic` suffix), which otherwise can never match — harmless while a character claims the role, but it strands one left by a finished game. "Permissionless" here means **`0` or exactly @everyone's bitfield**: Discord's create-role endpoint copies @everyone's permissions when the field is omitted, which `ensureCharacterRole` used to do, so a stricter test made this script a silent no-op. Guards the 250-role guild cap. |
| `db:prune-stale-channels` | Dry-run by default (`-- --apply`): deletes categories, channels and `Zone:`/`Location:` roles left behind by a **previous game** — objects no DB row points at any more. `db:sync-zones` cannot reach these: it only prunes a Zone/Location row that left `docs/zones.yaml` while the DB still holds its Discord ids, and the doctor never deletes a channel at all. So a retired layout lingers beside the live one under a category of the same name. Conservative by construction, with no hardcoded ids — a category is a candidate only when its name matches a live `Zone.name` *and* nothing in the DB references it, channels are only ever deleted as that category's children, and the run aborts outright if any candidate turns out to be referenced. |
| `db:report-inactive-characters` | Read-only: ALIVE characters with no activity since turn 1, and anyone who has left the guild. |
| `db:sync-narrowcast-channels` | Provisions **and reconciles** the `radio` category and its `#watch` channel from the special-channels registry. Run after `db:sync-zones`. |
| `db:rebuild-info-channel` | Destructive rebuild of `#info` from `infochannel.yaml` (`INFOCHANNEL.md`). |
| `db:set-bot-avatar` | Pushes `docs/assets/bot-icon.png` to the bot user's avatar. |
| `db:open-rp-channels` | Between games: opens every roleplay channel to the whole guild. Dry-run by default; writes an undo snapshot first. `db:sync-zones` re-walls them. |
| `db:backup` | Takes a Railway volume backup now (`scripts/db/railway-backup.sh`). `migrate.sh` runs it before every migration. |

## 5. Where the code lives

`db/lib/syncZones.js`, `syncTags.js`, `syncRoles.js`, `syncDesires.js`,
`syncDocuments.js`, `syncSpecialChannels.js`, each with a thin
`db/scripts/sync/*.js` terminal wrapper (`db/scripts/sync/all.js` runs them in order). `db/lib/zoneChannelSpec.js` is the
one description of a zone's Discord layout; `db/lib/channelDoctor.js` is the
reconciler; `db/lib/fullWipe.js` is the Restart Game nuke.
