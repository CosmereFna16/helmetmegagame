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
| `docs/locations.yaml` | `db:sync-locations` | `Zone`, `Location` | `slug` (**Zone by `name`**) | **Destructive** — dropped entry loses its DB row *and* its Discord category/channels |
| `docs/tags.yaml` + `docs/taggroups.yaml` | `db:sync-tags` | `Tag`, `TagGroup` | `slug` | **Upsert-only** — never deletes; a removed entry just stops receiving updates. `db:prune-tags` is the opt-in destructive half (§3b) |
| `docs/roles.yaml` | `db:sync-roles` | `Zone`, `Faction`, `Role` | `slug` | **Prunes only if unreferenced** — a Faction with members, roles, or a non-zero silo is left in place and reported |
| `docs/documents.yaml` | `db:sync-documents` | `Document` | `key` | **Destructive** — pure reference content, no player state to preserve |

**Run order matters:** locations → tags → roles → documents. Roles resolve
Locations by slug and Zones by name, and validate `starting_tags` against the
tag catalog; documents validate against tags, roles *and* factions. Running
them out of order throws on a reference that would have existed.

## 2. Where they differ, in detail

### Match keys

`slug` everywhere except `Document`, which uses `key`, and **`Zone`, which is
matched by `name`** — Zone has no slug column. That's a known fragility:
renaming a zone in the YAML creates a second zone rather than renaming the
first. `Location` additionally falls back to a name+zone match for legacy
pre-slug rows.

### Create-only fields

`Faction.silo` is seeded from `starting_resources` **on CREATE only**. An
existing faction's silo is live game state and a re-sync must never overwrite
it. This is the only field in any sync with that behaviour, and it's easy to
break by "fixing" the upsert to write all fields uniformly.

### One-time vs every-run

`syncLocations` is the one with a split personality:

- **One-time:** Discord category and channel *creation*, and their *names*.
  Keyed on `discordCategoryId` being null. Renaming a Location in the YAML
  never renames a live channel.
- **Every run:** the plain channel's topic, `mapX`/`mapY`, the full set of
  permission overwrites, and the generated `{Location}: Description` forum post.
  All derived from the spec rather than hand-authored, so a Location whose
  permissions drifted is repaired by an ordinary re-sync.

The description post is the one every-run item that also covers *freshly*
provisioned Locations — provisioning creates channels, never posts. It is
gated on a content hash (`Location.descriptionPostHash`), so a re-sync with no
YAML edits makes no Discord writes for it at all, and it is rewritten in place
rather than recreated. See `CHANNELS.md` §2b.

See `CHANNELS.md` §2–§3 for the channel layout and the overwrite set.

### Strict vs soft validation

Most references throw rather than half-apply — an unknown `parentTag`,
`requiredTag`, `starting_location` or `starting_tags` name aborts the run.

`documents.yaml`'s `tags:` list is the deliberate exception. It conflates real
Tag names, the Leader/Treasurer booleans, and free-text authoring notes like
`"any of the medical tags"`. Each entry is routed to whichever bucket it
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

`syncLocations` runs three: DB upsert → Discord provisioning and reconciliation
→ prune.

## 3. Restart Game

`wipeGameData` (`web/app/(app)/gm/dev/actions.js`, superadmin only) is the one
caller that runs the syncs together. It clears game state, runs
`runFullChannelWipe` (`db/lib/fullWipe.js` — a hard reset that spares nothing,
unlike the Dawn wipe), then re-runs `syncLocationsFromYaml`,
`syncTagsFromYaml`, `syncRolesFromYaml` and `syncDocumentsFromYaml` in that
order so a reset always lands on the canonical content.

**This flow has been bitten by foreign-key ordering before.** Anything deleted
here has to come out in dependency order, and it's the main reason new log-ish
tables (`ArchiveEntry`, `SiloTransaction`, `AuditLog`) deliberately use plain
indexed id columns rather than real relations — see `ARCHIVE.md`.

## 3b. Pruning tags

`db:sync-tags` never deletes, which is the right default — a tag a character
holds must not vanish because someone tidied a YAML file — but it means the
catalog only ever grows. `npm run db:prune-tags` is the separately-invoked
counterpart, and the only tag operation in this repo that deletes anything.

**It is a dry run by default.** Nothing is removed without `-- --apply`,
the same posture as `db:prune-orphan-categories`.

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

| Command | What it does |
|---|---|
| `db:backfill-member-access` | Migration to per-member access: grants each ALIVE character's **player** the ViewChannel overwrite on every channel of their current Location, drops the old role-keyed overwrites, and unassigns the personal role. Supersedes `db:backfill-location-access`. |
| `db:backfill-gm-permissions` | Adds the GM overwrite to already-provisioned Location channels. |
| `db:backfill-spectator-access` | Grants the spectator role read-only view on everything already provisioned. |
| `db:backfill-persistent-tag` | Adds the Persistent (⏰) forum tag to existing `-public` channels. |
| `db:backfill-tupper-attachment-restriction` | Merges the `ATTACH_FILES` deny onto existing categories. |
| `db:backfill-roles` | Creates the personal Discord role for characters that predate it. Does not assign it — nobody holds these. |
| `db:backfill-name-parts` | Repair pass for the four-part character name; also the drift check on the denormalized `Character.name`. |
| `db:backfill-tag-rework` | One-off tag catalog cleanup. No Discord. |
| `db:backfill-medical-expert` | Retires the old `medical-excellent` Tag row after the slug rename, moving its holders, cure requirements and child tiers onto `medical-expert`. Run **after** `db:sync-tags`, since it needs the new row to exist. No Discord. |
| `db:prune-orphan-categories` | Dry-run by default (`--apply`): deletes Location categories no `Location` row points at. |
| `db:sync-narrowcast-channels` | One-off provisioning for the `radio` category and its `#watch`/`#intercom` channels. |
| `db:rebuild-info-channel` | Destructive rebuild of `#info` from `infochannel.yaml` (`INFOCHANNEL.md`). |
| `map:check` | Pure geometry over `locations.yaml` — no DB, no Discord (`MAP.md`). |

## 5. Where the code lives

`db/lib/syncLocations.js`, `syncTags.js`, `syncRoles.js`, `syncDocuments.js`,
`syncNarrowcastChannels.js`, each with a thin `db/prisma/sync-*.js` terminal
wrapper. `db/lib/fullWipe.js` for the Restart Game nuke.
