# Discord Channel Schematic

How Discord channels get their behavior in Lifeweb, and how visibility is
controlled. Two independent mechanisms are involved — channel *type/name*
(what the channel is for) and per-character *role permissions* (who can see
it) — and they're easy to conflate, so this doc keeps them separate.

## 1. Tupper / summary opt-in

A channel opts into tupper/summary behavior only by being one of a
provisioned Location's three channels (see §2), matched by Discord channel
ID — there is no name-based marker, and channel names are otherwise
meaningless to this system. Of the three: the plain (text) channel is both
tupper (auto-proxying, ❌/✏️/⭐ reactions) and summary (adjudication results
post there); the public (forum) and private (text) channels are tupper-only.

Two independent implementations check this: `bot/src/lib/channels.js`
(gateway cache, for the bot) and `web/lib/discordGuild.js`
(`isSummaryChannel`/`isTupperChannel`, REST-based, for the web app). Keep
them in sync if the rule changes.

## 2. Location channel layout

Each `Location` (e.g. "Church", nested under Zone "Town") maps to one
Discord category and three channels underneath it, created once by
`provisionLocationChannels` — either via the GM Panel's "Provision Discord
channels" button (`web/app/(app)/gm/dev/actions.js`) or in bulk by
`npm run db:sync-locations` (`db/prisma/sync-locations.js`, driven by
`docs/locations.yaml`). Both call sites build the exact same layout; keep
them in sync if it changes.

**Category name**: `"{Zone} / {Location}"`, e.g. `Town / Church`. Purely
cosmetic, for grouping in the Discord channel list — categories aren't
channels of type text/forum, so `isTupperChannel`/`isSummaryChannel` never
look at them. After provisioning, `sortLocationCategories`
(`web/lib/discordGuild.js`, mirrored standalone in `sync-locations.js`) runs
automatically to re-sort every Location category alphabetically by this
full name (zone first, then location within it) — it only reassigns
position values among existing Location category IDs, so any non-Location
category keeps its position untouched.

**Channels, created in this order** (which is also their display order,
since Discord assigns position by creation order):

| Channel | Type | Purpose | Slowmode |
|---|---|---|---|
| `church` | text | Summary channel — tupper proxying, turn/adjudication updates post here | 60s |
| `church-public` | forum | Subrooms — players spin up their own posts ("The Inn's Kitchen!"). Posts auto-archive (hidden from the active list, not deleted) after 24h of inactivity (`default_auto_archive_duration: 1440`) | — |
| `church-private` | text | Secret conversations — `@everyone` is denied `ViewChannel`/`SendMessages`/`CreatePublicThreads` but allowed `CreatePrivateThreads`, so it's only ever used to spin up a private thread and ping people into it. The `ViewChannel` deny is already inherited from the category (see §3) — it's set explicitly here too so Discord's own permissions UI shows it as an explicit deny on this channel instead of "inherited/neutral", which reads as unrestricted at a glance |

**Renaming**: editing a `Location.name` in the DB or in `locations.yaml`
after provisioning does **not** rename the live Discord category/channels —
this is deliberate (see the "never touches an already-provisioned Location"
guarantee in the root `CLAUDE.md`). Renaming live channels requires a
one-off script against the Discord REST API.

## 3. Visibility: category is hidden by default, per-character role grants access

The whole point of Locations is that a player only sees the Location their
character currently occupies — not the whole map. This is enforced entirely
at the **category** level (child channels inherit permissions):

- On provisioning, the category denies `ViewChannel` to `@everyone` and
  (if `DISCORD_GM_ROLE_ID` is set) explicitly allows it for the GM role, so
  GMs always see every category regardless of where their character is.
- Every `ALIVE` character has a personal Discord role named after the
  character (`Character.discordRoleId`, see root `CLAUDE.md` §"Zones,
  Locations, and character roles"). When a character's location changes,
  that role gets a single `ViewChannel` permission overwrite added on the
  *new* category and removed from the *old* one — never a static list of
  every character on every category. At any moment a category only carries
  overwrites for the (usually small) set of characters currently standing
  in it, which is also why this doesn't run into Discord's ~100-overwrite-
  per-channel ceiling even at 100+ players.

Three call sites keep a character's role overwrite in sync with
`Character.locationId`, all funneling through the same one-overwrite-per-
active-Location primitive:

| Trigger | Code | Mechanism |
|---|---|---|
| Player self-service travel (`⚜` button in the `location` channel) | `bot/src/lib/location.js#performMove` → `swapLocationAccess` | Gateway `Guild`/`Role` objects (bot already has them cached) |
| GM raw edit (`/gm/dev/characters/[characterId]`) | `web/app/(app)/gm/dev/actions.js#updateCharacterRaw` → `syncCharacterLocationAccess` | REST (`PUT`/`DELETE /channels/{id}/permissions/{roleId}`) — the web app has no gateway connection |
| New character created with a Location already set | not currently wired — new characters start with `locationId: null` per root `CLAUDE.md`, so this hasn't come up | — |

If a new call site ever sets `Character.locationId` directly, it needs to
call one of these two (or a shared equivalent) — a raw Prisma write alone
leaves the old category overwrite dangling and the new one missing.
`db/prisma/backfill-location-access.js` (`npm run db:backfill-location-access`)
is a one-off catch-up for characters whose `locationId` was set before these
call sites existed (mirrors `backfill-roles.js`'s role-creation catch-up).

## 4. Testing visibility: the guild owner always sees everything

Discord's permission system exempts the **guild owner** from every overwrite
— denies, category-level or channel-level, never apply to them. If the
account you're testing with owns the Discord server (true for whoever ran
the bot setup), every category will look visible to you regardless of what
overwrites are actually set, even with zero bugs in this system. To actually
observe the per-character gating, test from a non-owner account (an alt, or
a real player) — checking the raw permission overwrites via the REST API
(as done to diagnose/backfill this) is the reliable way to verify from the
owner's own account.
