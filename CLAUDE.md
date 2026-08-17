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
- `db/` — shared data layer (`@lifeweb/db`). Prisma schema at `db/prisma/schema.prisma`, targeting PostgreSQL. Exports a singleton `PrismaClient` from `db/index.js` (`const { prisma } = require("@lifeweb/db")`) so the bot and web app read/write the same game state without duplicating connection logic. Models: `GameConfig`, `Faction`, `Zone`, `Character`, `Tag`/`CharacterTag`, `Desire`, `Turn`, `Action` (unifies Effort/Move), `DefaultEffort`, `AuditLog`.

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

Tupper and summary channels are not manually configured — any Discord channel with **"»" in its name** opts in: standard text channels are both tupper *and* summary channels, forum channels are tupper-only. `bot/src/lib/channels.js` (gateway cache) and `web/lib/discordGuild.js` (`isSummaryChannel`/`isTupperChannel`/`listGuildChannels`, REST-based) are the two independent implementations of this rule — keep them in sync if it changes. Inside a tupper channel, `bot/src/events/messageCreate.js` auto-proxies every message from a user with an `ALIVE` character: it reposts the message via a per-channel webhook (`bot/src/lib/proxy.js`) using the character's name/avatar, then deletes the original — no bracket/trigger syntax needed, since each player only has one living character at a time. `bot/src/events/messageReactionAdd.js` handles ❌ (delete), ✏️ (DM-based edit), and ❓ (DMs the character's bio) on proxied messages, tracked in an in-memory map (fine at this scale — single bot process, no sharding). Public adjudications (see below) post to every summary channel.

This requires the `MESSAGE_CONTENT` privileged intent enabled for the bot application (Discord Developer Portal -> Bot -> Privileged Gateway Intents), in addition to the `GuildMembers` intent already noted above.

## Nickname sync

Every `ALIVE` named character's Discord server nickname is kept as `{base} | {characterName}` — `base` is `Character.preferredNickname` if the player set one on `/character`, else their Discord display name — truncated to fit Discord's 32-char cap (both halves shrink proportionally, not just one). Nothing here polls: `bot/src/lib/nickname.js#syncMemberNickname` is called instantly from `bot/src/events/userUpdate.js` (fires the moment a player's Discord username/display name changes) and from `guildMemberAdd.js` (rejoins), the same event-driven pattern as everything else in this bot (`isTupperChannel`/`isSummaryChannel`, faction sync, action confirms). `web/lib/discordGuild.js#syncCharacterNickname` does the REST-based equivalent immediately after a character is created or its name/nickname is edited on `/character`, so saves reflect in Discord without waiting on any bot event. `bot/src/events/ready.js` also runs a one-time bulk `syncNicknamesForGuild` on every connect/reconnect, alongside the existing `syncFactionsForGuild` call — a catch-up resync for anything missed while the bot was offline, not a recurring tick. `buildNickname()` is duplicated by hand between `bot/src/lib/nickname.js` and `web/lib/discordGuild.js`, same convention as `isTupperChannel`/`isSummaryChannel`.

## Moves, Efforts, and adjudication

Moves and Efforts also come from channel *names*, not IDs: a message posted in a channel named exactly `moves` or `effort` becomes a `PENDING` `Action` (type `MOVE`/`EFFORT`) via `bot/src/lib/actionSubmission.js#handleActionSubmission` — it deletes the original message, records the character's current zone, and DMs the player a confirm prompt with a ⚜ reaction already applied. Reacting ⚜ is handled by the existing `handleActionConfirm` in `bot/src/events/messageReactionAdd.js` (matched via `Action.confirmDmMessageId`), which rolls 1d6 for Moves only, strips the confirm reaction, edits the DM in place to `» *Waiting on adjudication...*` (with the roll above it for Moves), and flips the action to `CONFIRMED`. Requires the `DirectMessageReactions` gateway intent (`bot/src/index.js`) — without it, reactions on DMs never reach the bot at all.

Turns advance via `advanceTurn()` in `db/index.js` — shared logic (resolve Needs on the open turn, close it, open the next with alternated phase) called from two places that each layer on their own Discord-specific announcement: the bot's twice-daily cron (`bot/src/lib/turnEngine.js`) and the superadmin's "End turn" button on `/gm/dev` (`forceAdvanceTurn` in `web/app/(app)/gm/dev/actions.js`) — manual turn control lives only in the Dev Panel now, not on `/gm/turns`. The Dev Panel's Current Turn widget can also directly overwrite the open turn's day/phase (`updateCurrentTurn`) without resolving Needs, for raw correction.

GMs adjudicate `CONFIRMED` actions from `/gm/turns/[actionId]` (reached via the balance-scale button on the Turns table). Adjudicating sets two independent fields: `Action.resultMessage` (DMed to the player, and — if "public" is checked — also posted to every summary channel) and `Action.gmNotes` (never sent anywhere; GM-only, visible on the "Past Adjudications" table at the bottom of `/gm/turns`).

## Zones, Locations, and character roles

Geography is two levels: `Zone` (e.g. "Town") and `Location` (e.g. "church", nested under a Zone via `Location.zoneId`). Each `Location` maps to a standard Discord layout — one category plus three channels named after the location (`church`, `church-public`, `church-private`) — created by a superadmin clicking "Provision Discord channels" per Location on `/gm/dev/zones` (`provisionLocationChannels` in `web/app/(app)/gm/dev/actions.js`). This is **deliberately a one-time, explicitly-triggered action, never auto-synced** — re-running it on an already-provisioned Location is a no-op, so editing a Location's name in the DB later can't accidentally rename/delete live channels or their message history. `db/prisma/seed-zones.js` (idempotent, `npm run db:seed-zones`) seeds the initial Zone/Location list; Locations start unprovisioned (all `discord*Id` fields null) until a GM provisions them.

Every `ALIVE` character gets a personal Discord role titled after their character name (`Character.discordRoleId`), colored deterministically from a curated muted cyan/terracotta/brown/green palette (`db/lib/roleColor.js#hashNameToColor` — same name always yields the same color, so a rename very likely changes it too). `web/lib/discordGuild.js#ensureCharacterRole` creates+assigns the role the first time a character has a name, and renames/recolors it on every later profile save — called from both `updateCharacterProfile` (self-service, `web/app/(app)/character/actions.js`) and `updateCharacterRaw` (GM raw edit, `web/app/(app)/gm/dev/actions.js`). `db/prisma/backfill-roles.js` (`npm run db:backfill-roles`) is a one-off catch-up for characters that predate this.

This personal role is also the **sole access-control primitive** for Locations: a single `ViewChannel` permission overwrite on the Location's category (its three channels inherit it) is added for a character's role when they arrive and removed when they leave — see `bot/src/lib/location.js#swapLocationAccess`. The `-private` channel additionally denies `SendMessages`/`CreatePublicThreads` and allows `CreatePrivateThreads` for `@everyone`, so it's only ever used for GM-spun-up secret side-conversations, never top-level chat (same "private threads for secret conversations" concept already referenced in the archive's scoping, below). All three Location channels count as tupper channels, and the plain/public ones also count as summary channels — `isTupperChannel`/`isSummaryChannel` (`bot/src/lib/channels.js`, `web/lib/discordGuild.js`) check Location channel IDs in addition to the existing `»`-in-the-name marker, so auto-provisioned channels don't need the marker.

Players self-serve travel from the guild's single `location` text channel (read-only for `@everyone`, locked down by `bot/src/lib/location.js#ensureLocationPrompt` on bot ready): it carries one tracked message with a ⚜ **button** (not a reaction — Discord modals can't contain dropdowns and reactions can't open ephemeral UI, so this is the bot's first use of buttons/select-menus/`interactionCreate`, handled in `bot/src/events/interactionCreate.js`). Clicking it opens a private, ephemeral Zone → Location cascade of select menus ending in a Confirm button. `bot/src/lib/location.js#performMove` decides the cost: moving to a Location **within the character's current Zone is free** (no `Action` created); moving to a **different Zone spends the turn** — it's submitted as a real, auto-resolved `Action` (`type: EFFORT`, `status: ADJUDICATED` immediately, no GM step, tagged `gmNotes: "auto:zone_change"` so it's identifiable), which naturally lands in `/gm/turns`' Past Adjudications history rather than the pending-adjudication queue. This reuses the same turn-economy as Effort/Move submissions: `bot/src/lib/actionSubmission.js` now checks for *any* existing `Action` on the open `Turn` (including an auto-resolved zone-change) before accepting a new Effort/Move, and `performMove` does the same check in reverse — so acting and changing zones are mutually exclusive within a turn, in either order.

`Character.zoneId` is kept as a denormalized mirror of `location.zoneId` (updated in the same write as `locationId`) purely so the pre-existing zone-stamping on `Action`/`DefaultEffort`/`ArchivedMessage` and the zone-filter UI across `/gm/players`, `/gm/turns`, and `/archive` keep working unchanged — `locationId` is the authoritative "where is this character" field. New characters start with `locationId: null` (no location channel access) until a GM assigns one via `/gm/dev/characters/[characterId]` — there's no default-starting-location config.

## Message archive

Reacting ⭐ to a proxied message in any tupper channel archives it: `bot/src/events/messageReactionAdd.js#handleStarReaction` upserts an `ArchivedMessage` row (keyed on `discordMessageId`) with the character, a zone snapshot, content, and `starCount` taken straight from `reaction.count` — cheap, since that's already on the event, no extra Discord call — plus a `MessageStar` row recording which Discord user did the starring. This only works for messages still in `recentProxies` (bot's in-memory, last-500, resets on restart — see [[proxy.js]] note above), same constraint as ❌/✏️/❓. Star *removals* aren't tracked live; GMs reconcile that from `/archive` via a "Refresh star counts" button (`refreshArchiveStars` in `web/app/(app)/gm/actions.js`), which re-fetches each currently-listed row's message from the Discord REST API (`getMessageStarCount` in `web/lib/discordGuild.js`) — scoped to the current page/filters to keep one click cheap rather than refreshing the whole archive.

`/archive` (`web/app/(app)/archive/page.js`) is shared by both roles but scoped differently: GMs see and can filter/sort every archived message across the map; players only ever see messages *they personally* starred (`MessageStar.discordUserId` match) — matching a player's real Discord read access (zone visibility, private threads used for secret conversations) isn't tracked by the archive, so "only your own stars" is the safe substitute rather than trying to reconstruct real visibility.

## Direct message logging

Every DM the bot or web app sends or receives is logged to `DirectMessage` (`discordUserId`, `direction: INBOUND|OUTBOUND`, `content`) so `/gm/messages` can show a full per-player conversation with a reply box. On the bot side, use `bot/src/lib/dm.js`'s `sendDm(user, payload)` wrapper (not raw `user.createDM()`/`dm.send()`) so outbound messages get logged; inbound DMs are logged directly in `messageCreate.js`. On the web side, `web/lib/discordGuild.js`'s `sendDm(discordUserId, content)` does the same.

## Bot message style ("aura")

Bot-authored Discord text should feel understated, not like a typical bot dashboard: no big colorful emoji, small unicode marks only. Lines that quote or restate player/character content are prefixed with `»` (the same mark that opts a channel into tupper/summary behavior, see above) — e.g. `» {move description}`. `web/lib/discordGuild.js#sendDm` applies this `»` prefix automatically to every DM a GM sends a player (adjudication results, broadcasts, inbox replies), so callers pass the raw message text. Bot-side DMs that the bot itself composes (move/effort confirmations, edit prompts) are written with the `»` prefix inline at the call site instead, since they're paired with other formatting (zone, dice roll) that doesn't come through `sendDm`.

## Deploy workflow

Unless the user says otherwise, after finishing a set of changes: commit and push to `master` (the branch Railway deploys from), then trigger a Railway redeploy of the affected service(s) via the `railway` CLI (already authenticated/linked — see project memory `railway_project_lifeweb`) so the live app picks up the change without waiting on manual action.

## Notes for future work

- `web/CLAUDE.md` / `web/AGENTS.md` are generated and maintained by the Next.js tooling itself (regenerated by `next dev`) — they carry version-specific Next.js guidance and are separate from this file.
- The bot has no ESLint config yet; the web app's linting is scoped to `web/` only.
- No slash commands exist in the bot yet (`/effort`, `/move`, `/resource`, `/zone`, `/tag`, etc.) — only the passive guild/role sync, audit logging, and character-proxying described above. The web app has a character-creation/bio form and read-only character/GM views; there's no point-buy flow, turn resolution, or zone-channel-visibility logic yet.
