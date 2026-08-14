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
Inspired by Caves of Qud: CRT Terminal vibe. Some sort of Monospace font. Slight warp to the whole screen, barely noticeable. Barely visible, very translucent CRT bars. Underlined options when you select them. The color should match the time:
- at Dawn it goes from orange to light yellow to orange; the foreground is dark brass, also on a time based gradient; with terracotta accents / borders. Cream colored text
- At Dusk it goes from a Caves of Qud green to a dark grey green. The foreground is a darker, almost black, moss. Terracotta accents  / borders. Cream colored text.


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

GMs manage which channel/forum IDs are "tupper channels" from the `/gm` dashboard (`GameConfig.tupperChannelIds`, `web/app/gm/actions.js`). Inside those channels, `bot/src/events/messageCreate.js` auto-proxies every message from a user with an `ALIVE` character: it reposts the message via a per-channel webhook (`bot/src/lib/proxy.js`) using the character's name/avatar, then deletes the original — no bracket/trigger syntax needed, since each player only has one living character at a time. `bot/src/events/messageReactionAdd.js` handles ❌ (delete), ✏️ (DM-based edit), and ❓ (DMs the character's bio) on proxied messages, tracked in an in-memory map (fine at this scale — single bot process, no sharding).

This requires the `MESSAGE_CONTENT` privileged intent enabled for the bot application (Discord Developer Portal -> Bot -> Privileged Gateway Intents), in addition to the `GuildMembers` intent already noted above.

## Notes for future work

- `web/CLAUDE.md` / `web/AGENTS.md` are generated and maintained by the Next.js tooling itself (regenerated by `next dev`) — they carry version-specific Next.js guidance and are separate from this file.
- The bot has no ESLint config yet; the web app's linting is scoped to `web/` only.
- No slash commands exist in the bot yet (`/effort`, `/move`, `/resource`, `/zone`, `/tag`, etc.) — only the passive guild/role sync, audit logging, and character-proxying described above. The web app has a character-creation/bio form and read-only character/GM views; there's no point-buy flow, turn resolution, or zone-channel-visibility logic yet.
