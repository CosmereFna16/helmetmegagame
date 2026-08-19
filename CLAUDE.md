# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Lifeweb is

Lifeweb is a huge, month-long asynchronous megagame. A barony in the middle of a wasteland, a bastard come to reclaim his throne, and a village of people trying their best — all built on top of domains of inscrutable technological goo. Players delve into caves as a Mercenary, defend the innocent as a Knight, whine to their father as the Princess, sell drugs and host illicit gatherings as a Pusher, or raid caravans as a Brigand.

It's half-strategy, half-roleplay, meant to run smoothly at large scale (100+ players ideally) with each in-game day mapping to one real-world day. A website and a Discord bot work together to automate communication and mechanics so the game stays asynchronous and low-friction. Design pillars called out by the project owner:

- **Leader system** — if you don't act, you automatically follow your faction leader's commands. Nobody is forced to play when they don't want to.
- **Desires and Needs** — fulfilling your character's dreams earns Tags that customize and buff them.
- **Roles and situations engineered for PvP conflict** — and the stories that come out of it — from day one.

Above all else, the priority is **functionality, usability, cleanliness, responsiveness, and browser performance**. The explicit reference point to avoid is the typical slow, laggy Discord bot dashboard — this needs to feel fast and scroll smoothly.

## Web Design
Inspired by Caves of Qud, revised 2026-08-14 after the original bright-gradient direction didn't land in practice. Monospace font (IBM Plex Mono). Flat, near-solid grounds — no animated gradients, no CRT warp/flicker, just a faint static scanline texture. Underlined options when you select them (`.menu-item`). The wordmark is solid text (`--text`) with a short terracotta rule beneath it, not a gradient-clip.

Palette is driven by the currently open `Turn.phase` (see `web/lib/turn.js`), not the wall clock, and both themes share the same structural logic: cool blue-grey for borders/chrome, warm beige/cream for text, terracotta held back for accents only (buttons, active nav state, small highlights) rather than spread across borders.

- **Dusk** — near-black teal ground (`#0b1614`), warm beige text (`#f0e9d8`), cool blue-grey borders, terracotta accent `#c9552b`.
- **Dawn** — bright warm parchment ground (`#ede4cc`), dark teal-charcoal ink text (`#2c332f`), same blue-grey borders, terracotta accent `#b8481f`. Not a bright orange sky — the same fire, lit at a different hour.

Exact tokens live in `web/app/globals.css` under `[data-theme="dusk"]` / `[data-theme="dawn"]`.


## Repository layout

This is an npm-workspaces monorepo with three packages:

- `bot/` — the Discord bot (discord.js v14). Entry point `bot/src/index.js`.
- `web/` — the web app (Next.js 16, App Router, JavaScript, Tailwind v4). Standard Next.js structure rooted at `web/app`.
- `db/` — shared data layer (`@lifeweb/db`). Prisma schema at `db/prisma/schema.prisma`, targeting PostgreSQL. Exports a singleton `PrismaClient` from `db/index.js` (`const { prisma } = require("@lifeweb/db")`) so the bot and web app read/write the same game state without duplicating connection logic. Models: `GameConfig`, `Faction`, `Zone`, `Character`, `Tag`/`CharacterTag`, `Desire`, `Turn`, `Action` (a turn's Move — see "Moves and adjudication" below), `DefaultEffort`, `AuditLog`.

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

npm run build --workspace=web        # production build of the web app
npm run lint --workspace=web         # eslint over the web app
```

Environment variables (see `.env.example`): `DATABASE_URL`, `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_GM_ROLE_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `AUTH_SECRET`. Neither package has test infrastructure set up yet.

## How the bot populates the database

On `ready` and on `guildCreate` (bot invited to a new server), the bot upserts a `GameConfig` singleton row and syncs every non-managed Discord role in the guild into a `Faction` row (`bot/src/lib/factionSync.js`), keeping it live via `guildRoleCreate`/`guildRoleUpdate`/`guildRoleDelete`. This means plugging the bot into a server immediately populates Factions with no manual setup. `guildMemberAdd` writes a `member_joined` `AuditLog` entry. The `GuildMembers` intent is privileged — it must be enabled for the bot application in the Discord Developer Portal (Bot -> Privileged Gateway Intents -> Server Members Intent) or the bot will fail to log in.

## Web app auth

The web app uses Auth.js (`next-auth@5`, `web/lib/auth.js`) with the Discord provider for login — `session.discordUserId` is the Discord user ID, attached via the `jwt`/`session` callbacks. `Character` rows are looked up by `discordUserId`, not by a separate user table. GM-only pages (`web/app/gm`) check the signed-in user's guild roles via `web/lib/discordGuild.js`, which calls the Discord REST API with the bot token (`DISCORD_TOKEN`) against `DISCORD_GUILD_ID`/`DISCORD_GM_ROLE_ID`, rather than trusting anything from the OAuth profile itself.

## Character proxying ("tupper" messages)

Players edit their character's name, profile picture, and appearance/bio on `/character`. Profile pictures are stored as bytes on `Character.avatarData`/`avatarMimeType` (resized/compressed with `sharp` on upload) rather than in a third-party bucket, and served back out by the web app itself at `/api/avatar/<characterId>` — the bot builds this into a full URL via `WEB_BASE_URL` when it needs an `avatarURL` for a webhook.

Tupper and summary channels are not manually configured — a channel opts in only by being one of a provisioned Location's plain/public/private channels (see "Zones, Locations, and character roles" below, and `docs/CHANNELS.md`): the plain (text) channel is both tupper *and* summary, the public (forum) and private (text) channels are tupper-only. `bot/src/lib/channels.js` (gateway cache) and `web/lib/discordGuild.js` (`isSummaryChannel`/`isTupperChannel`/`listGuildChannels`, REST-based) are the two independent implementations of this rule — keep them in sync if it changes. Inside a tupper channel, `bot/src/events/messageCreate.js` auto-proxies every message from a user with an `ALIVE` character: it reposts the message via a per-channel webhook (`bot/src/lib/proxy.js`) using the character's name/avatar, then deletes the original — no bracket/trigger syntax needed, since each player only has one living character at a time. `bot/src/events/messageReactionAdd.js` handles ❌ (delete), ✏️ (DM-based edit), and ❓ (DMs the character's bio) on proxied messages, tracked in an in-memory map (fine at this scale — single bot process, no sharding). Public adjudications (see below) post to every summary channel.

This requires the `MESSAGE_CONTENT` privileged intent enabled for the bot application (Discord Developer Portal -> Bot -> Privileged Gateway Intents), in addition to the `GuildMembers` intent already noted above.

## Nickname sync

Every `ALIVE` named character's Discord server nickname is kept as `{base} | {characterName}` — `base` is `Character.preferredNickname` if the player set one on `/character`, else their Discord display name — truncated to fit Discord's 32-char cap (both halves shrink proportionally, not just one). Nothing here polls: `bot/src/lib/nickname.js#syncMemberNickname` is called instantly from `bot/src/events/userUpdate.js` (fires the moment a player's Discord username/display name changes) and from `guildMemberAdd.js` (rejoins), the same event-driven pattern as everything else in this bot (`isTupperChannel`/`isSummaryChannel`, faction sync, action confirms). `web/lib/discordGuild.js#syncCharacterNickname` does the REST-based equivalent immediately after a character is created or its name/nickname is edited on `/character`, so saves reflect in Discord without waiting on any bot event. `bot/src/events/ready.js` also runs a one-time bulk `syncNicknamesForGuild` on every connect/reconnect, alongside the existing `syncFactionsForGuild` call — a catch-up resync for anything missed while the bot was offline, not a recurring tick. `buildNickname()` is duplicated by hand between `bot/src/lib/nickname.js` and `web/lib/discordGuild.js`, same convention as `isTupperChannel`/`isSummaryChannel`.

## Moves and adjudication

There is no more Effort/Move split — every turn submission is a **Move**, which is either **Routine** or **Gambit** (`Action.moveKind`; only Gambit rolls a d6) and may additionally be flagged **Opposed** (`Action.opposed`). A message posted in the channel named exactly `turns` becomes a `PENDING_TYPE` `Action` via `bot/src/lib/actionSubmission.js#handleActionSubmission` — it deletes the original message, records the character's current zone, and DMs the player **one message** carrying a Kind select menu, an Opposed select menu, and a Confirm button (`bot/src/lib/moveComponents.js#buildMoveComponents`/`buildMoveContent`). Changing either dropdown writes straight to the `Action` row and re-renders the same message in place via `interaction.update()` — nothing is ever deleted and resent, unlike the old reaction-based picker. All three components are handled in `bot/src/events/interactionCreate.js` (`move:kind:<actionId>`, `move:opposed:<actionId>`, `move:confirm:<actionId>` custom IDs): `handleMoveConfirm` requires a Kind to already be chosen, rolls 1d6 only if `moveKind === "GAMBIT"`, edits the DM to `» *Waiting on adjudication...*` with components stripped, and flips the action to `CONFIRMED`. DMs no longer carry any reaction-driven flow — `bot/src/events/messageReactionAdd.js` only handles guild-channel reactions (tupper ✏️/❌/🔍/⭐, GM 🌫️), and the bot no longer requests the `DirectMessageReactions` gateway intent. Posting a second Move in `#turns` on the same turn is deleted with a DM (`» *You've already sent a Move this turn...*`) rather than recorded.

Turns advance via `advanceTurn()` in `db/index.js` — resolves Needs on the open turn, closes it, opens the next with alternated phase, then owns every Discord side effect itself (REST-only, no gateway needed): posting the `#turns` announcement (`db/lib/turnAnnouncement.js`) and, if the new phase is `DAWN` and `GameConfig.messageWipeEnabled` is on, the Dawn message wipe (`db/lib/dawnWipe.js` — see `docs/CHANNELS.md` §5). Both are best-effort (`.catch()`'d) so a Discord-side failure never blocks the turn advance. Called from two places, each of which now just adds its own `AuditLog` entry afterward: the bot's twice-daily cron (`bot/src/lib/turnEngine.js`) and the superadmin's "End turn" button on `/gm/dev` (`forceAdvanceTurn` in `web/app/(app)/gm/dev/actions.js`) — manual turn control lives only in the Dev Panel now, not on `/gm/turns`. The Dev Panel's Current Turn widget can also directly overwrite the open turn's day/phase (`updateCurrentTurn`) without resolving Needs, for raw correction.

GMs work the Moves tab of `/gm/turns` as a spreadsheet: the balance-scale button on each row opens `MoveEditorModal` (a popup, not a page navigation) where every value is editable regardless of status — Move kind (switching it rerolls/nulls `diceRoll` the same way the bot does at confirm time), Opposed, and the GM-facing workflow status `Action.moveReviewStatus` (`OPEN` / `WAITING_FOR_OPPONENTS` / `IN_PROGRESS` / `SOLVED`, independent of the submission-pipeline `Action.status`). `resultMessage` and `gmNotes` are labeled **Outcome** and **Other Notes** in this UI — both GM-facing only, never auto-sent to the player or posted anywhere; a resource-change value on the Move is applied to the character's balance exactly once, the moment `moveReviewStatus` first transitions to `SOLVED`. All player messaging is manual from here on — the modal's "Message players" section (`PartyRows`/`sendPartyMessages` in `web/app/(app)/gm/actions.js#updateMove`) DMs whoever the GM picks, on demand. Group Moves (a leader pinging/naming other players into one shared Move) are purely narrative — there's no participant tracking in the schema; per the Leader system design pillar, anyone who doesn't submit their own Move is assumed to follow their faction leader's.

## Zones, Locations, and character roles

See also `docs/CHANNELS.md` for the full schematic of the Location Discord layout (category/channel naming, slowmode, forum-vs-text) and how per-character role visibility is kept in sync.

Geography is two levels: `Zone` (e.g. "Town") and `Location` (e.g. "church", nested under a Zone via `Location.zoneId`). Each `Location` maps to a standard Discord layout — one category plus three channels named after the location (`church`, `church-public`, `church-private`) — created by a superadmin clicking "Provision Discord channels" per Location on `/gm/dev/zones` (`provisionLocationChannels` in `web/app/(app)/gm/dev/actions.js`). This is **deliberately a one-time, explicitly-triggered action, never auto-synced** — re-running it on an already-provisioned Location is a no-op, so editing a Location's name in the DB later can't accidentally rename/delete live channels or their message history. `db/prisma/seed-zones.js` (idempotent, `npm run db:seed-zones`) seeds the initial Zone/Location list; Locations start unprovisioned (all `discord*Id` fields null) until a GM provisions them.

`docs/locations.yaml` is the hand-authored source of truth for the Zone/Location list (`id` slug, `name`, `zone`, free-text `tags`) — editing it and running `npm run db:sync-locations` (`db/prisma/sync-locations.js`) is the bulk alternative to clicking through `/gm/dev/zones` one at a time. It's a **manual, terminal-invoked command only** — no cron, no per-turn hook. The sync is upsert-only by `Location.slug` (never destructive: removing a YAML entry doesn't delete anything) and reuses the exact same provisioning logic as the GM Panel button, so it inherits the same "never touches an already-provisioned Location's Discord channels" guarantee — renaming `name` in the YAML after the fact updates the DB row but not the live channel names.

Every `ALIVE` character gets a personal Discord role titled after their character name (`Character.discordRoleId`), colored deterministically from a curated muted cyan/terracotta/brown/green palette (`db/lib/roleColor.js#hashNameToColor` — same name always yields the same color, so a rename very likely changes it too). `web/lib/discordGuild.js#ensureCharacterRole` creates+assigns the role the first time a character has a name, and renames/recolors it on every later profile save — called from both `updateCharacterProfile` (self-service, `web/app/(app)/character/actions.js`) and `updateCharacterRaw` (GM raw edit, `web/app/(app)/gm/dev/actions.js`). `db/prisma/backfill-roles.js` (`npm run db:backfill-roles`) is a one-off catch-up for characters that predate this.

This personal role is also the **sole access-control primitive** for Locations: a single `ViewChannel` permission overwrite on the Location's category (its three channels inherit it) is added for a character's role when they arrive and removed when they leave — `bot/src/lib/location.js#swapLocationAccess` (gateway, self-service travel) and `web/lib/discordGuild.js#syncCharacterLocationAccess` (REST twin, called from `updateCharacterRaw` on GM raw location edits) are the two call sites. The `-private` channel additionally denies `SendMessages`/`CreatePublicThreads` and allows `CreatePrivateThreads` for `@everyone`, so it's only ever used for GM-spun-up secret side-conversations, never top-level chat (same "private threads for secret conversations" concept referenced in the Notes scoping, below). All three Location channels count as tupper channels, and the plain channel also counts as a summary channel — `isTupperChannel`/`isSummaryChannel` (`bot/src/lib/channels.js`, `web/lib/discordGuild.js`) check Location channel IDs directly; there is no name-based marker.

Players self-serve travel from the guild's single `location` text channel (read-only for `@everyone`, locked down by `bot/src/lib/location.js#ensureLocationPrompt` on bot ready): it carries one tracked message with a ⚜ **button** (not a reaction — Discord modals can't contain dropdowns and reactions can't open ephemeral UI, so this is the bot's first use of buttons/select-menus/`interactionCreate`, handled in `bot/src/events/interactionCreate.js`). Clicking it opens a private, ephemeral Zone → Location cascade of select menus ending in a Confirm button. `bot/src/lib/location.js#performMove` decides the cost: moving to a Location **within the character's current Zone is free** (no `Action` created); moving to a **different Zone spends the turn** — it's submitted as a real, auto-resolved `Action` (`status: CONFIRMED`, `moveReviewStatus: SOLVED` immediately, no GM step, tagged `gmNotes: "auto:zone_change"` so it's identifiable), which naturally lands in `/gm/turns`' Moves history rather than the pending queue. This reuses the same turn-economy as Move submissions: `bot/src/lib/actionSubmission.js` now checks for *any* existing `Action` on the open `Turn` (including an auto-resolved zone-change) before accepting a new Move, and `performMove` does the same check in reverse — so acting and changing zones are mutually exclusive within a turn, in either order.

`Character.zoneId` is kept as a denormalized mirror of `location.zoneId` (updated in the same write as `locationId`) purely so the pre-existing zone-stamping on `Action`/`DefaultEffort`/`Note` and the zone-filter UI across `/gm/players`, `/gm/turns`, and `/notes` keep working unchanged — `locationId` is the authoritative "where is this character" field. New characters start with `locationId: null` (no location channel access) until a GM assigns one via `/gm/dev/characters/[characterId]` — there's no default-starting-location config.

## Discord permission model

There is no single unified permission system — three independent kinds of Discord role drive access, each synced from a different piece of state, plus one env-configured admin role:

- **Personal character role** (`Character.discordRoleId`, one per `ALIVE` character, titled after the character's name) — the sole access-control primitive for Location categories (see above). Created/renamed by `ensureCharacterRole`, granted/revoked per-category by `swapLocationAccess`/`syncCharacterLocationAccess`.
- **Faction role** (`Faction.discordRoleId`) — these are just the guild's existing native Discord roles, passively synced into `Faction` rows by `bot/src/lib/factionSync.js#syncFactionsForGuild` (on `ready`/`guildCreate`/role events). They aren't a Lifeweb-driven access-control mechanism — whatever native channel permissions those roles already carry in Discord keep working unchanged; Lifeweb only reads them for faction membership/Silo/Leader logic, not to grant channel visibility.
- **GM role** (`DISCORD_GM_ROLE_ID` env var) — checked via REST (`web/lib/discordGuild.js#isGm`) against the signed-in user's guild member roles to gate `/gm` pages and the `/gm`/`/message` slash commands; not stored on any Lifeweb model.
- **Turn-ping role** (`DISCORD_TURN_PING_ROLE_ID` env var) — a plain opt-in notification role, added/removed by `setTurnPingRole` when a player toggles "Turn Ping?" on `/character`. Excluded from faction sync (`factionSync.js`) so it never becomes a fake Faction row.
- **Tag-gated channels** — the pattern used for the `#radio` channel (below): the character's own **personal role** (not a separate shared role) gets a permission overwrite added directly on the channel, synced to whoever currently holds a specific `Tag`, driven from the tag-grant/revoke call sites rather than from Location or Faction state.

### Tag-gated channels (`#radio`)

The `radio` Tag (`RADIO_SLUG`, point-buy under the `Skills` store category at `pointCost: 2`, see `db/prisma/seed-tags.js`) gates a single text channel, `#radio`, provisioned once via `provisionRadioChannel()` (`web/lib/discordGuild.js`): it denies `@everyone` `ViewChannel`/`SendMessages` on the channel and adds no other overwrites — the channel ID is stored on the `GameConfig` singleton (`radioChannelId`), same pattern as `locationPromptChannelId`. There is no dedicated "Radio Access" role; access reuses the exact same primitive as Location categories (`Character.discordRoleId`, one personal role per `ALIVE` character — see above). `syncCharacterRadioAccess(discordRoleId, hasTag)` grants/revokes a per-role permission overwrite on the `#radio` channel via REST (same PUT/DELETE-channel-permission primitive as `syncCharacterLocationAccess`) and is called from every place a `CharacterTag` for the Radio Tag can be created/deleted — `grantTag`/`revokeTag` (GM raw edit) and `purchaseTags` (player point-buy, both in the relevant `actions.js`) — whenever the mutated tag's slug is `RADIO_SLUG`, passing the target character's `discordRoleId`. This is a template for any future Tag that should gate a Discord channel: add the slug to `db/lib/constants.js`, seed the `Tag`, provision the channel with `@everyone` denied, and call a `syncCharacterXAccess(discordRoleId, hasTag)` from every call site that can grant/revoke that tag — never a new shared role.

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
- No player-facing slash commands exist in the bot yet (`/effort`, `/move`, `/resource`, `/zone`, `/tag`, etc.) — only `/gm` and `/message` (GM-only, see above), the passive guild/role sync, audit logging, and character-proxying described elsewhere in this file. The web app has a character-creation/bio form and read-only character/GM views; there's no point-buy flow, turn resolution, or zone-channel-visibility logic yet.
