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
npm run db:sync-documents            # docs/documents.yaml  (destructive; run last,
                                     #   validates against tags/roles/factions)

npm run map:check                    # geometry check over docs/locations.yaml's
                                     #   `map:` coordinates — crossing roads,
                                     #   overlapping nodes. No DB, no Discord.

# One-off provisioning for #radio/#intercom — see "Narrowcast channels" below.
npm run db:sync-narrowcast-channels

# One-off: grant the spectator role read-only view on everything already
# provisioned. Anything provisioned after this change gets it automatically.
npm run db:backfill-spectator-access

# Repair pass for the four-part character name. Zero repairs on a normally
# migrated DB — it exists for a pre-migration dump, and as the drift check on
# the denormalized `Character.name` (see "Character names" below).
npm run db:backfill-name-parts

# Regenerates the default letter-plaque avatars into web/public/assets/letters.
# One-off with committed output; re-run after editing the tuning constants or
# replacing web/public/assets/background.png.
npm run assets:letters --workspace=web

npm run build --workspace=web        # production build of the web app
npm run lint --workspace=web         # eslint over the web app
```

Environment variables (see `.env.example`): `DATABASE_URL`, `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_GM_ROLE_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `AUTH_SECRET`. The player and spectator role IDs are **not** env vars — they are hardcoded in `db/lib/roleIds.js` (see "Discord permission model" below). Neither package has test infrastructure set up yet.

## How the bot populates the database

On `ready`, the bot upserts a `GameConfig` singleton row. `guildMemberAdd` writes a `member_joined` `AuditLog` entry. The `GuildMembers` intent is privileged — it must be enabled for the bot application in the Discord Developer Portal (Bot -> Privileged Gateway Intents -> Server Members Intent) or the bot will fail to log in.

`Faction` rows have no connection to Discord roles — they're a pure Lifeweb game-state concept, master-sourced from `docs/roles.yaml` via `npm run db:sync-roles` (see "Character creation and roles" below) and editable by GMs on `/faction` and `/gm/dev/factions` (`web/app/(app)/faction/actions.js`, `web/app/(app)/gm/dev/actions.js`). Discord's native roles (used for faction pings, etc.) are independent and unmanaged by Lifeweb.

## Web app auth

The web app uses Auth.js (`next-auth@5`, `web/lib/auth.js`) with the Discord provider for login — `session.discordUserId` is the Discord user ID, attached via the `jwt`/`session` callbacks. `Character` rows are looked up by `discordUserId`, not by a separate user table. GM-only pages (`web/app/gm`) check the signed-in user's guild roles via `web/lib/discordGuild.js`, which calls the Discord REST API with the bot token (`DISCORD_TOKEN`) against `DISCORD_GUILD_ID`/`DISCORD_GM_ROLE_ID`, rather than trusting anything from the OAuth profile itself.

## Confirm dialog

For any "are you sure?" moment in the web app, use the shared confirm dialog instead of rolling a one-off modal or `window.confirm`. `web/app/components/ConfirmProvider.js` mounts once in `web/app/layout.js` (wrapping the whole tree) and exposes `useConfirm()`, a promise-based hook: `const confirm = useConfirm(); if (!(await confirm({ title, message, confirmLabel, cancelLabel }))) return;`. All fields are optional and it reuses the existing `.modal-overlay`/`.modal-panel` styling, so it matches every other modal in the app for free.

## Web app style conventions

Source of truth for exact values is `web/app/globals.css` and the font setup in `web/app/layout.js` — this section is a map of what's there and the rules for using it, not a copy of the values themselves (keep it that way; don't let this drift into a duplicate that can go stale).

**Fonts** — four faces loaded via `next/font/google` in `layout.js`, exposed as CSS variables on `<html>`:
- `--font-sans` (Source Sans 3) is the app default, set on `body`. Chrome, tables, forms, buttons and prose all sit here unless a rule below says otherwise.
- `--font-mono` (IBM Plex Mono) is **data only** — numbers, resources, dice, IDs, timestamps, audit rows. Opt in with the `.mono` class. It used to be the body face, which made it wallpaper: dense GM tables were wider and harder to read, and the mono itself signalled nothing. Don't reach for it for prose.
- `--font-serif` (Source Serif 4) is applied automatically to every `h1`/`h2`/`h3` by a global CSS rule — never hand-apply a font class to a heading, just use the tag. It and Source Sans 3 are a designed superfamily, so they share metrics for free.
- `--font-display` (UnifrakturMaguntia, a gothic/blackletter face) is reserved for a handful of thematic moments — the login wordmark and a couple of flavor-heavy titles — via `.font-display`/`.wordmark`. Never use it for bulk headings, loading-state text, or arbitrary player-authored content; it's illegible at small sizes and reads as a mismatch everywhere else (this is the mistake fixed on the `/lifeweb` panel's `loading.js`).

**Colors** — entirely CSS custom properties, redefined per-theme in `globals.css`. Never hardcode a hex/rgb color in a component; always reference a token via `var(--x)` so it tracks the active theme (there are currently zero hardcoded colors app-wide — keep it that way).

Three things about the token set are load-bearing and easy to undo by accident:

- **The surface ladder is `--bg` → `--surface` → `--surface-raised`**, and each step must keep ~1.20 contrast. `.panel` sits on `--surface`; modals, tooltips, sticky table headers and the turn chip sit on `--surface-raised`. `--field-bg` is *recessed below* the surface, so inputs read as cut into a panel rather than as another panel. This ladder used to be 1.08, which is why the app read as one flat sheet. `--panel-bg` survives only as a legacy alias for `--surface`.
- **`--accent` and `--accent-text` are different colors on purpose.** `--accent` is a fill/rule; `--accent-text` is for text and outlines. One ember token cannot be both legible and rich, and collapsing them is what made every button in the app fail AA. Similarly `--accent-solid` + `--on-accent` are the primary button pair, and `--danger` (not `--accent`) is for destructive actions.
- **Contrast is gated, not vibes.** `npm run audit:contrast --workspace=web` parses the theme blocks straight out of `globals.css` and fails on any AA regression. Run it after touching a color.

**Themes** — `dusk` and `dawn` follow the current turn's phase via `themeForPhase`. Both are *underground darks*: Ravenheart is a cave civilisation, so they differ by lamplight temperature and lift, not by daylight. `limestone` is a light-theme backup that no phase maps to; reach it by setting `LIFEWEB_THEME=limestone` (`resolveTheme` in `web/lib/turnFormat.js`, applied in `layout.js`). A CRT/terminal look is a parked option, written up in `docs/systemdocs/CRT-TERMINAL.md` — read that before rebuilding it, since it's been half-built and deleted twice.

**Tailwind is bridged to the tokens** via the `@theme inline` block in `globals.css`. That's what makes `text-sm`/`text-lg` resolve to the design scale rather than Tailwind's stock sizes, and what makes `text-muted`/`bg-surface` real utilities. Prefer those utilities over an inline `style={{ color: "var(--muted)" }}` object in new code — the app still carries ~160 of those and they're being retired as pages are touched. When overriding a size token in `@theme`, always pair it with its `--text-<size>--line-height`, or the utility falls back to a ratio computed against the size you just replaced.

**Shared classes** — use these instead of rolling one-off markup:
- `.panel` for any card/section container, with `.panel-header` for its heading (a serif `--fs-lg` with a hairline rule — use it instead of a bare `h2.mb-3.font-bold`, which had six different ad-hoc treatments across 28 sites).
- Buttons, in descending weight: `.btn` (solid primary), `.btn-secondary` (outline), `.btn-danger` (destructive — Reject, Kill, Restart Game), `.btn-quiet` (text-only). `.btn` is a solid fill now, not an outline, so it lands with real weight on all 73 call sites; pick the variant by how important the action is rather than defaulting to `.btn` everywhere.
- `.field` wrapping a `.field-label` + input/textarea/select is how *every* form control in the app gets themed (background, border, font). A bare `<select>`/`<input>` outside `.field` falls back to unstyled native browser chrome and visibly breaks the theme — always wrap it, even for a single standalone control.
- `.chip` for small tag/pill labels, `.data-table` for tabular data, `.menu-item` for link-like row actions.
- `.modal-overlay`/`.modal-panel`, normally reached via `useConfirm()` (see "Confirm dialog" above) rather than built by hand.

**Page shell** — `web/app/components/PageShell.js`, not a convention any more. Every top-level page is `<PageShell width><PageHeader title subtitle actions />…</PageShell>`; `width` is `narrow` / `default` / `wide`, which is the whole menu (it replaced five ad-hoc `max-w-*` values chosen per page). `PageHeader`'s `actions` slot is for anything that belongs beside the title — a sub-nav, a faction switcher — which pages used to improvise. Don't hand-roll `mx-auto flex max-w-… p-6 sm:p-8` or a bare `<h1>` again; that convention was documented for months and drifted anyway, which is why it's a component now.

Its `loading.js` is `<SkeletonPage width title panels />` from the same file, so a skeleton physically cannot disagree with its page about width or title — they did, everywhere (every skeleton was `max-w-5xl` regardless of its page, and four had no `<h1>` at all, so every navigation visibly re-flowed). `panels` is an array of bar-width percentages roughly tracing what lands. The one exception is `web/app/(app)/loading.js`, the group fallback: it renders no title, because it can't know which page is arriving.

**List shell** — every long list in the app is the same object, for the same reason `PageShell` is: `/gm/audit` paged and pinned its header while `/gm/turns` poured 500 rows into a 70vh box, and `/gm/players`, `/gm/messages` and `/notes` each hand-rolled their own filter state with no height cap at all. `web/app/components/DataTable.js` is now the single engine — `useTableState({rows, searchFields, filterDefs, initialSort, pageSize})` returning `pageRows`/`page`/`setPage`/`total`/`totalPages` alongside the filtered `visible`, plus `SortHeader`, `FilterBar` and `TableScroll` — and `web/app/components/Pager.js` is the one pager. It was `gm/turns/tableUtils.js` until four other surfaces wanted it.

Three things about it are load-bearing. Paging is **client-side** everywhere except `/gm/audit`, which pages server-side over `?page=` so a filtered log stays linkable — which is why `Pager` has no `"use client"` directive and takes precomputed `prevHref`/`nextHref` there instead of the `onPage` callback the in-memory tables pass (a function prop cannot cross a server→client boundary). Changing the search, a filter or the sort **resets to page 1 inside the setters, never in an effect** — `react-hooks/set-state-in-effect` is an error in this repo, and the setter version lands in the same render anyway. And list height is one token, `--list-h`, shared by `.table-scroll` (tables), `.list-scroll` (the `/notes` card board) and `.message-list` (a DM thread); it replaced four unrelated values. A card list with no header row to hang a `SortHeader` off passes `sortOptions` to `FilterBar` instead, which is what `/notes` does.

**Headings inside a page** — `.panel-header` for a section heading (serif, `--fs-lg`, hairline rule beneath). Use `.section-title` instead wherever the heading is a *flex child sitting beside something else* — a modal title next to its close button, a status band next to its value, a "Tags" heading next to its buttons. `.panel-header`'s `border-bottom` would underline just the title text there rather than spanning the container, which reads as an underline, not a divider.

## Character proxying ("tupper" messages)

Players edit their character's name, profile picture, and appearance/bio on `/character`. Profile pictures are stored as bytes on `Character.avatarData`/`avatarMimeType` (resized/compressed with `sharp` on upload) rather than in a third-party bucket, and served back out by the web app itself at `/api/avatar/<characterId>` — the bot builds this into a full URL via `WEB_BASE_URL` when it needs an `avatarURL` for a webhook.

A character who has **not** uploaded one gets a **letter plaque**: a teal-tinted stone tile bearing a blackletter capital of the first letter of their **first name** — never the honorific or the granted title, so `Sir Alder "the Blind" Crane` gets an **A**. The 27 tiles (A–Z plus a blank `_default`) live in `web/public/assets/letters/` and are generated by `web/scripts/generate-letters.js` (`npm run assets:letters --workspace=web`) from `web/public/assets/background.png` and the vendored `web/assets/fonts/UnifrakturMaguntia.ttf` — the same face `--font-display` uses for the login wordmark, vendored as a TTF because `sharp`'s pango text rendering cannot read the `.woff2` `next/font/google` caches. Two things about the generator are load-bearing: it **tints in a second `sharp` pass, alone** (chaining `.tint()` with `.modulate()` in one pipeline silently drops the tint and yields a flat grey plate), and it **trims each glyph then fits it into a fixed box**, since blackletter capitals differ enough in width that one point size makes some tower over others. Output is WebP, matching what an uploaded avatar is stored as — ~145KB for the set instead of ~1MB as PNG.

There is deliberately **no job that regenerates an avatar on rename**: `web/app/api/avatar/[characterId]/route.js` picks the plaque at *read* time from the live row, so a rename follows implicitly, and an uploaded `avatarData` always takes precedence so nobody's own picture is overwritten. The `?v=<updatedAt ms>` cache-buster every caller appends is what gets past the route's `immutable` header. An accented, non-Latin, numeric or empty initial falls through to `_default.webp` rather than 404ing.

Tupper and summary channels are not manually configured — a channel opts in only by being one of a provisioned Location's plain/public/private channels (see "Zones, Locations, and character roles" below, and `docs/systemdocs/CHANNELS.md`): the plain (text) channel is both tupper *and* summary, the public (forum) and private (text) channels are tupper-only. The narrowcast channels `#radio`/`#intercom` (see below) are also tupper-only, same as a Location's public/private channels — they aren't tied to a place, so they're never summary. `bot/src/lib/channels.js` (gateway cache) and `web/lib/discordGuild.js` (`isSummaryChannel`/`isTupperChannel`/`listGuildChannels`, REST-based) are the two independent implementations of this rule — keep them in sync if it changes. Inside a tupper channel, `bot/src/events/messageCreate.js` auto-proxies every message from a user with an `ALIVE` character: it reposts the message via a per-channel webhook (`bot/src/lib/proxy.js`) using the character's name/avatar, then deletes the original — no bracket/trigger syntax needed, since each player only has one living character at a time. `bot/src/events/messageReactionAdd.js` handles ❌ (delete), ✏️ (DM-based edit), and ❓ (DMs the character's bio) on proxied messages, tracked in an in-memory map (fine at this scale — single bot process, no sharding).

This requires the `MESSAGE_CONTENT` privileged intent enabled for the bot application (Discord Developer Portal -> Bot -> Privileged Gateway Intents), in addition to the `GuildMembers` intent already noted above.

## Nickname sync

Every `ALIVE` named character's Discord server nickname is kept as `{base} | {characterName}`, where `characterName` is the **bare** name (first + last, via `formatBareName`) rather than the displayed one — `base` is `Character.preferredNickname` if the player set one on `/character`, else their Discord display name — truncated to fit Discord's 32-char cap (both halves shrink proportionally, not just one). Nothing here polls: `bot/src/lib/nickname.js#syncMemberNickname` is called instantly from `bot/src/events/userUpdate.js` (fires the moment a player's Discord username/display name changes) and from `guildMemberAdd.js` (rejoins), the same event-driven pattern as everything else in this bot (`isTupperChannel`/`isSummaryChannel`, action confirms). `web/lib/discordGuild.js#syncCharacterNickname` does the REST-based equivalent immediately after a character is created or its name/nickname is edited on `/character`, so saves reflect in Discord without waiting on any bot event. `bot/src/events/ready.js` also runs a one-time bulk `syncNicknamesForGuild` on every connect/reconnect — a catch-up resync for anything missed while the bot was offline, not a recurring tick. `buildNickname()` is duplicated by hand between `bot/src/lib/nickname.js` and `web/lib/discordGuild.js`, same convention as `isTupperChannel`/`isSummaryChannel`.

The nickname is the one surface where a title deliberately does **not** appear. The 32-char cap is shared between the two halves — roughly 14 each — and `Sir Jorren "the Blind" Vask` is 27 characters on its own, so titling here would truncate essentially every nickname in the guild to garbage. Both hand-duplicated copies of `buildNickname` are fed the bare name by their callers; neither slices a title off itself.

## Moves and adjudication

There is no more Effort/Move split — every turn submission is a **Move**, which is either **Routine** or **Gambit** (`Action.moveKind`; only Gambit rolls a d6) and may additionally be flagged **Opposed** (`Action.opposed`). A message posted in the channel named exactly `turns` becomes a `PENDING_TYPE` `Action` via `bot/src/lib/actionSubmission.js#handleActionSubmission` — it deletes the original message, records the character's current zone, and DMs the player **one message** carrying a Kind select menu, an Opposed select menu, and a Confirm button (`bot/src/lib/moveComponents.js#buildMoveComponents`/`buildMoveContent`). Changing either dropdown writes straight to the `Action` row and re-renders the same message in place via `interaction.update()` — nothing is ever deleted and resent, unlike the old reaction-based picker. All three components are handled in `bot/src/events/interactionCreate.js` (`move:kind:<actionId>`, `move:opposed:<actionId>`, `move:confirm:<actionId>` custom IDs): `handleMoveConfirm` requires a Kind to already be chosen, rolls 1d6 only if `moveKind === "GAMBIT"`, edits the DM to `» *Waiting on adjudication...*` with components stripped, and flips the action to `CONFIRMED`. DMs no longer carry any reaction-driven flow — `bot/src/events/messageReactionAdd.js` only handles guild-channel reactions (tupper ✏️/❌/🔍/⭐, GM 🌫️), and the bot no longer requests the `DirectMessageReactions` gateway intent. Posting a second Move in `#turns` on the same turn is deleted with a DM (`» *You've already sent a Move this turn...*`) rather than recorded.

Turns advance via `advanceTurn()` in `db/index.js` — it claims the open turn by closing it (see the race guard below), resolves Needs on it (the expiry sweep, the Hunger upkeep pass, and the Lifeweb blood decay — see "Hunger" below), and opens the next with alternated phase. It **composes but does not run** the Discord side effects (REST-only, no gateway needed): the per-player Hunger DMs, the `#turns` announcement (`db/lib/turnAnnouncement.js`), and, if the new phase is `DAWN` and `GameConfig.messageWipeEnabled` is on, the Dawn message wipe (`db/lib/dawnWipe.js` — see `docs/systemdocs/CHANNELS.md` §5). All three come back as one `runSideEffects()` thunk on the return value, so the caller decides when they run — that split is load-bearing, since the wipe walks every Location's channels sequentially and can take minutes, and awaiting it inside a server action holds the action open, which blocks client-side navigation and freezes the whole web app. Each side effect stays individually `.catch()`'d and best-effort, so a Discord failure never blocks the turn.

Called from two places, each of which adds its own `AuditLog` entry and then handles the thunk to suit its process: the bot's twice-daily cron (`bot/src/lib/turnEngine.js`) awaits it inline (background process, nobody waiting), while the superadmin's "End turn" button on `/gm/dev` (`forceAdvanceTurn` in `web/app/(app)/gm/dev/actions.js`) hands it to `next/server`'s `after()` so the response — already carrying the committed new turn — flushes first. Both must check the returned `advanced` flag before logging or dereferencing `newTurn`: the turn is claimed with an `updateMany` conditioned on `status: "OPEN"`, so if a GM clicks just as the cron fires, exactly one caller wins and the loser returns `advanced: false` having done nothing rather than opening a duplicate turn. That claim happens *before* Needs resolve, deliberately — a half-resolved turn is a cheaper failure than a losing racer double-charging everyone's upkeep. Manual turn control lives only in the Dev Panel, not on `/gm/turns`; its "End turn" button is `EndTurnButton.js`, the one client component under `/gm/dev`, carrying the confirm dialog and the pending state. The Current Turn widget can also directly overwrite the open turn's day/phase (`updateCurrentTurn`) without resolving Needs, for raw correction.

GM-side **adjudication** lives on `/gm/turns` ("Adjudicate" in the nav), rebuilt as a two-tab page — **Moves** and **Requests** — over the app-wide list shell (`web/app/components/DataTable.js` + `Pager.js`: fixed tall height, both scroll axes, pinned header, client-side filter/sort/search and pages of 50 — see "List shell" above). The **Moves tab**'s ⚖ button opens `MovePanel.js` (Character / Situation / Result), which shares the Request panel's shell. Two rules carry it: every **Routine** lands in the new `PASSED` status with its resources already pushed at confirm time, while a **Gambit** pushes nothing until a GM Solves it; and every push is snapshotted onto `Action.appliedEffects` (JSON, so it can grow past resources) which is the *only* thing a revert reads. `db/lib/moveEffects.js` owns both directions plus the shared d6. Concurrent GMs are kept apart by a TTL'd lock (`lockedByDiscordUserId`/`lockExpiresAt`, 90s, heartbeat every 30s) that is deliberately **not** a status — "In Progress" is derived from a live lock, so a crashed browser can never strand a row. Reject deletes the Move, claws back anything a Routine pushed, DMs the player and keeps the record in `AuditLog`. The **Requests tab** is fully built (see "Requests" below). Group Moves (a leader pinging/naming other players into one shared Move) are purely narrative — there's no participant tracking in the schema; per the Leader system design pillar, anyone who doesn't submit their own Move is assumed to follow their faction leader's.

A **Gambit**'s d6 carries a modifier summed from Mood (±1) and Hunger (−1), which stack additively: `handleMoveConfirm` stores the raw roll on `Action.diceRoll` and the total separately on `Action.diceModifier` (never baked together — a GM has to be able to tell a modified 5 from a natural 5). `db/lib/gambitModifier.js` is the single source of that sum, a thin composer over `db/lib/mood.js` shared by bot and web; since the column is one `Int`, the per-contributor breakdown is display-only, rebuilt for the confirm DM (`🎲 **4** −1 Unhappy −1 Hungry → **2**`) and mirrored into the `move_confirmed` audit entry. See "Requests, Mood, and Desires" and "Hunger" below.

## Default Moves

The "Default Move" panel on `/character` (`DefaultEffortPanel.js` → `setDefaultEffort`, one `DefaultEffort` row per character) is what a player falls back on for a turn they never file anything on. `db/lib/defaultMovePass.js#runDefaultMovePass` is the half that makes it real: called first thing in `resolveNeeds()`, it finds every `ALIVE` character holding a `DefaultEffort` with **no `Action` at all** on the closing turn (an auto-resolved zone change counts as acting, same rule `handleActionSubmission` enforces) and files one for them.

What it files is always a **Routine**, resolved exactly the way `handleMoveConfirm` resolves a hand-confirmed one — `CONFIRMED`/`PASSED`, resources pushed via `applyMoveEffects` and snapshotted onto `appliedEffects` so a GM can still revert it — and never a Gambit, since a Gambit is a deliberate risk and nobody's there to take it. It's marked `gmNotes: "auto:default_move"`, the identifiable-marker convention `performMove`'s zone change uses.

Three details are load-bearing. It runs **before** the Hunger pass, so a default that earns resources pays for that turn's meal rather than arriving too late. The `+N`/`5-12`/`/hunt` notation is parsed out of `description` **at resolution time** (`db/lib/resourceDelta.js`, moved out of `bot/src/lib/` for this and re-exported from there) rather than at save time — no extra `DefaultEffort` columns, the player keeps seeing the text they typed, and a written roll actually re-rolls each turn. And the summary post goes to the character's **current** Location's plain channel, not the `summaryChannelId` snapshotted when they saved the panel, so travelling moves where their default gets narrated; it's posted under the character's name/avatar through `db/lib/discordRest.js#postAsCharacter`, the REST twin of `bot/src/lib/proxy.js`'s webhook proxy. One summary `default_moves_resolved` audit row per turn (not one per character, same reasoning as `hunger_resolved`), and one DM per affected player.

Like the Hunger pass, `runDefaultMovePass` **does not send any of that itself** — it returns `posts` and `dms` and `advanceTurn()`'s `runSideEffects()` performs them, so the pass makes no network call and can't hold a turn advance open. That matters more here than for Hunger: this is up to *two* Discord round-trips per affected player (a summary post and a DM), which at 100+ players is the single largest block of network work in the whole turn advance. One consequence: the audit row reports `shareable` rather than `shared`, since the posts haven't been attempted when it's written and claiming a success count would be a lie.

## Food production (`/hunt`, `/fish`, `/farm`, `/herd`)

`db/lib/production.js` is the sole source of the four production fields' payouts, and every tier is a `{min,max}` range even though only Hunting actually varies (`herding` 1/5/10, `farming` 3/9/18, `fishing` 2/7/14, `hunting` 0–4/5–12/10–24, at base/laborer/specialist). The uniform shape is load-bearing: Hunting used to live in its own `HUNTING_DICE` table, which made it a special case in five separate places and meant it silently escaped `GameConfig.productionCoefficient` entirely. One shape means `/herd` and `/hunt` run identical code. `computeRate` scales both ends and returns `{min,max}`; `formatRate` is the only place the en dash in `"0–4"` is written; `rollRate` picks the value. Tier is the same ladder for all four — `laborer-<field>` → specialist, `laborer` → laborer, else base — so the dead `hunter` slug is gone from `db/lib/constants.js`.

`db/lib/laborAccess.js` is the location gate, mirroring `db/lib/narrowcastAccess.js`'s pure-rules/async-context split (**Location matched by `slug`, Zone by `name`**, same reason). Hunting needs the `forest` Location; fishing the Fortress or Town Zone; farming Town; herding any zone but Caves — and **nothing feeds anyone in the Caves**, which is the point rather than a coincidence of how the four rules are written. Herding requires a *known* zone, so an off-map character can't herd from nowhere. A refusal always returns **before** `action.create`, so being in the wrong place never costs the player their turn.

The four commands are `bot/src/lib/commands.js`, built from `LABOR_FIELDS` so the list can't drift, one per field rather than the old `/labor field:hunt` — the slash command and the text shorthand are then spelled identically. `/labor` was deleted; `registerCommands` uses `guild.commands.set()`, a full replace, so deregistering needed no cleanup.

**A `/hunt`-style shorthand is resolved at submission, never at confirm.** The parser (`db/lib/resourceDelta.js#parseResourceExpression`) stays pure and synchronous — it's called once per character from `runDefaultMovePass`, so a version doing its own lookups would turn one turn advance into N round trips — and returns a `{kind:"shorthand"}` marker the caller collapses into a concrete range before storing. Two consequences: the gate can run before the `Action` row exists (which is what makes "turn not spent" possible), and only one grammar, a plain range, ever reaches the database. `defaultMovePass` resolves shorthands from three bulk reads, not per character; a gated Default Move still files (they did spend the day trying) but pays nothing and carries a `gateNote` into the player's DM.

**Dice notation is gone**, from `#turns` and Default Moves alike. `parseResourceDelta` (`+N`/`plus N`) is unchanged; a range like `5-12` replaces `1d6*2` and is whitespace-bounded on both sides for the same reason the `+N` regex is (so `Sector-9` isn't misread). The known, accepted cost is that a bare `5-12` is also ordinary English — matching once rather than globally bounds it, the `#turns` confirm DM shows the parsed roll before anything lands, and the Default Move tooltip says outright that a bare range reads as a roll. `Action.resourceDiceExpression`/`resourceDiceRoll` were renamed to `resourceRollExpression`/`resourceRollValue` with `@map`, so the SQL columns are untouched and the migration is empty; a leftover `"1d4*3"` row returns `null` from `rollResourceRange` and confirms on its flat delta rather than throwing.

## Requests, Mood, and Desires

Players change their own sheets **without waiting on GM approval**: they act, the effect lands immediately, and a GM reviews afterwards from the Requests tab. Full writeup: `docs/systemdocs/REQUESTS.md`.

Twelve request types (`RequestType`): `SET_MOOD`, `TRANSFER_RESOURCES`, `ADD_TAG`, `REMOVE_TAG`, `CONSUME_TAG`, `TRANSFER_TAG`, `FULFILL_DESIRE`, `CHANGE_WORST_FEAR`, `FULFILL_WORST_FEAR`, `HEAL_CHARACTER` in `web/app/(app)/character/requestActions.js`, plus `DONATE_BLOOD`/`FEED_PERSON` in `web/app/(app)/lifeweb/requestActions.js` (the Mortus-only Lifeweb panel — blood is worth 40/30/20 by the *target's* Nobility/Courtier tags, capped at a 100 pool, numbers shared with the GM bypass panel via `db/lib/lifeweb.js`). Feeding someone deliberately does **not** kill them: the request flags itself red in the Requests tab and a GM pulls the trigger with the panel's Kill button (`killRequestTarget`). All twelve re-validate everything the client sent, and all write the effect plus the `Request` row in one `$transaction`.

The load-bearing schema detail: a `Request` carries **both** `payload` (what was asked) and `effect` (what was actually applied). **Undo reads only `effect`** and never re-derives from live state — otherwise a GM editing an amount, or the player transacting again, silently corrupts the reversal. Per-type Undo/Edit behaviour lives in `web/lib/requestEffects.js`; adding a type means one entry there, one in `RequestPanel.js`'s `SECTIONS` map, and one enum value — nothing else changes.

`web/app/components/RequestDialog.js` is the universal "What is your reason?" popup (a component taking `children`, not a `useConfirm()`-style hook, since the second half is arbitrary JSX per call site). `useConfirm()` still covers pure yes/no moments.

**Mood** is not a column — it's the `happy`/`unhappy` Status tags in `docs/tags.yaml` (`durationTurns: 2`), with Neutral being the absence of both, so the existing `resolveNeeds()` expiry sweep handles it for free. Both are `purchasable`/`removable: false`, so the only ways in are the Set Mood button and a GM. `db/lib/mood.js` is the single shared source of the ±1 Gambit modifier for bot and web.

**Desires** (`Desire`) are self-set goals worth 1–5 Tag Points. Setting and cancelling are *not* requests (nothing was granted, so there's nothing to undo) and use `useConfirm()`; only fulfilling is a request. Ending one stamps `endedTurnNumber`, which drives a one-turn cooldown.

**Worst Fears** are the mirror, sharing the same panel via a tab (`GoalsPanel.js` → `DesirePanel.js` / `WorstFearPanel.js`). One dread per character, worth a flat **−3** Tag Points when it comes true — never a ladder, never GM-re-scorable. It is **three columns on `Character`** (`worstFear`, `worstFearSetTurnNumber`, `worstFearLastFulfilledTurn`) rather than a model, because fulfilling it does **not** consume it: the text stays and the same fear can come true again next turn, so there's no lifecycle and no history for a table to hold. Named optionally as the wizard's new 4th step and then locked in — the first set is free, changing it is a `CHANGE_WORST_FEAR` request. Its undo restores the cooldown stamp **only if the live stamp still matches that request's own turn**, or a later claim would be handed a free extra trigger. Points may go negative. Full writeup: `docs/systemdocs/REQUESTS.md` §5b.

**Healing** (`HEAL_CHARACTER`) is the Heal button beside Consume on `/character`, and the third type that touches someone else's sheet — `request.characterId` is the medic, `effect.targetCharacterId` the patient, so every tag write in `requestEffects.js` takes the latter. It is gated on holding `medical-basic` **or a higher tier**: Medical tiers replace each other up `Tag.parentTagId`, and `web/lib/healRequests.js` walks that chain (pure, cycle-guarded, shared by the picker and the server action) so a surgeon can do a nurse's job. A patient must share the healer's `locationId`, re-validated inside the target's `WHERE` clause rather than by a second read. What's treatable is data rather than a slug list — a held `Status` tag carrying any `requirement*` field — and the cost is `Tag.requirementResources` straight off the catalog, so `docs/tags.yaml` retunes the price; `null` cures for 0 ⬢ but **still demands and records a payer**, since who was on the hook is the part a GM needs. This is the first place `requirement*` is enforced rather than displayed. The payer menu is every co-located living player plus every faction Silo regardless of Silo authority (the `TRANSFER_RESOURCES` bet), and billing someone else asks twice while treating someone else does not — a cure is not a harm, being charged for one is. Full writeup: `docs/systemdocs/REQUESTS.md` §5c.

Every request also writes an `AuditLog` row carrying the reason verbatim — that's the new **Reason** column on `/gm/audit`, blank for non-request entries.

## Hunger

The other half of the per-turn Needs loop, built on exactly the same pattern as Mood: a `hunger` Status tag in `docs/tags.yaml` (`durationTurns: 1`) worth **−1 to the die on all Gambits**, stacking additively with Mood. Nothing player-initiated ever grants or removes it — no request type, no picker entry. `db/lib/hungerPass.js#runHungerPass` is the only writer, called from `resolveNeeds()` at the close of every turn: a character holding `hungerless` is **skipped entirely**; one holding `ate-meal` is **shielded** from Hunger, has the tag consumed, and **owes nothing** — the meal was already paid for when it was cooked (2 ⬢ Fine, 3 ⬢ Lavish), so billing the upkeep on top made eating strictly worse than the 1 ⬢ it saves; everyone else is **checked before being charged** — at 0 ⬢ you go Hungry and owe nothing, at 1+ ⬢ you pay 1 and stay fed. So 1 ⬢ always buys a fed turn and `Character.resources` can never go negative without a `Math.max`.

Two ordering details are load-bearing. The pass runs **after** the `expiresTurn` sweep, never before: last turn's Hunger carries `expiresTurn` equal to the closing turn's number, so the sweep clears it a moment before a fresh one may be granted — the other order collides with `CharacterTag`'s `@@unique([characterId, tagId])` and silently drops the re-grant. And a Hunger granted while closing turn N carries `expiresTurn = N + 1`, so it bites for exactly turn N+1 — which is what makes `ate-meal`'s "won't go hungry next turn" literally true.

Going hungry sends one DM; a quiet −1 ⬢ sends nothing. `runHungerPass` doesn't send it, though — it returns `starvedDiscordUserIds` and the DMs go out from `advanceTurn()`'s `runSideEffects()` thunk, so the pass itself makes no network call at all and the turn advance isn't held open behind N sequential Discord round-trips (see "Moves and adjudication" above). The DM goes through `db/lib/dm.js#sendDm(prisma, discordUserId, content)`, a REST twin of the other two `sendDm`s that exists because `advanceTurn()` runs from both the bot's cron and the web Dev Panel and can't assume a gateway client. The pass writes **one summary `hunger_resolved` audit row** per turn rather than one per character — at 100+ players the latter would drown `/gm/audit`. Full writeup: `docs/systemdocs/REQUESTS.md` §4.

## Zones, Locations, and character roles

See also `docs/systemdocs/CHANNELS.md` for the full schematic of the Location Discord layout (category/channel naming, slowmode, forum-vs-text) and how per-character role visibility is kept in sync.

Geography is two levels: `Zone` (e.g. "Town") and `Location` (e.g. "cathedral", nested under a Zone via `Location.zoneId`). Each `Location` maps to a standard Discord layout — one category plus three channels named after the location (`cathedral`, `cathedral-public`, `cathedral-private`).

`docs/locations.yaml` is the **sole master** for the Zone/Location list (`id` slug, `name`, `zone`, `description`, `publicSubLocations`, `privateSubLocations`, free-text `tags`) — there is no manual "add/edit Zone/Location" UI at all (the `/gm/dev/zones` Dev Panel page, its nav link, and its `provisionLocationChannels`/`updateLocation`/`updateZone` actions were removed since locations are never hand-edited mid-game; `db/prisma/seed-zones.js`, the old hardcoded seed script, was deleted earlier along with the original manual UI). Editing the YAML and running `npm run db:sync-locations` (`db/prisma/sync-locations.js`, a thin wrapper around `db/lib/syncLocations.js#syncLocationsFromYaml`) is the only way Zones/Locations get created, updated, or removed. It's a **manual, terminal-invoked command by default** — no cron, no per-turn hook — but the same `syncLocationsFromYaml(prisma)` function is also called automatically at the end of `wipeGameData`'s "Restart Game" flow (`web/app/(app)/gm/dev/actions.js`), so a reset always lands the game on the canonical location set. The sync is **fully destructive**, matched by `Location.slug`: any Zone/Location no longer listed in the YAML has its Discord category+channels deleted and its DB row removed (Zones are pruned too, once they have zero remaining Locations and no longer appear in the YAML) — there's no undo short of re-adding the entry, which provisions a brand-new category/channels rather than restoring the old ones. New/still-missing Locations get Discord channels provisioned — one category plus three channels — for any Location still missing `discordCategoryId`; **provisioning itself and channel/category *names* stay one-time** (re-running the sync on an already-provisioned Location never renames or recreates its channels), but `description`/`publicSubLocations` keep syncing on every run: they're rewritten into the plain (summary) channel's topic as `{description} | **Sublocations**: {publicSubLocations, comma-joined}`. Locations start unprovisioned (all `discord*Id` fields null) until synced.

Every `ALIVE` character gets a personal Discord role titled after their **bare** name — first + last, via `formatBareName`, never the honorific or granted title (`Character.discordRoleId`) — colored deterministically from a curated muted cyan/terracotta/brown/green palette (`db/lib/roleColor.js#hashNameToColor`, seeded from that same bare string, so the same name always yields the same color and a rename very likely changes it too). Bare on both counts deliberately: the role is an `@`-mentionable access-control primitive rather than an RP surface, and seeding the color off the bare name means granting or changing a title never renames or recolors anyone. `web/lib/discordGuild.js#ensureCharacterRole` creates+assigns the role the first time a character has a name, and renames/recolors it on every later profile save — called from both `updateCharacterProfile` (self-service, `web/app/(app)/character/actions.js`) and `updateCharacterRaw` (GM raw edit, `web/app/(app)/gm/dev/actions.js`). `db/prisma/backfill-roles.js` (`npm run db:backfill-roles`) is a one-off catch-up for characters that predate this.

This personal role is also the **sole access-control primitive** for Locations: a single `ViewChannel` permission overwrite on the Location's category (its three channels inherit it) is added for a character's role when they arrive and removed when they leave — `bot/src/lib/location.js#swapLocationAccess` (gateway, self-service travel) and `web/lib/discordGuild.js#syncCharacterLocationAccess` (REST twin, called from `updateCharacterRaw` on GM raw location edits) are the two call sites. The `-private` channel additionally denies `SendMessages`/`CreatePublicThreads` and allows `CreatePrivateThreads` for `@everyone`, so it's only ever used for GM-spun-up secret side-conversations, never top-level chat (same "private threads for secret conversations" concept referenced in the Notes scoping, below). All three Location channels count as tupper channels, and the plain channel also counts as a summary channel — `isTupperChannel`/`isSummaryChannel` (`bot/src/lib/channels.js`, `web/lib/discordGuild.js`) check Location channel IDs directly; there is no name-based marker.

Players self-serve travel from the guild's single `location` text channel (read-only for `@everyone`, locked down by `bot/src/lib/location.js#ensureLocationPrompt` on bot ready): it carries one tracked message with a ⚜ **button** (not a reaction — Discord modals can't contain dropdowns and reactions can't open ephemeral UI, so this is the bot's first use of buttons/select-menus/`interactionCreate`, handled in `bot/src/events/interactionCreate.js`). Clicking it opens a private, ephemeral Zone → Location cascade of select menus ending in a Confirm button. `db/lib/travel.js#performTravel` decides the cost (it used to live inside `performMove`; it moved so the web app's Map panel could run the identical rules — see "Map panel" below): moving to a Location **within the character's current Zone is free** (no `Action` created); moving to a **different Zone spends the turn** — it's submitted as a real, auto-resolved `Action` (`status: CONFIRMED`, `moveReviewStatus: SOLVED` immediately, no GM step, tagged `gmNotes: "auto:zone_change"` so it's identifiable), which naturally lands in `/gm/turns`' Moves history rather than the pending queue. This reuses the same turn-economy as Move submissions: `bot/src/lib/actionSubmission.js` now checks for *any* existing `Action` on the open `Turn` (including an auto-resolved zone-change) before accepting a new Move, and `performTravel` does the same check in reverse — so acting and changing zones are mutually exclusive within a turn, in either order.

`performTravel` deliberately performs **no Discord side effects**, the same split `advanceTurn()`/`runSideEffects()` uses and for the same reason: the bot has a gateway client and the web app only has REST, so it returns `oldLocation` and each caller runs its own twin afterwards — `bot/src/lib/location.js#performMove` (now a thin wrapper) calls `swapLocationAccess`/`syncCharacterNarrowcastAccess`, and `web/app/(app)/map/travelActions.js#travelTo` calls `web/lib/discordGuild.js`'s REST equivalents.

The **free-vs-paid rule itself** is one pure function, `db/lib/travelCost.js#isTravelFree` — same posture as `narrowcastAccess.js`/`laborAccess.js`, matched on Location **slug**. Same zone is free, with exactly one hardcoded exception: `DEPTHS_SLUGS` (`caverns`, `railroad`, `aberrant-pits`) — the three levels of the Depths sit in the Caves zone, but moving between any two of them costs a Move anyway. That is the only place in the game where two Locations in one Zone aren't a free walk apart, and it's deliberate rather than a fallout of how the zones are drawn: going deeper is supposed to hurt. Entering the Depths from Customs is still free, since Customs isn't one of the three — only level-to-level costs. Migrants start on the **Railroad** (`docs/roles.yaml`), which is the line everyone who comes to Ravenheart from elsewhere arrives on, so "make it to the fortress" is now two paid Moves rather than a figure of speech. `DEPTHS_SLUGS` is also what `narrowcastAccess.js` reads for the `#radio` dead zone, so all three levels are dead air.

## Map panel

`/map` (`web/app/(app)/map/`) is the web app's travel surface — before it, moving was Discord-only. It's a pointcrawl: rhombus nodes with the location name on a stem above them, laid over one of three grounds (**Forest**, the default photographic plate; **Plate**, the drawn `Map_Basic.png`; **Bare**). The Plate carries **no pointcrawl at all** — nodes, labels and roads are hidden over it, because a rhombus grid on top of a hand-drawn map fights the drawing. The ground choice persists in `localStorage`, read through `useSyncExternalStore` rather than an effect (`react-hooks/set-state-in-effect` is an error in this repo, and the server snapshot is simply `null`).

Node positions are **data, not code**: `map: { x, y }` in `docs/locations.yaml` (0–100 percentages of the 4:3 plate) synced into `Location.mapX`/`mapY` on every run, alongside `description`/`publicSubLocations`. Retuning the layout is a YAML edit and a re-sync. `npm run map:check` (`db/prisma/check-map.js`) is the fast loop: pure geometry over the YAML, no DB, reporting crossing roads, nodes drawn on top of each other, and roads grazing a location they don't connect to. A road touching a Depths level is drawn **dashed**, as a tunnel, and its crossings are reported separately rather than as failures — the Gatehouse stair down to the Caverns has to pass beneath the town band, and no arrangement of nodes avoids that, since the Cathedral and the Sanctuary both bridge the Forest and the Square.

Two things carry the panel. **Tiers are resolved server-side** in `page.js`, by asking the same `isTravelFree` the server action will ask on submit — so the map can never colour a hop green and then charge for it. There are five: `here`, `free` (green), `cost` (amber, asks a confirm saying the Move is spent), `noroad`, and `spent` — a costing hop the character can't afford because they already acted this turn, greyed out *up front* rather than failing after the confirm. And the **destination list beneath the plate is always rendered**, not a mobile-only branch: it's the usable surface at 390px, the keyboard/screen-reader path on any screen, and the only way to travel while the Plate ground is up. Confirmation goes through the shared `useConfirm()` dialog, not a one-off modal.

The plate's colours are `--map-*` tokens in `globals.css` that deliberately **do not** flip with the theme — the pointcrawl rides on a photograph, so a light theme would put black labels on a night picture.

`Character.zoneId` is kept as a denormalized mirror of `location.zoneId` (updated in the same write as `locationId`) purely so the pre-existing zone-stamping on `Action`/`DefaultEffort`/`Note` and the zone-filter UI across `/gm/players`, `/gm/turns`, and `/notes` keep working unchanged — `locationId` is the authoritative "where is this character" field. New characters start with `locationId: null` (no location channel access) until a GM assigns one via `/gm/dev/characters/[characterId]` — there's no default-starting-location config.

## Character names

A displayed name is **four fields**, joined by `db/lib/characterName.js#formatCharacterName`:

```
Sir Jorren "the Blind" Vask
 |    |         |        |
 |    |         |        `-- lastName   String?  optional, player-editable
 |    |         `----------- title      String?  GM-ONLY, renders in quotes
 |    `--------------------- firstName  String   required, player-editable
 `-------------------------- honorific  String?  player picks from a fixed dropdown
```

`honorific` is ungated — any character may pick any of the 21 entries in `HONORIFICS` (Mr./Mrs./Ms./Master, Sir/Dame/Lord/Lady/Baron/Baroness, Father/Mother/Brother/Sister/Bishop, Captain/Sergeant/Marshal/Constable, Doctor/Professor). `title` is the opposite: it is set **only** from `/gm/dev/characters/[characterId]`, and the character sheet shows it as a `disabled` input with a "make your case to a GM" tooltip. The lock is not the greying — a disabled input submits nothing, and `updateCharacterProfile` never reads the key. It does have to feed the row's *existing* `title` back into `formatCharacterName`, though, or a player saving their bio would silently strip a title a GM had granted.

`Character.name` survives as a **denormalized mirror** of that join, same posture as `Character.zoneId`. It is what ~60 readers want — `orderBy`, `select: { name: true }`, the `/gm/audit` `contains` search, the proxy webhook username, the `dawnWipe` map key — and Prisma cannot concatenate columns in `orderBy`/`contains`, so dropping it would force search and sort into `OR`-over-three-columns for correctness nobody can see. Keeping it also means `bot/src/lib/proxy.js` and `db/lib/dawnWipe.js` read the same column and so **cannot** desync, and the never-backfilled name snapshots (`Note.characterName`, `SiloTransaction.actorName`/`toName`, `AuditLog.details`) capture the titled form with no code change — correct, since those are records of who did something *as they were known then*.

Exactly **three writers** keep the mirror honest, and all three go through the formatter: `character/createActions.js`, `character/actions.js#updateCharacterProfile`, and `gm/dev/actions.js#updateCharacterRaw`. A fourth must do the same; `npm run db:backfill-name-parts` is the drift check that catches one that doesn't.

`Character.age` (18–90, nullable) sits with the name fields and follows the
same shown-but-locked posture as `title`, from the other direction: it is the
player's to set, but only once. While null the `/character` input is live; the
moment a number is saved it renders `disabled` with an `InfoIcon`, and
`updateCharacterProfile` refuses to overwrite a non-null age however the form is
posted — the disabled input is the hint, not the lock. The wizard takes it
optionally, and a GM can always correct it from
`/gm/dev/characters/[characterId]`. It is read by `db/lib/concealedIdentity.js`
for the Young/Old half of a concealed alias.

`NAME_LIMITS` (10/24/20/20) is not cosmetic. Discord caps a webhook username at 80 characters and the proxy sends `name` as-is; slicing it there would silently break the `dawnWipe` lookup, so the *inputs* are capped instead and the composed name is ≤79 by construction. All three writers apply the caps and `normalizeHonorific`'s allowlist server-side — every one of those forms is a public endpoint.

Two surfaces deliberately use the **bare** name (`formatBareName`, first + last) instead: the personal Discord role's name and colour seed, and the nickname — see "Nickname sync" above and "Zones, Locations, and character roles" below. Because a bare name is byte-identical to what `name` held before the split, the migration is a no-op on the Discord side: nothing renames, nothing recolours, no REST call fires on deploy.

Sorting moved with the split. `orderBy: { name: "asc" }` on a Character would now file `Sir Jorren` under S, so the seven Character-model sites use `[{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }]`, which reproduces the old ordering exactly. Most `orderBy: { name }` in the codebase is on Faction/Zone/Tag/Location and is untouched — check the model before changing one. The client-side `characterName` sort in the GM tables still sorts the titled string, which is fine: those tables are searched far more than sorted, and the search matches the same string.

## Character creation and roles

A signed-in player with no `ALIVE` character sees the **creation wizard**
rendered inline at `/character` (there is no `/character/new` route — it was
removed). Four steps: name → role → point-buy → confirm. The name step takes
an honorific dropdown, a required first name and an optional last name (see
"Character names" above) with a live preview of the joined result; there is no
`title` input, since it is GM-granted and an input a player cannot fill is
worse than its absence.

`docs/roles.yaml` is the master for the `Zone`/`Faction`/`Role` tables, synced
by `db/lib/syncRoles.js#syncRolesFromYaml` (`npm run db:sync-roles`), which
replaced the old `db/lib/factionSync.js`. Threats are deliberately **not in
that file** — Sympathizer, the Demoness, the Cult of Bacchus, the Judge, the
Brigands are hand-assigned GM seats that must not appear in the picker, so
they're prose in `docs/threats.md` (kept down to name, intro, description and
starting tags; the seat/resource/location fields they used to carry were never
read by anything). Roles are matched by `slug`, carry a starting package
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
It is signed **catalog-style** (Frail is `-3`) everywhere the math happens, but
`formatCost`/`costColor` invert it for **display**, so both the sign and the
colour describe the player's point pool rather than whether the tag is good
to have: Frail reads `+3 pts` in `--positive`, Fighting (Basic) reads `-3 pts`
in `--accent`. Those two functions are the only place that flip lives — never
negate `pointCost` at a call site.
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
on any level of the Depths (`DEPTHS_SLUGS`, `db/lib/travelCost.js`); `#intercom` is viewable by anyone in Fortress or Town, speakable
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

`docs/tags.yaml` is the **sole master** for the `Tag` catalog and `docs/taggroups.yaml` is the sole master for the `TagGroup` catalog (split out of `tags.yaml` so group colors can be freeform), same posture as `docs/locations.yaml` — hand-edited, `slug` is the stable match key, and `db/lib/syncTags.js#syncTagsFromYaml` (reads both files, run via `npm run db:sync-tags`, or automatically at the end of `wipeGameData`'s "Restart Game" flow right after `syncLocationsFromYaml`) is upsert-only and never deletes a row just because its YAML entry was removed. A `Tag` belongs to a `category` (a flat string validated against `tags.yaml`'s own `categories:` list, not a DB table: `Meta`, `General`, `Skills`, `Status`, `Items`, `Assets`, plus the two **hidden** categories `Demoness` and `Bacchus`) and optionally a `TagGroup` scoped to that category, which exists purely to color the tag — `TagGroup.color` is a freeform hex string, rendered directly by `TagChip.js` (not theme-aware) — a groupless tag just renders uncolored. Full schema/mechanism writeup, including the two distinct self-relations (`parentTag`, a replacing tier chain like Fighting (Basic) → (Trained) → ...; vs. `requiredTag`, a non-replacing prerequisite like Fighting (Archer) requiring Fighting (Basic) while coexisting with higher Fighting tiers), is in `docs/systemdocs/TAGS.md`. `TagGroup.requiredTag` is the **whole-group** version of that prerequisite, and it is what makes a **hidden category** work: Demoness and Bacchus each contain exactly one gated group (behind the `demoness` and `follower-of-bacchus` tags respectively), and the gate is written once there rather than repeated on every tag inside. `requirementSatisfied()` in `web/lib/characterCreation.js` is the single place the per-tag and per-group gates are combined; it is read by `PointBuy.js`, the Add Tag picker in `TagRequestButtons.js`, and re-checked server-side by `createCharacter` and `addTagRequest` (both menus are advisory). Three details are load-bearing: the category tabs are derived **after** the gate filter, so a locked category has no tab rather than an empty one that advertises itself; the Add Tag picker folds the character's own held tags into its lookup map, since the tags that *open* a gate are `purchasable: false` and so absent from its catalog; and `web/app/api/tags/route.js` — previously unauthenticated and complete — now resolves the caller's character and withholds gated tags, since it was otherwise one DevTools tab away from the whole secret. A GM grant still ignores every gate, deliberately. `pointCost`/`purchasable`/`purchasableAfterStart` are no longer inert catalog data: they drive the point-buy menu (see "Character creation and roles" above). **Items are the portable half of the catalog and Assets the standing half** — a revolver or a meal you carry and hand over, versus a Manor, a House, or a Follower you simply have; the property-vs-companion split inside Assets is carried by `TagGroup`s (`assets-property`, `assets-companions`), not by a third category. `stackable: true` in the YAML (backed by `Tag.stackable` + `CharacterTag.quantity`) lets one character hold several of a tag — meals, ammunition, anything a crafting Move makes in a batch. A stack is **one `CharacterTag` row carrying a count, never N rows**: `@@unique([characterId, tagId])` stays, so every presence check in the codebase keeps reading "holds it or doesn't" unchanged. Only `web/lib/requestEffects.js`'s `addToStack`/`dropCharacterTag`/`restoreCharacterTag` write `quantity`; the point-buy wizard is a toggle-set with no quantity anywhere, so a stackable tag can never be point-farmed at creation. `consumable: true` marks a tag a player can **use up** from their own character sheet, and `consumesInto` (a list of tag slugs, backed by `Tag.consumesInto`) is what it turns into — a meal becoming `ate-meal`, Starting Wares unpacking into goods, a Wound leaving a Scar. Consuming always takes **exactly one unit**, even from a stack, so there is no quantity field in that path; it is a `CONSUME_TAG` Request, so it lands immediately and a GM can Undo it. Repeating a slug grants several of it, but only for a `stackable` target. Granted tags with their own `durationTurns` start their clock at that moment, so chains work (meal → `ate-meal` → the expiry sweep); a non-stackable tag the character already holds is left untouched rather than reset, and the undo snapshot records what was *actually* added so Undo never confiscates a tag it didn't grant. `web/lib/requestEffects.js`'s `grantTagSlugs()` is the single writer. Tag descriptions carry the same `{tag:…}`/`{resource:…}` tokens documents do, but render through `ChipText.js` rather than `RichText.js` — all three places a description appears (a hover tooltip, and the two picker rows, which are `<button>`s) forbid an interactive chip, so tokens resolve to a plain `ChipLabel`. Both share the parser in `richTokens.js`, which is its own file because `RichText` renders `TagChip` and `TagChip` renders `ChipText`. A `consumesInto` entry may also be **conditional** — written in the YAML as `- slug: happy` + `unlessTags: [nobility]`, stored beside the flat list in `Tag.consumesIntoUnless` (`Json`, null for everything unconditional), and applied by the pure `resolveConsumeGrants()` in `web/lib/consumeGrants.js`, which the server action and the client "Becomes:" preview both call so a preview can't promise a grant the character won't get. Fine Meal is the only one today: it cheers an ordinary person, while Nobility expect one as a matter of course. **This replaced the old `grantsOnExpiry` ("expires into") field, which was removed outright** — letting the player choose when to unpack beats making them wait a turn, and two "tag becomes other tags" mechanisms was one too many. Note that character creation (`createActions.js`) stamps `expiresTurn` from `defaultDurationTurns` on every tag it grants — without that a timed tag bought at creation would never expire.

`stackable` combines safely with `durationTurns` — the expiry sweep sheds one unit per expiry and rerolls the remaining stack's timer (`sweepExpiredStacks` in `db/index.js`), deleting the row only when the last unit goes. `web/app/api/tags/route.js` feeds the read-only catalog to `TagsProvider`/`RichText.js`'s `{tag:slug}`/`{tag:id}` inline references and to `TagChip.js` (the hover-tooltip chip used everywhere a character's tags render, e.g. `CharacterSheet.js`).

`Leader`/`Treasurer` are **not** tags — both are plain booleans on `Character` (`isLeader`, `isTreasurer`), assigned dynamically from `/faction` (`web/app/(app)/faction/actions.js#setFactionLeader`/`setTreasurer`) by a GM (Leader) or a GM/the faction's current Leader (Treasurer), and read by `db/lib/factionPermissions.js#getMyFactionRole`/`getSiloAccess` to gate Silo management. That module lives in `db/lib` (taking `prisma` as its first parameter, same convention as `db/lib/dm.js`, and deliberately not spread into the `@lifeweb/db` barrel) because both faces of the game ask the question; `web/lib/factionPermissions.js` is a thin shim binding the singleton `prisma` so web call sites keep the shorter signature. Silo authority is also what gates **seeing a member's Resources**: the roster column on `/faction` (including the subject-faction view a parent's Leader/Treasurer can open) and the Resources field on the bot's 🔍 inspect embed (`bot/src/events/messageReactionAdd.js`) are both behind `getSiloAccess`, and are simply absent rather than masked for anyone else. Two more inspect fields follow that same absent-not-masked posture but are gated on the **inspector's** own tags rather than the subject's: Seductive reveals the subject's active Desire and Torturer their Worst Fear, resolved by `db/lib/inspectVision.js` (which also accepts each tag's discounted Demoness twin). It's bot-only — the web has no other-player character sheet. `Character.status === "ALIVE"` isn't a tag either. Silo authority no longer gates a *transfer* UI of its own, though: `/faction`'s "Transfer from Silo" panel was removed, since it was a direct mutation with an optional note and no `Request` row, so a GM could neither review nor undo it. The one way to move ⬢ out of a Silo is now the `TRANSFER_RESOURCES` request on `/character` (`TransferResourcesButton`), which demands a reason, shows up in the Requests tab, and is undoable. `SiloTransaction` rows are still written on both directions of that transfer, so `/faction`'s Silo history is unchanged.

## Equipment and concealed identity

A character may have up to `GameConfig.equipSlots` (default 6, editable from
the Dev Panel) tags equipped at once. `Tag.equippable` marks what qualifies —
set from `equippable: true` in `docs/tags.yaml` — and `CharacterTag.equipped`
carries the state, so equipping is a property of *holding* the tag and every
existing "does this character hold X" query is untouched. A `stackable` tag
takes **one** slot however many units are held.

Equipping is **instant and writes neither a `Request` nor an `AuditLog` row**,
unlike everything in "Requests, Mood, and Desires" above. It costs nothing, the
player undoes it in one tap, and at 100+ players a row per toggle would drown
`/gm/audit`. `toggleEquip` (`web/app/(app)/character/equipActions.js`) resolves
the character from the session rather than trusting a posted id, re-checks
`tag.equippable`, and counts the slots in a transaction — but the count alone is
**not** sufficient: Prisma runs at READ COMMITTED, so two tabs both read the same
free slot and both write. The transaction opens with
`SELECT id FROM "Character" ... FOR UPDATE`, which serializes equips per
character; without it a burst of 8 concurrent equips all land against a cap of 6
(verified). `EquipmentPanel.js` is click-to-toggle rather than drag-and-drop —
drag needs a touch fallback that would be exactly this anyway — and is its own
surface rather than an affordance on `TagChip`, whose click already opens the
Consume dialog.

`Tag.concealsIdentity` marks gear that hides who you are (a mask, hood, closed
helm). `db/lib/syncTags.js` **throws** on `concealsIdentity` without
`equippable`, since a mask nobody can equip could never conceal anything. The
field is currently **inert** — concealing is open to everyone (below) — and is
kept only so the gate can be restored without a migration.

A message in a tupper channel beginning `/conceal` is reposted under an
anonymous alias instead of the character's name. It is **open to everyone**,
with nothing equipped and no tag required — a player decides for themselves
when to go unnamed. `Tag.concealsIdentity` still exists in the catalog and is
still synced, but nothing reads it; re-gating would be one query in
`messageCreate.js`. It is a literal text prefix, deliberately **not** a
registered slash command: a slash command replies
through an interaction rather than the webhook, so ✏️/❌/⭐/🔍 would all stop
working on the result. As a prefix it rides the ordinary proxy path and every
reaction behaves unchanged.

The alias comes from `db/lib/concealedIdentity.js` (pure, in the barrel beside
`characterName.js`): `[Young|Old|]` from `Character.age` (under 25 / 55+, nothing
between, nothing when age is null) plus `[Man|Woman|Person]` from the honorific —
rank and profession say nothing about the wearer, so Captain, Doctor and the rest
fall through to Person, as does having no honorific. `assertHonorificsCovered()`
is the guard against `HONORIFICS` gaining an entry that silently reads as Person.
The avatar is `web/public/assets/unknown.png`, served straight out of `public/`
and identical for everyone — a per-character concealed avatar would be a
fingerprint.

`recentProxies` records `concealed`/`alias`, and three handlers read it:
🔍 returns a **hardcoded** embed before any of the normal field logic (the
concealed line, plus only `visibleOnInspect` ailments and `visibleOnInspect`
equipped gear — no appearance, name, Desire, Worst Fear or Resources, even for a
viewer whose gates are open); ⭐ files the alias in `Note.characterName` rather
than the real name; ✏️/❌ are unchanged, since both already gate on
`proxy.discordUserId`. "Ailments" resolves as `tag.group?.slug ===
"status-health"` alone — `TagGroup` is already category-scoped, and `Tag.category`
stores the *display* name ("Status"), so testing it would be a casing trap.
Because `recentProxies` is in-memory and capped at 500, a bot restart makes an
old concealed message inert to every reaction, which is the safe direction.
`db/lib/dawnWipe.js` needs nothing: its name lookup simply misses an alias.

## Discord permission model

There is no single unified permission system — a few independent kinds of Discord role drive access, each synced from a different piece of state, plus one env-configured admin role. `Faction` is not one of them — it's a pure Lifeweb game-state concept (see "How the bot populates the database" above) with no Discord role backing it at all.

- **Personal character role** (`Character.discordRoleId`, one per `ALIVE` character, titled after the character's name) — the sole access-control primitive for Location categories (see above). Created/renamed by `ensureCharacterRole`, granted/revoked per-category by `swapLocationAccess`/`syncCharacterLocationAccess`.
- **GM role** (`DISCORD_GM_ROLE_ID` env var) — checked via REST (`web/lib/discordGuild.js#isGm`) against the signed-in user's guild member roles to gate `/gm` pages and the `/gm`/`/message` slash commands; not stored on any Lifeweb model.
- **Narrowcast channels** (`#radio`, `#intercom`) use the personal character role above, not a separate role — see "Narrowcast channels" below.
- **Spectator role** (`SPECTATOR_ROLE_ID`, hardcoded in `db/lib/roleIds.js`) — a standing read-only observer seat: `ViewChannel` on every Location **category** (all three channels inherit) and on `#radio`/`#intercom`, with `SendMessages`/`AddReactions`/`AttachFiles`/`ManageMessages` and all three thread bits denied. One static role, unlike the personal character role — it never moves, so it's applied at provisioning time (`db/lib/spectatorAccess.js`, called from `syncLocations`/`syncNarrowcastChannels`) and by `npm run db:backfill-spectator-access` for anything provisioned earlier, and is deliberately **not** part of the per-Move access sync. The wide deny list is load-bearing: `ViewChannel` alone still leaves a forum postable and a thread writable, and `-private` channels allow `CreatePrivateThreads` for `@everyone`, which a spectator would otherwise inherit.
- **Player role** (`PLAYER_ROLE_ID`, hardcoded in `db/lib/roleIds.js`) — who may create a character, checked by `web/lib/discordGuild.js#isApprovedPlayer` and paired with `GameConfig.openToPlayers` (see "Launch gating" below).

The last two are the only role IDs kept **in code** rather than in the environment. A role ID is not a secret (anyone in the guild can read it) and Lifeweb is single-guild, so there is exactly one correct value that can never differ per environment — while a missing env var would have meant a deploy where the player gate silently locked everyone out, or the spectator overwrite silently did nothing. Same reasoning as `web/lib/superadmin.js`. `DISCORD_TOKEN` is a real credential and `DISCORD_GUILD_ID`/`DISCORD_GM_ROLE_ID`/`DISCORD_CURSED_ROLE_ID`/`DISCORD_TURN_PING_ROLE_ID` predate this, so those stay in `.env`.
- **Turn-ping role** (`DISCORD_TURN_PING_ROLE_ID` env var) — a plain opt-in notification role, added/removed by `setTurnPingRole` when a player toggles "Turn Ping?" on `/character`.

## Launch gating

Character creation is behind two independent locks, both of which must be
open: `GameConfig.openToPlayers` (a Dev Panel toggle, off by default — "the
doors are open") and the hardcoded `PLAYER_ROLE_ID` ("you are on the list"). The
enforcement boundary is `createCharacter`
(`web/app/(app)/character/createActions.js`), checked before any point-buy
validation; `/character` additionally renders `CreationClosed.js` instead of
the wizard so the reason is legible up front rather than arriving as an error
after four steps.

The gate covers character creation **only**. Everything else, `/documents`
especially, stays readable — that's the point, since the site goes up before
the game opens so players can read the rules.

## Documents

`docs/documents.yaml` is the sole master for the `Document` catalog, matched
by `key`, synced by `db/lib/syncDocuments.js#syncDocumentsFromYaml`
(`npm run db:sync-documents`, and automatically at the end of `wipeGameData`'s
"Restart Game" flow after the tag/role syncs it validates against). The sync
is **destructive** in the `syncLocations` sense — a key dropped from the YAML
loses its row — since a Document is pure reference content with no player
state to preserve.

`/documents` (`web/app/(app)/documents/`) renders them as a pinned board of
expandable cards, in two tabs. **PUBLIC** is every `public: true` document and
is readable by any signed-in user, character or not. **ASSIGNED** is not
rendered at all without an `ALIVE` character, rather than rendered empty.
Documents with an empty `description` are filtered out — seven are still
stubs, and a slot awaiting prose shouldn't reach a player as a blank page.

Assignment resolves server-side, and each card shows the reason it's in your
folder in an alt colour (it's metadata about the paper, not part of it). Five
things can put one there: your role's `doc_elements` list in
`docs/roles.yaml` (the primary link — `Role.docElements` was already in the
schema and already synced), a held tag, your role slug, your faction slug, or
a `flags:` entry naming `leader`/`treasurer`, which are `Character` booleans
rather than tags. Those are denormalized onto `Document` as string arrays
rather than four join tables: ~30 rows, rebuilt wholesale each sync, read in
one query per page view.

One deliberate softness in an otherwise strict sync: `documents.yaml`'s
`tags:` lists conflate real Tag names, the Leader/Treasurer booleans, and
free-text authoring notes like `"any of the medical tags"`. Each entry is
routed to whichever bucket it belongs in and anything matching nothing is
*reported*, not thrown — a placeholder is a note to a human. The explicit
`roles:`/`factions:`/`flags:` keys are strict and throw on a typo.

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

Every DM the bot or web app sends or receives is logged to `DirectMessage` (`discordUserId`, `direction: INBOUND|OUTBOUND`, `content`) so `/gm/messages` can show a full per-player conversation with a reply box. On the bot side, use `bot/src/lib/dm.js`'s `sendDm(user, payload)` wrapper (not raw `user.createDM()`/`dm.send()`) so outbound messages get logged; inbound DMs are logged directly in `messageCreate.js`. On the web side, `web/lib/discordGuild.js`'s `sendDm(discordUserId, content)` does the same. A third twin, `db/lib/dm.js`'s `sendDm(prisma, discordUserId, content)`, is the REST-only one usable from `db/` itself — it takes `prisma` as a parameter (requiring `db/index.js` back would resolve to a partial exports object) and is deliberately **not** spread into the `@lifeweb/db` barrel, since three same-named exports with three signatures would invite grabbing the wrong one. Require it by path.

## Bot message style ("aura")

Bot-authored Discord text should feel understated, not like a typical bot dashboard: no big colorful emoji, small unicode marks only. Lines that quote or restate player/character content are prefixed with `»` — e.g. `» {move description}`. `web/lib/discordGuild.js#sendDm` applies this `»` prefix automatically to every DM a GM sends a player (adjudication results, broadcasts, inbox replies), so callers pass the raw message text. Bot-side DMs that the bot itself composes (move/effort confirmations, edit prompts) are written with the `»` prefix inline at the call site instead, since they're paired with other formatting (zone, dice roll) that doesn't come through `sendDm`.

## Resources glyph (`⬢`)

`⬢` is the canonical Resources glyph, and it **stands in for the word rather than sitting next to it** — this applies everywhere text is written: the YAML masters (`docs/roles.yaml`, `docs/documents.yaml`, `docs/tags.yaml`, `docs/systemdocs/infochannel.yaml`), bot/DM strings, and the web UI alike.

- Prose naming Resources (or the Silo) **as a concept** takes the plain word and no glyph: "you are only limited by your Resources", "send Resources straight to a member".
- Wherever a **quantity** is shown, drop the word and write `{number} ⬢`: `0–4 ⬢`, `3 ⬢`, `+5 ⬢`, `30 ⬢ flat`. Never `3 Resources ⬢`.
- In the UI that means the label/header carries the word and the value carries the glyph — `<th>Resources</th>` over cells reading `12 ⬢`, `<Row label="Resources">{n} ⬢</Row>` — never the reverse. A number `<input>` just gets a plain label; there's nowhere to hang the glyph.

Two carve-outs. A `{resource:…}` bubble already renders its own glyph via `web/app/components/ResourceChip.js` (`{value} ⬢`), so never write one after it. And literal syntax a player is meant to *type* (`+3`, `5-12`, `/hunt`) is quoted as-is, never with a glyph appended. `docs/systemdocs/infochannel.yaml`'s glossary line ("the game's central currency are Resources (⬢)") is deliberately left as the one place the glyph is introduced to players.

## GM slash commands

`/gm` and `/message` are the bot's first slash commands (`bot/src/lib/commands.js`), registered per-guild on `ready` (`registerCommands`, guild-scoped rather than global so they update instantly instead of waiting on Discord's ~1hr global-command propagation) and handled in `bot/src/events/interactionCreate.js` alongside the pre-existing button/select-menu location picker. Both are gated on `DISCORD_GM_ROLE_ID` membership, checked the same way as the location picker and `messageReactionAdd.js`'s fog-reaction handler. `/gm <message> [attachment]` posts to the current channel as the bot itself (the slash-command replacement for the old ":gm"-prefix text shorthand, which deleted+reposted a GM's message). `/message <recipient> <message>` DMs a chosen server member as the bot itself, routed through `bot/src/lib/dm.js#sendDm` for `DirectMessage` logging, with the `»` prefix applied inline since it's a bot-composed DM (see "Bot message style" above).

## Git workflow

**Lifeweb is master-only. There are no branches and no pull requests.** All
work is committed straight to `master` and pushed as soon as it's finished, so
it can be pulled locally the moment it's done — that immediacy is the whole
point, and a feature branch defeats it. Railway builds from `master` too, so
work sitting on a branch is work that hasn't shipped.

```
npm run push -- "Commit message"   # git add -A, commit, git push -u origin master
npm run push                       # same, with a "wip" message
```

Never `git checkout -b`, never open a PR, never ask which branch to use. A
remote session that gets handed a throwaway `claude/<slug>` branch abandons it
for `master` — `.claude/hooks/session-start.sh` (wired as a `SessionStart`
hook) does that automatically, and in the same pass deletes any
`origin/claude/*` branch holding nothing `master` doesn't already have. It
refuses to move off a branch carrying uncommitted changes or unmerged commits,
and never deletes an unmerged branch, so it can't lose work; it just prints
what it skipped.

That hook also **fetches**, which matters more than it sounds: a remote
container clones once at session start and then goes stale, so without it a
session can spend an hour editing files that `master` moved past hours ago.

Note that pushing to `master` **is** a deploy — see the migration warning in
the next section before pushing anything carrying a schema change.

## Deploy workflow

Unless the user says otherwise, after finishing a set of changes: `npm run deploy`
from the repo root. That pushes `master` (the branch Railway builds from),
applies any pending migrations, and then redeploys both services.

```
npm run deploy      # git push origin master, ./migrate.sh, redeploy web + bot
npm run redeploy    # just the redeploy, no push, no migration
```

The `./migrate.sh` step sits deliberately **between** the push and the redeploy.
Migrating first means additive columns simply go unused for a few seconds;
redeploying first ships code whose queries reference columns that don't exist
yet, for the whole length of a build. It is a backstop, not a substitute for the
Pre-Deploy Command below — a plain `git push` to `master` auto-deploys without
ever running this script.

**Migrations do not run themselves.** Railway builds and starts the app; it
does not apply schema changes, so a deploy carrying a new migration ships code
whose Prisma queries reference columns the database doesn't have. The symptom
is brutal to diagnose from the browser: the page throws `P2022` server-side and
Next redacts it to a bare digest (`ERROR 330354103`), so nothing readable
reaches the client — and it takes out the whole route, not just the feature
that needed the column. This has bitten twice.

This has now bitten three times, the third being a push straight to `master`:
**Railway builds from this GitHub repo, so pushing to `master` is itself a
deploy trigger** — no `npm run deploy` needed, and so no chance for any script
in this repo to run the migration first. That is why the dashboard setting
below, not the deploy script, is the only complete fix.

The fix is a **Pre-Deploy Command on the `web` service only** (Railway
dashboard → web → Settings → Deploy):

```
npm run db:migrate:deploy
```

It runs after the build and before the new version takes traffic, so a failed
migration aborts the deploy instead of shipping a half-migrated app. Scoped to
`web` deliberately — `bot` shares the database and would only race it. It is
deliberately not a root `railway.json`, which would apply to both services.

Until that field is set, run `npm run db:migrate:deploy` by hand after any
deploy that adds a migration (`db:migrate` is `migrate dev` — never point that
at production). `./migrate.sh` at the repo root is the one-liner for this — it
sources the root `.env` first, since `db:migrate:deploy` needs `DATABASE_URL`
in the environment and npm won't load the file for you.

Two more things that bite:

- **`--from-source` is load-bearing.** A plain `railway redeploy` re-runs the
  *existing* deployment — the same commit. Railway builds from GitHub, so it
  has to be told to pull the commit that was just pushed. Both scripts already
  pass it.
- **A `RAILWAY_TOKEN` must be in the environment.** A *project* token (Railway
  dashboard → the project → Settings → Tokens), not an account token; it needs
  no `railway link`. In a cloud/agent session that means setting it as an
  environment variable — see "Cloud session setup" below. Without it the CLI
  fails with an unauthenticated error and nothing deploys.

The service names in the scripts (`web`, `bot`) must match the service names in
the Railway project.

## Cloud session setup (Claude Code on the web, and similar)

A fresh remote container clones the repo and nothing else — no `.env`, no
global CLIs. To make one able to build, run and deploy:

1. **Secrets.** Set every key from `.env.example` as an environment variable on
   the environment, plus `RAILWAY_TOKEN`. The bot and the Prisma CLI read a
   root `.env` file, so a setup step should also write those values out to
   `/home/user/lifeweb/.env` (it is gitignored; never commit it).
2. **Railway CLI.** `npm i -g @railway/cli` — not preinstalled.
3. **The database is not reachable by default.** `DATABASE_URL` points at
   Railway's public TCP proxy on a non-443 port. Sandboxed sessions route
   egress through an HTTPS proxy that does not carry raw-TCP Postgres, so
   `prisma migrate`/seed scripts fail with `P1001` even though the URL is
   correct. Run DB commands from a machine with direct network access, or
   against a local throwaway Postgres.
4. **Next.js does not read the root `.env`.** It loads env from its own project
   root, so local `npm run dev:web` needs `web/.env` (a symlink to the root one
   is enough). Railway is unaffected — there the service supplies the vars.

## Notes for future work

- `web/CLAUDE.md` / `web/AGENTS.md` are generated and maintained by the Next.js tooling itself (regenerated by `next dev`) — they carry version-specific Next.js guidance and are separate from this file.
- The bot has no ESLint config yet; the web app's linting is scoped to `web/` only.
- No player-facing slash commands exist in the bot yet (`/effort`, `/move`, `/resource`, `/zone`, `/tag`, etc.) — only `/gm` and `/message` (GM-only, see above), the passive guild/role sync, audit logging, and character-proxying described elsewhere in this file.
- **Waiting for Opponents** is a `MoveReviewStatus` value the Moves table already colours, but nothing ever sets it — a GM parks an Opposed Move by simply not solving it yet. The Opposed tooltip in `MovePanel.js` is the only thing pointing at the workflow.
- The **Dev Character Panel** is still `/gm/dev/characters/[characterId]`, the plain character editor. `DevCharacterButton.js` (the hammer on both adjudication panels) points there, so replacing it with the comprehensive version — every field editable, plus kill / clear-status shortcuts — needs no change at the call sites.
- The **mid-game** tag store isn't routed yet. `PointBuy.js` already supports it (`afterStartOnly`) and `Character.tagPoints` already carries the balance; what's missing is a route that spends it and the rules for earning points during play (the old Desire system was ripped out).
