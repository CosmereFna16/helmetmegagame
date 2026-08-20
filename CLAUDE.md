# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Lifeweb is

Lifeweb is a huge, month-long asynchronous megagame set in a cryptic low-fantasy, sci-fi mix.

It's half-strategy, half-roleplay, meant to run smoothly at large scale (100+ players ideally) with each in-game day mapping to one real-world day. A website and a Discord bot work together to automate communication and mechanics so the game stays asynchronous and low-friction.

There's two faces to the game: the Discord and the web app. For the web app, priority is **functionality, usability, cleanliness, responsiveness, and browser performance**. The explicit reference point to avoid is the typical slow, laggy Discord bot dashboard — this needs to feel fast and scroll smoothly.

## Repository layout

This is an npm-workspaces monorepo with three packages:

- `bot/` — the Discord bot (discord.js v14). Entry point `bot/src/index.js`.
- `web/` — the web app (Next.js 16, App Router, JavaScript, Tailwind v4). Standard Next.js structure rooted at `web/app`.
- `db/` — shared data layer (`@lifeweb/db`). Prisma schema at `db/prisma/schema.prisma`, targeting PostgreSQL. Exports a singleton `PrismaClient` from `db/index.js` (`const { prisma } = require("@lifeweb/db")`) so the bot and web app read/write the same game state without duplicating connection logic. Models: `GameConfig`, `Faction`, `Zone`, `Character`, `Tag`/`TagGroup`/`CharacterTag` (see "Tags" below), `Turn`, `Action` (a turn's Move — see "Moves and adjudication" below), `DefaultEffort`, `AuditLog`.

Both `bot` and `web` are meant to depend on `@lifeweb/db` via the workspace once they need database access — add it with `npm install @lifeweb/db --workspace=<bot|web>` rather than duplicating a Prisma client per package.

Deployment target is Railway, deployed straight from this GitHub repo (`peace-lock/lifeweb`) — expect `bot` and `web` to run as two separate Railway services from the same repo, both pointing at one Railway Postgres instance.

## Commands

Run from the repo root unless noted.

```
npm install                          # installs all workspaces (bot, web, db)

npm run dev:web                      # next dev, in web/
npm run dev:bot                      # node --watch src/index.js, in bot/

npm run db:generate                  # prisma generate
npm run db:migrate                   # prisma migrate dev (needs DATABASE_URL set)

# YAML masters -> DB. Order matters: roles resolve Locations and validate
# Tags.
npm run db:sync-locations            # docs/locations.yaml  (destructive)
npm run db:sync-tags                 # docs/tags.yaml       (upsert-only)
npm run db:sync-roles                # docs/roles.yaml      (prunes unreferenced)

# One-off provisioning for #radio/#intercom — see "Narrowcast channels" below.
npm run db:sync-narrowcast-channels

npm run build --workspace=web        # production build of the web app
npm run lint --workspace=web         # eslint over the web app
```

Environment variables (see `.env.example`): `DATABASE_URL`, `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_GM_ROLE_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `AUTH_SECRET`. Neither package has test infrastructure set up yet.

## How the bot populates the database

On `ready`, the bot upserts a `GameConfig` singleton row. `guildMemberAdd` writes a `member_joined` `AuditLog` entry. The `GuildMembers` intent is privileged — it must be enabled for the bot application in the Discord Developer Portal (Bot -> Privileged Gateway Intents -> Server Members Intent) or the bot will fail to log in.

`Faction` rows have no connection to Discord roles — they're a pure Lifeweb game-state concept, master-sourced from `docs/roles.yaml` via `npm run db:sync-roles` (see "Character creation and roles" below) and editable by GMs on `/faction` and `/gm/dev/factions` (`web/app/(app)/faction/actions.js`, `web/app/(app)/gm/dev/actions.js`). Discord's native roles (used for faction pings, etc.) are independent and unmanaged by Lifeweb.

## Web app auth

The web app uses Auth.js (`next-auth@5`, `web/lib/auth.js`) with the Discord provider for login — `session.discordUserId` is the Discord user ID, attached via the `jwt`/`session` callbacks. `Character` rows are looked up by `discordUserId`, not by a separate user table. GM-only pages (`web/app/gm`) check the signed-in user's guild roles via `web/lib/discordGuild.js`, which calls the Discord REST API with the bot token (`DISCORD_TOKEN`) against `DISCORD_GUILD_ID`/`DISCORD_GM_ROLE_ID`, rather than trusting anything from the OAuth profile itself.

## Confirm dialog

For any "are you sure?" moment in the web app, use the shared confirm dialog instead of rolling a one-off modal or `window.confirm`. `web/app/components/ConfirmProvider.js` mounts once in `web/app/layout.js` (wrapping the whole tree) and exposes `useConfirm()`, a promise-based hook: `const confirm = useConfirm(); if (!(await confirm({ title, message, confirmLabel, cancelLabel }))) return;`. All fields are optional and it reuses the existing `.modal-overlay`/`.modal-panel` styling, so it matches every other modal in the app for free.

## Web app style conventions

Source of truth for exact values is `web/app/globals.css` and the font setup in `web/app/layout.js` — this section is a map of what's there and the rules for using it, not a copy of the values themselves (keep it that way; don't let this drift into a duplicate that can go stale).

**Fonts** — three faces loaded via `next/font/google` in `layout.js`, exposed as CSS variables on `<html>`:
- `--font-mono` (IBM Plex Mono) is the app default, set on `body`. Everything (chrome, tables, forms, buttons) stays in this unless a rule below says otherwise.
- `--font-serif` (Source Serif 4) is applied automatically to every `h1`/`h2` by a global CSS rule — never hand-apply a font class to a heading, just use the tag.
- `--font-display` (UnifrakturMaguntia, a gothic/blackletter face) is reserved for a handful of thematic moments — the login wordmark and a couple of flavor-heavy titles — via `.font-display`/`.wordmark`. Never use it for bulk headings, loading-state text, or arbitrary player-authored content; it's illegible at small sizes and reads as a mismatch everywhere else (this is the mistake fixed on the `/lifeweb` panel's `loading.js`).

**Colors** — entirely CSS custom properties (`--bg`, `--panel-bg`, `--field-bg`, `--border`, `--muted`, `--text`, `--accent`, `--positive`, `--row-hover`), redefined per-theme under `[data-theme="dusk"]`/`[data-theme="dawn"]` in `globals.css` (theme follows the current turn's phase, see `themeForPhase`). Never hardcode a hex/rgb color in a component — always reference a token via `var(--x)`, so it tracks the active theme.

**Shared classes** — use these instead of rolling one-off markup:
- `.panel` for any card/section container.
- `.btn` / `.btn-quiet` for buttons.
- `.field` wrapping a `.field-label` + input/textarea/select is how *every* form control in the app gets themed (background, border, font). A bare `<select>`/`<input>` outside `.field` falls back to unstyled native browser chrome and visibly breaks the theme — always wrap it, even for a single standalone control.
- `.chip` for small tag/pill labels, `.data-table` for tabular data, `.menu-item` for link-like row actions.
- `.modal-overlay`/`.modal-panel`, normally reached via `useConfirm()` (see "Confirm dialog" above) rather than built by hand.

**Page shell convention** — every top-level page follows `<div className="mx-auto flex max-w-{2xl–6xl} flex-col gap-6 p-6 sm:p-8">` with `<h1 className="text-2xl font-bold">{Title}</h1>` as the first child (the serif face and weight come from the rules above — don't add `text-3xl` or other one-off sizing). Its `loading.js` skeleton mirrors this: same shell at `max-w-5xl`, the same `<h1>`, and a `.panel animate-pulse p-4` block reading `Loading…` in `var(--muted)`.

## Character proxying ("tupper" messages)

Players edit their character's name, profile picture, and appearance/bio on `/character`. Profile pictures are stored as bytes on `Character.avatarData`/`avatarMimeType` (resized/compressed with `sharp` on upload) rather than in a third-party bucket, and served back out by the web app itself at `/api/avatar/<characterId>` — the bot builds this into a full URL via `WEB_BASE_URL` when it needs an `avatarURL` for a webhook.

Tupper and summary channels are not manually configured — a channel opts in only by being one of a provisioned Location's plain/public/private channels (see "Zones, Locations, and character roles" below, and `docs/systemdocs/CHANNELS.md`): the plain (text) channel is both tupper *and* summary, the public (forum) and private (text) channels are tupper-only. The narrowcast channels `#radio`/`#intercom` (see below) are also tupper-only, same as a Location's public/private channels — they aren't tied to a place, so they're never summary. `bot/src/lib/channels.js` (gateway cache) and `web/lib/discordGuild.js` (`isSummaryChannel`/`isTupperChannel`/`listGuildChannels`, REST-based) are the two independent implementations of this rule — keep them in sync if it changes. Inside a tupper channel, `bot/src/events/messageCreate.js` auto-proxies every message from a user with an `ALIVE` character: it reposts the message via a per-channel webhook (`bot/src/lib/proxy.js`) using the character's name/avatar, then deletes the original — no bracket/trigger syntax needed, since each player only has one living character at a time. `bot/src/events/messageReactionAdd.js` handles ❌ (delete), ✏️ (DM-based edit), and ❓ (DMs the character's bio) on proxied messages, tracked in an in-memory map (fine at this scale — single bot process, no sharding).

This requires the `MESSAGE_CONTENT` privileged intent enabled for the bot application (Discord Developer Portal -> Bot -> Privileged Gateway Intents), in addition to the `GuildMembers` intent already noted above.

## Nickname sync

Every `ALIVE` named character's Discord server nickname is kept as `{base} | {characterName}` — `base` is `Character.preferredNickname` if the player set one on `/character`, else their Discord display name — truncated to fit Discord's 32-char cap (both halves shrink proportionally, not just one). Nothing here polls: `bot/src/lib/nickname.js#syncMemberNickname` is called instantly from `bot/src/events/userUpdate.js` (fires the moment a player's Discord username/display name changes) and from `guildMemberAdd.js` (rejoins), the same event-driven pattern as everything else in this bot (`isTupperChannel`/`isSummaryChannel`, action confirms). `web/lib/discordGuild.js#syncCharacterNickname` does the REST-based equivalent immediately after a character is created or its name/nickname is edited on `/character`, so saves reflect in Discord without waiting on any bot event. `bot/src/events/ready.js` also runs a one-time bulk `syncNicknamesForGuild` on every connect/reconnect — a catch-up resync for anything missed while the bot was offline, not a recurring tick. `buildNickname()` is duplicated by hand between `bot/src/lib/nickname.js` and `web/lib/discordGuild.js`, same convention as `isTupperChannel`/`isSummaryChannel`.

## Moves and adjudication

There is no more Effort/Move split — every turn submission is a **Move**, which is either **Routine** or **Gambit** (`Action.moveKind`; only Gambit rolls a d6) and may additionally be flagged **Opposed** (`Action.opposed`). A message posted in the channel named exactly `turns` becomes a `PENDING_TYPE` `Action` via `bot/src/lib/actionSubmission.js#handleActionSubmission` — it deletes the original message, records the character's current zone, and DMs the player **one message** carrying a Kind select menu, an Opposed select menu, and a Confirm button (`bot/src/lib/moveComponents.js#buildMoveComponents`/`buildMoveContent`). Changing either dropdown writes straight to the `Action` row and re-renders the same message in place via `interaction.update()` — nothing is ever deleted and resent, unlike the old reaction-based picker. All three components are handled in `bot/src/events/interactionCreate.js` (`move:kind:<actionId>`, `move:opposed:<actionId>`, `move:confirm:<actionId>` custom IDs): `handleMoveConfirm` requires a Kind to already be chosen, rolls 1d6 only if `moveKind === "GAMBIT"`, edits the DM to `» *Waiting on adjudication...*` with components stripped, and flips the action to `CONFIRMED`. DMs no longer carry any reaction-driven flow — `bot/src/events/messageReactionAdd.js` only handles guild-channel reactions (tupper ✏️/❌/🔍/⭐, GM 🌫️), and the bot no longer requests the `DirectMessageReactions` gateway intent. Posting a second Move in `#turns` on the same turn is deleted with a DM (`» *You've already sent a Move this turn...*`) rather than recorded.

Turns advance via `advanceTurn()` in `db/index.js` — resolves Needs on the open turn, closes it, opens the next with alternated phase, then owns every Discord side effect itself (REST-only, no gateway needed): posting the `#turns` announcement (`db/lib/turnAnnouncement.js`) and, if the new phase is `DAWN` and `GameConfig.messageWipeEnabled` is on, the Dawn message wipe (`db/lib/dawnWipe.js` — see `docs/systemdocs/CHANNELS.md` §5). Both are best-effort (`.catch()`'d) so a Discord-side failure never blocks the turn advance. Called from two places, each of which now just adds its own `AuditLog` entry afterward: the bot's twice-daily cron (`bot/src/lib/turnEngine.js`) and the superadmin's "End turn" button on `/gm/dev` (`forceAdvanceTurn` in `web/app/(app)/gm/dev/actions.js`) — manual turn control lives only in the Dev Panel now, not on `/gm/turns`. The Dev Panel's Current Turn widget can also directly overwrite the open turn's day/phase (`updateCurrentTurn`) without resolving Needs, for raw correction.

GM-side **adjudication** (reviewing and resolving submitted Moves) has been gutted and is being rebuilt from scratch — `/gm/turns` ("Adjudicate" in the nav) is currently a bare placeholder page with no Moves table or editor. The `Action` fields it used to drive (`moveReviewStatus`, `resultMessage`, `gmNotes`, `resourceDelta`) are still on the schema and still written by the auto-resolved zone-change (`bot/src/lib/location.js#performMove`) and labor (`bot/src/lib/labor.js#performLabor`) flows, and still read read-only by `CharacterSheet.js`'s status line — only the GM editor UI/actions were removed. Group Moves (a leader pinging/naming other players into one shared Move) are purely narrative — there's no participant tracking in the schema; per the Leader system design pillar, anyone who doesn't submit their own Move is assumed to follow their faction leader's.

## Zones, Locations, and character roles

See also `docs/systemdocs/CHANNELS.md` for the full schematic of the Location Discord layout (category/channel naming, slowmode, forum-vs-text) and how per-character role visibility is kept in sync.

Geography is two levels: `Zone` (e.g. "Town") and `Location` (e.g. "cathedral", nested under a Zone via `Location.zoneId`). Each `Location` maps to a standard Discord layout — one category plus three channels named after the location (`cathedral`, `cathedral-public`, `cathedral-private`).

`docs/locations.yaml` is the **sole master** for the Zone/Location list (`id` slug, `name`, `zone`, `description`, `publicSubLocations`, `privateSubLocations`, free-text `tags`) — there is no manual "add/edit Zone/Location" UI at all (the `/gm/dev/zones` Dev Panel page, its nav link, and its `provisionLocationChannels`/`updateLocation`/`updateZone` actions were removed since locations are never hand-edited mid-game; `db/prisma/seed-zones.js`, the old hardcoded seed script, was deleted earlier along with the original manual UI). Editing the YAML and running `npm run db:sync-locations` (`db/prisma/sync-locations.js`, a thin wrapper around `db/lib/syncLocations.js#syncLocationsFromYaml`) is the only way Zones/Locations get created, updated, or removed. It's a **manual, terminal-invoked command by default** — no cron, no per-turn hook — but the same `syncLocationsFromYaml(prisma)` function is also called automatically at the end of `wipeGameData`'s "Restart Game" flow (`web/app/(app)/gm/dev/actions.js`), so a reset always lands the game on the canonical location set. The sync is **fully destructive**, matched by `Location.slug`: any Zone/Location no longer listed in the YAML has its Discord category+channels deleted and its DB row removed (Zones are pruned too, once they have zero remaining Locations and no longer appear in the YAML) — there's no undo short of re-adding the entry, which provisions a brand-new category/channels rather than restoring the old ones. New/still-missing Locations get Discord channels provisioned — one category plus three channels — for any Location still missing `discordCategoryId`; **provisioning itself and channel/category *names* stay one-time** (re-running the sync on an already-provisioned Location never renames or recreates its channels), but `description`/`publicSubLocations` keep syncing on every run: they're rewritten into the plain (summary) channel's topic as `{description} | **Sublocations**: {publicSubLocations, comma-joined}`. Locations start unprovisioned (all `discord*Id` fields null) until synced.

Every `ALIVE` character gets a personal Discord role titled after their character name (`Character.discordRoleId`), colored deterministically from a curated muted cyan/terracotta/brown/green palette (`db/lib/roleColor.js#hashNameToColor` — same name always yields the same color, so a rename very likely changes it too). `web/lib/discordGuild.js#ensureCharacterRole` creates+assigns the role the first time a character has a name, and renames/recolors it on every later profile save — called from both `updateCharacterProfile` (self-service, `web/app/(app)/character/actions.js`) and `updateCharacterRaw` (GM raw edit, `web/app/(app)/gm/dev/actions.js`). `db/prisma/backfill-roles.js` (`npm run db:backfill-roles`) is a one-off catch-up for characters that predate this.

This personal role is also the **sole access-control primitive** for Locations: a single `ViewChannel` permission overwrite on the Location's category (its three channels inherit it) is added for a character's role when they arrive and removed when they leave — `bot/src/lib/location.js#swapLocationAccess` (gateway, self-service travel) and `web/lib/discordGuild.js#syncCharacterLocationAccess` (REST twin, called from `updateCharacterRaw` on GM raw location edits) are the two call sites. The `-private` channel additionally denies `SendMessages`/`CreatePublicThreads` and allows `CreatePrivateThreads` for `@everyone`, so it's only ever used for GM-spun-up secret side-conversations, never top-level chat (same "private threads for secret conversations" concept referenced in the Notes scoping, below). All three Location channels count as tupper channels, and the plain channel also counts as a summary channel — `isTupperChannel`/`isSummaryChannel` (`bot/src/lib/channels.js`, `web/lib/discordGuild.js`) check Location channel IDs directly; there is no name-based marker.

Players self-serve travel from the guild's single `location` text channel (read-only for `@everyone`, locked down by `bot/src/lib/location.js#ensureLocationPrompt` on bot ready): it carries one tracked message with a ⚜ **button** (not a reaction — Discord modals can't contain dropdowns and reactions can't open ephemeral UI, so this is the bot's first use of buttons/select-menus/`interactionCreate`, handled in `bot/src/events/interactionCreate.js`). Clicking it opens a private, ephemeral Zone → Location cascade of select menus ending in a Confirm button. `bot/src/lib/location.js#performMove` decides the cost: moving to a Location **within the character's current Zone is free** (no `Action` created); moving to a **different Zone spends the turn** — it's submitted as a real, auto-resolved `Action` (`status: CONFIRMED`, `moveReviewStatus: SOLVED` immediately, no GM step, tagged `gmNotes: "auto:zone_change"` so it's identifiable), which naturally lands in `/gm/turns`' Moves history rather than the pending queue. This reuses the same turn-economy as Move submissions: `bot/src/lib/actionSubmission.js` now checks for *any* existing `Action` on the open `Turn` (including an auto-resolved zone-change) before accepting a new Move, and `performMove` does the same check in reverse — so acting and changing zones are mutually exclusive within a turn, in either order.

`Character.zoneId` is kept as a denormalized mirror of `location.zoneId` (updated in the same write as `locationId`) purely so the pre-existing zone-stamping on `Action`/`DefaultEffort`/`Note` and the zone-filter UI across `/gm/players`, `/gm/turns`, and `/notes` keep working unchanged — `locationId` is the authoritative "where is this character" field. New characters start with `locationId: null` (no location channel access) until a GM assigns one via `/gm/dev/characters/[characterId]` — there's no default-starting-location config.

## Character creation and roles

A signed-in player with no `ALIVE` character sees the **creation wizard**
rendered inline at `/character` (there is no `/character/new` route — it was
removed). Four steps: name → role → point-buy → confirm.

`docs/roles.yaml` is the master for the `Zone`/`Faction`/`Role` tables, synced
by `db/lib/syncRoles.js#syncRolesFromYaml` (`npm run db:sync-roles`), which
replaced the old `db/lib/factionSync.js`. Its `zones[].threats[]` block is
deliberately **never synced** — those are hand-assigned GM seats and must not
appear in the picker. Roles are matched by `slug`, carry a starting package
(faction, `starting_location` slug, resources, `starting_tags`,
`leader:`/`treasurer:` booleans), and declare seat caps via `multiple`/`weight`
— `weight` meaning seats per 100 players, scaled live by
`GameConfig.playerCount`. `db/lib/roleCapacity.js#roleCapacity` is the one
place that math lives. The sync throws on an unknown `starting_location` or
`starting_tags` name rather than half-applying.

Point-buy budget is `GameConfig.startingTagPoints` (default 12) plus the
role's `extra_starting_points` minus 3 if the player is Cursed;
`web/lib/characterCreation.js` holds that arithmetic and is shared by the
wizard, the server action, and the GM panel. `Tag.pointCost` is signed —
negative-cost drawbacks grant points and are always
`purchasableAfterStart: false`. Unspent points land on `Character.tagPoints`.
`web/app/components/PointBuy.js` is one component serving both menus via an
`afterStartOnly` flag (creation passes `false`; the mid-game store, not yet
routed, passes `true`).

`createCharacter` (`web/app/(app)/character/createActions.js`) re-validates
everything the client sent — a server action is a public endpoint — and
re-counts the seat cap **inside** the creating transaction, which is what
resolves two players racing for the last Baron seat.

**Cursed** is a live Discord role (`DISCORD_CURSED_ROLE_ID`), not a DB field,
so it outlives the character that earned it and a GM can grant it by hand
(narrative punishment) with no code path needed. `killCharacter` grants it on
death; `createCharacter` removes it the moment the cursed player successfully
rolls a new one — the curse doesn't stick around. While cursed a player may
only return as a Migrant or a Bum, with 3 fewer points
(`web/lib/characterCreation.js`). A GM clears the curse early (body buried /
rites read) by removing the role directly in Discord — `/gm/dev/characters/
[characterId]` only shows a read-only status line, there's no app-side
toggle.

Death is no longer a bare column write:
`web/lib/discordGuild.js#killCharacter` deletes the personal Discord role
(which takes its Location and narrowcast-channel overwrites with it), nulls
`discordRoleId`, clears the nickname, and sets the curse.

Full writeup: `docs/systemdocs/CHARACTERS.md`.

## Narrowcast channels (`#radio`, `#intercom`)

`#radio` and `#intercom` sit outside the Location layout, gated on Zone/
Location and Tags rather than on standing in a Location, using the **same**
access primitive Locations do — a permission overwrite on the character's own
personal Discord role — rather than a separate gate role per channel.
`#radio` is viewable/speakable by anyone holding the Radio tag unless they're
in Depths; `#intercom` is viewable by anyone in Fortress or Town, speakable
only by an Intercom-tagged character standing in the Keep. Rules live in
`db/lib/narrowcastAccess.js`; reconciled by `bot/src/lib/location.js`'s
`syncCharacterNarrowcastAccess` (gateway, after every Move) and
`web/lib/discordGuild.js`'s function of the same name (REST, on character
creation, GM raw location edits, and `grantTag`/`revokeTag`). Channel
provisioning (channel ids cached on `GameConfig.radioChannelId`/
`intercomChannelId`) is a one-off script,
`npm run db:sync-narrowcast-channels`. Both channels are also tupper-only
(see "Character proxying" above) — `bot/src/lib/channels.js`'s
`refreshLocationChannels`/`web/lib/discordGuild.js`'s
`fetchLocationChannelIds` fold `GameConfig.radioChannelId`/
`intercomChannelId` into the same tupper-only set as a Location's public/
private channels. See `docs/systemdocs/CHANNELS.md` §6.

## Tags

`docs/tags.yaml` is the **sole master** for the `Tag`/`TagGroup` catalog, same posture as `docs/locations.yaml` — hand-edited, `slug` is the stable match key, and `db/lib/syncTags.js#syncTagsFromYaml` (run via `npm run db:sync-tags`, or automatically at the end of `wipeGameData`'s "Restart Game" flow right after `syncLocationsFromYaml`) is upsert-only and never deletes a row just because its YAML entry was removed. A `Tag` belongs to a `category` (a flat string validated against `tags.yaml`'s own `categories:` list, not a DB table: `Meta`, `General`, `Skills`, `Status`, `Items`, `Companions`) and optionally a `TagGroup` scoped to that category, which exists purely to color the tag via a fixed palette of theme-aware tokens in `web/app/globals.css` (`--tag-rose`/`-amber`/`-cyan`/`-violet`/`-sage`/`-slate`) — a groupless tag just renders uncolored. Full schema/mechanism writeup, including the two distinct self-relations (`parentTag`, a replacing tier chain like Fighting (Basic) → (Trained) → ...; vs. `requiredTag`, a non-replacing prerequisite like Fighting (Archer) requiring Fighting (Basic) while coexisting with higher Fighting tiers — neither relation is enforced by any code yet), is in `docs/systemdocs/TAGS.md`. `pointCost`/`purchasable`/`purchasableAfterStart` are no longer inert catalog data: they drive the point-buy menu (see "Character creation and roles" above). `web/app/api/tags/route.js` feeds the read-only catalog to `TagsProvider`/`RichText.js`'s `{tag:slug}`/`{tag:id}` inline references and to `TagChip.js` (the hover-tooltip chip used everywhere a character's tags render, e.g. `CharacterSheet.js`).

`Leader`/`Treasurer` are **not** tags — both are plain booleans on `Character` (`isLeader`, `isTreasurer`), assigned dynamically from `/faction` (`web/app/(app)/faction/actions.js#setFactionLeader`/`setTreasurer`) by a GM (Leader) or a GM/the faction's current Leader (Treasurer), and read by `web/lib/factionPermissions.js#getMyFactionRole` to gate Silo management. `Character.status === "ALIVE"` isn't a tag either.

## Discord permission model

There is no single unified permission system — a few independent kinds of Discord role drive access, each synced from a different piece of state, plus one env-configured admin role. `Faction` is not one of them — it's a pure Lifeweb game-state concept (see "How the bot populates the database" above) with no Discord role backing it at all.

- **Personal character role** (`Character.discordRoleId`, one per `ALIVE` character, titled after the character's name) — the sole access-control primitive for Location categories (see above). Created/renamed by `ensureCharacterRole`, granted/revoked per-category by `swapLocationAccess`/`syncCharacterLocationAccess`.
- **GM role** (`DISCORD_GM_ROLE_ID` env var) — checked via REST (`web/lib/discordGuild.js#isGm`) against the signed-in user's guild member roles to gate `/gm` pages and the `/gm`/`/message` slash commands; not stored on any Lifeweb model.
- **Narrowcast channels** (`#radio`, `#intercom`) use the personal character role above, not a separate role — see "Narrowcast channels" below.
- **Turn-ping role** (`DISCORD_TURN_PING_ROLE_ID` env var) — a plain opt-in notification role, added/removed by `setTurnPingRole` when a player toggles "Turn Ping?" on `/character`.

## Info channel

`#info` is a static, GM-authored player directory (game pitch, rules, and a
set of topic threads), maintained entirely outside the DB. Its content lives
in `docs/systemdocs/infochannel.yaml`; editing that file and running
`npm run db:rebuild-info-channel` (`db/prisma/rebuild-info-channel.js`) wipes
every message and thread on the channel and reposts from scratch — a full
destructive rebuild every time, never an upsert, since there's no player
state on that channel to preserve. See `docs/systemdocs/INFOCHANNEL.md` for
the full mechanism.

## Notes

Reacting ⭐ to a proxied message in any Location channel saves it as a personal `Note` for whoever reacted — `bot/src/events/messageReactionAdd.js#handleStarReaction` upserts a `Note` row keyed on `(discordMessageId, discordUserId)` with the sending character, a zone snapshot, content, and `sentAt`. This only works for messages still in `recentProxies` (bot's in-memory, last-500, resets on restart — see [[proxy.js]] note above), same constraint as ❌/✏️/❓. Universal rule for ⭐ specifically: right after processing, the bot always strips the reaction back off (`reaction.users.remove(user.id)`), for any user, on any message — so Discord never shows an accumulating star count, and the note living on `/notes` is the only lasting record. There's no "react again to unstar" — unstarring only happens from the web UI's delete button (`unstarNote` in `web/app/(app)/notes/actions.js`), which just deletes the row.

`/notes` (`web/app/(app)/notes/page.js`) is strictly personal and identical for both roles: every signed-in user, GM or player, only ever sees `Note` rows matching their own `discordUserId` — there's no shared/all-players view. Notes render as sortable-by-time, filterable-by-zone blocks (`web/app/(app)/notes/NotesList.js`, client-side `useState`/`useMemo` over the full personal set — same pattern as `PlayersTable.js`), not a table.

## Direct message logging

Every DM the bot or web app sends or receives is logged to `DirectMessage` (`discordUserId`, `direction: INBOUND|OUTBOUND`, `content`) so `/gm/messages` can show a full per-player conversation with a reply box. On the bot side, use `bot/src/lib/dm.js`'s `sendDm(user, payload)` wrapper (not raw `user.createDM()`/`dm.send()`) so outbound messages get logged; inbound DMs are logged directly in `messageCreate.js`. On the web side, `web/lib/discordGuild.js`'s `sendDm(discordUserId, content)` does the same.

## Bot message style ("aura")

Bot-authored Discord text should feel understated, not like a typical bot dashboard: no big colorful emoji, small unicode marks only. Lines that quote or restate player/character content are prefixed with `»` — e.g. `» {move description}`. `web/lib/discordGuild.js#sendDm` applies this `»` prefix automatically to every DM a GM sends a player (adjudication results, broadcasts, inbox replies), so callers pass the raw message text. Bot-side DMs that the bot itself composes (move/effort confirmations, edit prompts) are written with the `»` prefix inline at the call site instead, since they're paired with other formatting (zone, dice roll) that doesn't come through `sendDm`.

## GM slash commands

`/gm` and `/message` are the bot's first slash commands (`bot/src/lib/commands.js`), registered per-guild on `ready` (`registerCommands`, guild-scoped rather than global so they update instantly instead of waiting on Discord's ~1hr global-command propagation) and handled in `bot/src/events/interactionCreate.js` alongside the pre-existing button/select-menu location picker. Both are gated on `DISCORD_GM_ROLE_ID` membership, checked the same way as the location picker and `messageReactionAdd.js`'s fog-reaction handler. `/gm <message> [attachment]` posts to the current channel as the bot itself (the slash-command replacement for the old ":gm"-prefix text shorthand, which deleted+reposted a GM's message). `/message <recipient> <message>` DMs a chosen server member as the bot itself, routed through `bot/src/lib/dm.js#sendDm` for `DirectMessage` logging, with the `»` prefix applied inline since it's a bot-composed DM (see "Bot message style" above).

## Deploy workflow

Unless the user says otherwise, after finishing a set of changes: commit and push to `master` (the branch Railway deploys from), then trigger a Railway redeploy of the affected service(s) via the `railway` CLI (already authenticated/linked — see project memory `railway_project_lifeweb`) so the live app picks up the change without waiting on manual action.

## Notes for future work

- `web/CLAUDE.md` / `web/AGENTS.md` are generated and maintained by the Next.js tooling itself (regenerated by `next dev`) — they carry version-specific Next.js guidance and are separate from this file.
- The bot has no ESLint config yet; the web app's linting is scoped to `web/` only.
- No player-facing slash commands exist in the bot yet (`/effort`, `/move`, `/resource`, `/zone`, `/tag`, etc.) — only `/gm` and `/message` (GM-only, see above), the passive guild/role sync, audit logging, and character-proxying described elsewhere in this file.
- The **mid-game** tag store isn't routed yet. `PointBuy.js` already supports it (`afterStartOnly`) and `Character.tagPoints` already carries the balance; what's missing is a route that spends it and the rules for earning points during play (the old Desire system was ripped out).
