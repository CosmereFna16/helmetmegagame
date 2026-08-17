# Discord Channel Schematic

How Discord channels get their behavior in Lifeweb, and how visibility is
controlled. Two independent mechanisms are involved — channel *type/name*
(what the channel is for) and per-character *role permissions* (who can see
it) — and they're easy to conflate, so this doc keeps them separate.

## 1. Tupper / summary opt-in

Any Discord channel becomes tupper-and-summary-enabled by one of two routes:

- **The `»` marker in its name.** Standard text channels with `»` anywhere in
  the name are both tupper (auto-proxying, ❌/✏️/⭐ reactions) and summary
  (adjudication results get posted there) channels. Forum channels with `»`
  are tupper-only.
- **Being a provisioned Location channel** (see §2) — these opt in by
  Discord channel ID instead, so the auto-generated channel names (`church`,
  `church-public`, `church-private`) don't need the marker themselves.

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

**Category name**: `"{Zone} » {Location}"`, e.g. `Town » Church`. Purely
cosmetic — for grouping in the Discord channel list — and unrelated to the
`»`-marker opt-in in §1 (categories aren't channels of type text/forum, so
`isTupperChannel`/`isSummaryChannel` never look at them).

**Channels, created in this order** (which is also their display order,
since Discord assigns position by creation order):

| Channel | Type | Purpose | Slowmode |
|---|---|---|---|
| `church` | text | Summary channel — tupper proxying, turn/adjudication updates post here | 60s |
| `church-public` | forum | Subrooms — players spin up their own posts ("The Inn's Kitchen!") | — |
| `church-private` | text | Secret conversations — `@everyone` is denied `SendMessages`/`CreatePublicThreads` but allowed `CreatePrivateThreads`, so it's only ever used to spin up a private thread and ping people into it | — |

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
