# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

This file is the **map and the cross-cutting rules only**. Every game system
has its own doc under `docs/systemdocs/` — see the table below.

## What Lifeweb is

Lifeweb is a huge, month-long asynchronous megagame set in a cryptic
low-fantasy, sci-fi mix.

It's half-strategy, half-roleplay, meant to run smoothly at large scale (100+
players ideally) with each in-game day mapping to one real-world day. A website
and a Discord bot work together to automate communication and mechanics so the
game stays asynchronous and low-friction.

There's two faces to the game: the Discord and the web app. For the web app,
priority is **functionality, usability, cleanliness, responsiveness, and browser
performance**. The explicit reference point to avoid is the typical slow, laggy
Discord bot dashboard — this needs to feel fast and scroll smoothly.

## Read the system doc first

**Before working on any system listed here, open its doc.** These are the
source of truth for their subsystem; this file deliberately does not restate
them. A two-sentence summary below is enough to decide *which* doc to open, and
never enough to change code with.

| Doc | Read this when… |
|---|---|
| [`ARCHITECTURE.md`](docs/systemdocs/ARCHITECTURE.md) | You're deciding where a new module goes, or touching anything that talks to Discord from both faces |
| [`COMMANDS.md`](docs/systemdocs/COMMANDS.md) | You're adding or changing a slash command, button, modal or reaction |
| [`TURN-ENGINE.md`](docs/systemdocs/TURN-ENGINE.md) | You're touching how a turn advances — hunger, default moves, weather, the side-effect thunk |
| [`SYNC.md`](docs/systemdocs/SYNC.md) | You're editing a YAML master or a sync script, or wondering what a sync deletes |
| [`CHANNELS.md`](docs/systemdocs/CHANNELS.md) | You're changing Discord channel layout, visibility, or the Dawn wipe |
| [`CHARACTERS.md`](docs/systemdocs/CHARACTERS.md) | You're touching creation, roles, names, the point economy, death, or launch gating |
| [`TAGS.md`](docs/systemdocs/TAGS.md) | You're touching the tag catalog, its gates, stacks, consuming, or equipment |
| [`REQUESTS.md`](docs/systemdocs/REQUESTS.md) | You're adding or changing anything a player does to their own sheet |
| [`ADJUDICATION.md`](docs/systemdocs/ADJUDICATION.md) | You're working on `/gm/turns` — the Moves or Requests tab |
| [`DEV-PANEL.md`](docs/systemdocs/DEV-PANEL.md) | You're touching `/gm/dev/characters/[characterId]`, the GM microactions, or `/gm/dev/tags` |
| [`MAP.md`](docs/systemdocs/MAP.md) | You're touching geography, travel cost, or the `/map` panel |
| [`PROXYING.md`](docs/systemdocs/PROXYING.md) | You're touching how a player's message becomes a character's — proxying, avatars, reactions, `/conceal`, mentions, nicknames, notes |
| [`FACTIONS.md`](docs/systemdocs/FACTIONS.md) | You're touching factions, the Silo, or Leader/Treasurer authority |
| [`PRODUCTION.md`](docs/systemdocs/PRODUCTION.md) | You're touching `/hunt` `/fish` `/farm` `/herd`, payouts, or resource shorthand |
| [`PARTY-SIZE.md`](docs/systemdocs/PARTY-SIZE.md) | You're touching the Cult of Bacchus's party goals or the `{partysize:N}` token |
| [`ARCHIVE.md`](docs/systemdocs/ARCHIVE.md) | You're touching the transcript or `/archive` |
| [`DOCUMENTS.md`](docs/systemdocs/DOCUMENTS.md) | You're touching `/documents` or `docs/documents.yaml` |
| [`INFOCHANNEL.md`](docs/systemdocs/INFOCHANNEL.md) | You're changing `#info` or `docs/systemdocs/infochannel.yaml` |
| [`PORTRAITS.md`](docs/systemdocs/PORTRAITS.md) | You're touching the portrait maker, avatar art, or `Character.avatarData` |
| [`DESIGN-SYSTEM.md`](docs/systemdocs/DESIGN-SYSTEM.md) | You're writing or restyling **any** web UI |
| [`CRT-TERMINAL.md`](docs/systemdocs/CRT-TERMINAL.md) | Someone suggests a terminal/CRT look — read before rebuilding it |

Non-systemdoc references: `docs/lore.md` (setting), `docs/threats.md`
(antagonist seats — briefs 6 while `db/lib/antagonists.js` ships 12 opt-in
entries).

## Repository layout

An npm-workspaces monorepo with three packages:

- `bot/` — the Discord bot (discord.js v14, holds a **gateway** connection).
  Entry point `bot/src/index.js`.
- `web/` — the web app (Next.js 16, App Router, JavaScript, Tailwind v4).
  **REST only.** Standard Next.js structure rooted at `web/app`.
- `db/` — shared data layer (`@lifeweb/db`). Prisma schema at
  `db/prisma/schema.prisma`, targeting PostgreSQL. Exports a singleton
  `PrismaClient` from `db/index.js` (`const { prisma } = require("@lifeweb/db")`)
  so the bot and web app read/write the same game state.

Anything both faces need belongs in `db/lib/`, not duplicated. Add the
dependency with `npm install @lifeweb/db --workspace=<bot|web>`.

Deployment target is Railway, deployed straight from this GitHub repo
(`peace-lock/lifeweb`) — `bot` and `web` run as two separate Railway services
from the same repo, both pointing at one Railway Postgres instance.

See `ARCHITECTURE.md` for the barrel rules, the REST/gateway twin convention,
the returned-side-effects pattern, rate-limit discipline, and why log tables
carry snapshot columns instead of foreign keys.

## Commands

Run from the repo root unless noted.

```
npm install                          # installs all workspaces (bot, web, db)

npm run dev:web                      # next dev, in web/
npm run dev:bot                      # node --watch src/index.js, in bot/

npm run db:generate                  # prisma generate
npm run db:migrate                   # prisma migrate dev (needs DATABASE_URL set)
npm run db:migrate:deploy            # prisma migrate deploy (production)

# YAML masters -> DB. Order matters; see SYNC.md.
npm run db:sync-locations            # docs/locations.yaml  (destructive)
npm run db:sync-tags                 # docs/tags.yaml       (upsert-only)
npm run db:sync-roles                # docs/roles.yaml      (prunes unreferenced)
npm run db:sync-documents            # docs/documents.yaml  (destructive; last)
npm run db:prune-tags                # deletes tags absent from docs/tags.yaml.
                                     #   DRY RUN unless given `-- --apply`; never
                                     #   touches a GM-created tag or one anything
                                     #   references. See SYNC.md.

npm run db:sync-narrowcast-channels  # one-off provisioning for #radio/#intercom
npm run db:rebuild-info-channel      # destructive rebuild of #info

npm run map:check                    # geometry check over locations.yaml's `map:`
                                     #   coordinates. No DB, no Discord.

# Repair / one-off scripts. See SYNC.md §4 for what each is for.
npm run db:backfill-roles
npm run db:backfill-name-parts
npm run db:backfill-member-access
npm run db:backfill-persistent-tag
npm run db:backfill-tag-rework
npm run db:backfill-medical-expert    # after db:sync-tags; retires medical-excellent
npm run db:backfill-gm-permissions
npm run db:backfill-spectator-access
npm run db:backfill-tupper-attachment-restriction
npm run db:prune-orphan-categories

npm run build --workspace=web        # production build of the web app
npm run lint --workspace=web         # eslint over the web app
npm run audit:contrast --workspace=web   # AA gate over globals.css themes
npm run assets:letters --workspace=web   # regenerate default letter-plaque avatars
```

Environment variables (see `.env.example`): `DATABASE_URL`, `DISCORD_TOKEN`,
`DISCORD_GUILD_ID`, `DISCORD_GM_ROLE_ID`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `AUTH_SECRET`. The player and spectator role IDs are
**not** env vars — they're hardcoded in `db/lib/roleIds.js` (see "Discord
permission model" below). Neither package has test infrastructure set up yet.

## How the bot populates the database

On `ready`, the bot upserts a `GameConfig` singleton row and runs its
reconnect-time catch-up passes. `guildMemberAdd` writes a `member_joined`
`AuditLog` entry.

Two **privileged intents** must be enabled for the bot application in the
Discord Developer Portal (Bot → Privileged Gateway Intents) or the bot fails to
log in or silently sees nothing:

- **Server Members** (`GuildMembers`) — nickname sync, member events.
- **Message Content** (`MESSAGE_CONTENT`) — the whole proxy pipeline.

## Web app auth

Auth.js (`next-auth@5`, `web/lib/auth.js`) with the Discord provider.
`session.discordUserId` is the Discord user ID, attached via the `jwt`/`session`
callbacks. `Character` rows are looked up by `discordUserId`, not by a separate
user table.

**The app signs in on any host it is served from — leave `AUTH_URL` unset.**
Behind Railway's proxy Next.js builds `request.url` from the container's own
listener (`https://localhost:8080`) and ignores the Host header, while
`x-forwarded-host` and `host` both carry the real domain. That only breaks
one path: the `signIn()`/`signOut()` server actions go through `@auth/core`
`createActionURL`, which already reads `x-forwarded-host`, but the
`/api/auth/*` route handler derives its origin from the request URL — and
the OAuth `redirect_uri` is built there. `web/lib/auth.js` therefore wraps
`handlers` and rebuilds the origin from the forwarded headers before Auth.js
sees the request.

Hosts are **allowlisted** in that file, not trusted: an origin taken from a
client-controllable header is an open-redirect vector in an OAuth flow.
Anything unrecognised falls back to the canonical origin. **Adding a domain
means adding it to `ALLOWED_HOSTS` *and* registering
`<host>/api/auth/callback/discord` in the Discord Developer Portal** — the
full callback path, never the site root, since Discord matches it exactly.

Setting `AUTH_URL` overrides all of this and re-pins every redirect to one
host, which is the emergency rollback (`railway variable set
AUTH_URL=https://ravenheart.quest --service web`) and nothing else. Note a
`railway variable delete` does **not** reliably trigger a redeploy, so the
env change may need `railway redeploy -s web --from-source -y` to bind.

GM-only pages (`web/app/gm`) check the signed-in user's guild roles via
`web/lib/discordGuild.js`, which calls the Discord REST API with the bot token
against `DISCORD_GUILD_ID`/`DISCORD_GM_ROLE_ID` — rather than trusting anything
from the OAuth profile itself.

**A server action is a public endpoint.** Every one of them re-validates
everything the client sent, resolves the acting character from the session
rather than a posted id, and re-checks any gate the UI already applied. A
disabled input or a hidden button is a hint, never the lock.

## Discord permission model

There is no single unified permission system — a few independent kinds of
Discord role drive access, each synced from a different piece of state, plus one
env-configured admin role. `Faction` is **not** one of them (`FACTIONS.md` §1).

| Role | Source | What it gates |
|---|---|---|
| **Personal character role** | `Character.discordRoleId`, one per `ALIVE` character, titled after the **bare** name | A mentionable **name token only** (`PROXYING.md` §6) — held by nobody and granting nothing. Channel access is a per-member overwrite instead (`CHANNELS.md` §3). |
| **GM role** | `DISCORD_GM_ROLE_ID` env var | `/gm` pages, the `/gm` and `/message` slash commands. Checked via REST (`isGm`), not stored on any model. |
| **Spectator role** | `SPECTATOR_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | A standing read-only observer seat, applied at provisioning time. See `CHANNELS.md`. |
| **Player role** | `PLAYER_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Who may create a character, paired with `GameConfig.openToPlayers` (`CHARACTERS.md` §4b). |
| **Cursed role** | `DISCORD_CURSED_ROLE_ID` env var | What a player may re-roll as after a death (`CHARACTERS.md` §4). |
| **Turn-ping role** | `DISCORD_TURN_PING_ROLE_ID` env var | Plain opt-in notification, toggled from `/character`. |

**Why two role IDs live in code rather than the environment:** a role ID is not
a secret (anyone in the guild can read it) and Lifeweb is single-guild, so there
is exactly one correct value that can never differ per environment — while a
missing env var would have meant a deploy where the player gate silently locked
everyone out, or the spectator overwrite silently did nothing. Same reasoning as
`web/lib/superadmin.js`. `DISCORD_TOKEN` is a real credential, so it stays in
`.env`.

## Slash commands

Full reference in [`COMMANDS.md`](docs/systemdocs/COMMANDS.md) — read it before
adding or changing one. The three things that bite:

- **Registration is global**, not per-guild (`client.application.commands.set`
  in `bot/src/events/ready.js`). A guild command can never appear in the bot's
  DMs, whatever contexts it declares, and `/move` `/location` `/message`
  `/labor` are meant to work there. The cost is real: a new or renamed command
  takes **up to an hour** to propagate. `set` is a full replace, so removing
  one needs no deregistration step.
- **Contexts, not `setDMPermission`.** Anything needing a channel or thread to
  act on (`/gm`, `/dm`, `/add`, `/remove`, `/persistent`, `/heal`) declares
  `Guild` only, so it never appears in a DM picker it could only refuse from.
- **`interaction.guild` and `interaction.member` are null in a DM.** No player
  handler may reach for them directly — go through
  `bot/src/lib/interactionGuild.js#resolveActingMember`, and use `isGmMember`
  from the same module for the GM gate.

Player-facing work happens in **modals**, not messages typed into a channel:
Discord shows a typing indicator under the player's *real* account, and a
modal never does. The three entry points are buttons on one anchor message in
`#turns` (`bot/src/lib/turnsConsole.js`), each with a slash-command twin.

## Direct message logging

Every DM the bot or web app sends or receives is logged to `DirectMessage`
(`discordUserId`, `direction: INBOUND|OUTBOUND`, `content`) so `/gm/messages`
can show a full per-player conversation with a reply box.

There are **three `sendDm` functions with three signatures**, one per calling
context. Never send a DM by any other route, or it goes unlogged:

| Context | Function | Signature |
|---|---|---|
| Bot, gateway | `bot/src/lib/dm.js` | `sendDm(user, payload)` |
| Web, REST | `web/lib/discordGuild.js` | `sendDm(discordUserId, content)` |
| `db/`, REST | `db/lib/dm.js` | `sendDm(prisma, discordUserId, content)` |

The `db/` one takes `prisma` as a parameter (requiring `db/index.js` back would
resolve to a partial exports object) and is deliberately **not** spread into the
`@lifeweb/db` barrel — three same-named exports would invite grabbing the wrong
one. Require it by path.

Inbound DMs are logged directly in `bot/src/events/messageCreate.js`.

## Bot message style ("aura")

Bot-authored Discord text should feel understated, not like a typical bot
dashboard: no big colorful emoji, small unicode marks only.

Discord's `-#` subtext is part of the vocabulary too, for a line of guidance
that shouldn't compete with the message itself — the Move-declaration DM uses
it to explain Routine/Gambit/Opposed under the dropdowns. Sparingly: it is for
explaining a control, not for footnoting prose.

Lines that quote or restate player/character content are prefixed with `»` —
e.g. `» {move description}`. `web/lib/discordGuild.js#sendDm` applies that
prefix **automatically** to every DM a GM sends a player, so those callers pass
raw text. Bot-composed DMs write the `»` inline at the call site instead, since
they're paired with other formatting (zone, dice roll) that doesn't come through
`sendDm`.

## Resources glyph (`⬢`)

`⬢` is the canonical Resources glyph, and it **stands in for the word rather
than sitting next to it** — everywhere text is written: the YAML masters, bot/DM
strings, and the web UI alike.

- Prose naming Resources (or the Silo) **as a concept** takes the plain word and
  no glyph: "you are only limited by your Resources".
- Wherever a **quantity** is shown, drop the word and write `{number} ⬢`:
  `0–4 ⬢`, `3 ⬢`, `+5 ⬢`, `30 ⬢ flat`. Never `3 Resources ⬢`.
- In the UI the label carries the word and the value carries the glyph —
  `<th>Resources</th>` over cells reading `12 ⬢` — never the reverse. A number
  `<input>` just gets a plain label.

Two carve-outs. A `{resource:…}` bubble already renders its own glyph via
`ResourceChip.js`, so never write one after it — while `PartySizeChip.js`
carries **no** glyph for the mirror-image reason: a party threshold is a count
of people, not a currency. And literal syntax a player is
meant to *type* (`+3`, `5-12`, `/hunt`) is quoted as-is.
`docs/systemdocs/infochannel.yaml`'s glossary line is deliberately the one place
the glyph is introduced to players.

## Confirm dialog

For any "are you sure?" moment in the web app, use the shared confirm dialog
instead of rolling a one-off modal or `window.confirm`.
`web/app/components/ConfirmProvider.js` mounts once in `web/app/layout.js` and
exposes `useConfirm()`, a promise-based hook:

```js
const confirm = useConfirm();
if (!(await confirm({ title, message, confirmLabel, cancelLabel }))) return;
```

All fields are optional, and it reuses the existing `.modal-overlay` /
`.modal-panel` styling. For a confirm that needs a typed reason plus arbitrary
JSX, use `RequestDialog.js` instead (`REQUESTS.md`).

## Web UI conventions

Full detail in [`DESIGN-SYSTEM.md`](docs/systemdocs/DESIGN-SYSTEM.md) — read it
before writing any UI. The four rules that apply everywhere:

- **Never hardcode a hex/rgb colour.** Always `var(--x)`, so it tracks the
  active theme. There are currently zero hardcoded colours app-wide; keep it
  that way, and run `npm run audit:contrast --workspace=web` after touching one.
- **Use the shared components, not hand-rolled markup.** `PageShell` +
  `PageHeader` for every top-level page, `DataTable`/`useTableState` + `Pager`
  for every long list, `.panel` / `.btn` / `.field` / `.chip` for everything
  else. A bare `<select>` outside `.field` visibly breaks the theme.
- **`--font-mono` is data only** (numbers, IDs, timestamps) via `.mono`.
  Headings get their serif automatically from the tag — never hand-apply a font
  class. `--font-display` (blackletter) is for a handful of thematic moments.
- **`react-hooks/set-state-in-effect` and `react-hooks/immutability` are errors
  in this repo.** Reset paging inside the setter, not an effect; read
  `localStorage` through `useSyncExternalStore`, not an effect.

## Git workflow

**Lifeweb is master-only. There are no branches and no pull requests.** All work
is committed straight to `master` and pushed as soon as it's finished, so it can
be pulled locally the moment it's done — that immediacy is the whole point, and
a feature branch defeats it. Railway builds from `master` too, so work sitting
on a branch is work that hasn't shipped.

```
npm run push -- "Commit message"   # git add -A, commit, git push -u origin master
npm run push                       # same, with a "wip" message
```

Never `git checkout -b`, never open a PR, never ask which branch to use. A
remote session handed a throwaway `claude/<slug>` branch abandons it for
`master` — `.claude/hooks/session-start.sh` (a `SessionStart` hook) does that
automatically, and in the same pass deletes any `origin/claude/*` branch holding
nothing `master` doesn't already have. It refuses to move off a branch carrying
uncommitted changes or unmerged commits, and never deletes an unmerged branch,
so it can't lose work; it just prints what it skipped.

That hook also **fetches**, which matters more than it sounds: a remote
container clones once at session start and then goes stale, so without it a
session can spend an hour editing files that `master` moved past hours ago.

**Pushing to `master` is a deploy.** Read the next section before pushing
anything carrying a schema change.

## Deploy workflow

Unless the user says otherwise, after finishing a set of changes:
`npm run deploy` from the repo root.

```
npm run deploy      # git push origin master, ./migrate.sh, redeploy web + bot
npm run redeploy    # just the redeploy, no push, no migration
```

`./migrate.sh` sits deliberately **between** the push and the redeploy.
Migrating first means additive columns simply go unused for a few seconds;
redeploying first ships code whose queries reference columns that don't exist
yet, for the whole length of a build.

**Migrations do not run themselves, and a bare `git push` is enough to deploy.**
Railway builds from this GitHub repo, so pushing to `master` triggers a deploy
with no chance for any script in this repo to migrate first. A deploy carrying a
new migration then ships code whose Prisma queries reference columns the
database doesn't have. The symptom is brutal to diagnose from the browser: the
page throws `P2022` server-side and Next redacts it to a bare digest
(`ERROR 330354103`), taking out the whole route rather than just the feature
that needed the column. **This has happened three times.**

The only complete fix is a **Pre-Deploy Command on the `web` service** (Railway
dashboard → web → Settings → Deploy):

```
npm run db:migrate:deploy
```

It runs after the build and before the new version takes traffic, so a failed
migration aborts the deploy instead of shipping a half-migrated app. Scoped to
`web` deliberately — `bot` shares the database and would only race it. Not a
root `railway.json`, which would apply to both services.

Until that field is set, run `npm run db:migrate:deploy` by hand after any
deploy that adds a migration (`db:migrate` is `migrate dev` — **never** point
that at production). `./migrate.sh` is the one-liner: it sources the root `.env`
first, since npm won't load the file for you.

Two more things that bite:

- **`--from-source` is load-bearing.** A plain `railway redeploy` re-runs the
  *existing* deployment — the same commit. Both scripts already pass it.
- **A `RAILWAY_TOKEN` must be in the environment.** A *project* token (Railway
  dashboard → the project → Settings → Tokens), not an account token; it needs
  no `railway link`. Without it the CLI fails unauthenticated and nothing
  deploys.

The service names in the scripts (`web`, `bot`) must match the Railway project's.

## Cloud session setup (Claude Code on the web, and similar)

A fresh remote container clones the repo and nothing else — no `.env`, no global
CLIs. To make one able to build, run and deploy:

1. **Secrets.** Set every key from `.env.example` as an environment variable,
   plus `RAILWAY_TOKEN`. The bot and the Prisma CLI read a root `.env` file, so
   a setup step should also write those values to `/home/user/lifeweb/.env` (it
   is gitignored; never commit it).
2. **Railway CLI.** `npm i -g @railway/cli` — not preinstalled.
3. **The database is not reachable by default.** `DATABASE_URL` points at
   Railway's public TCP proxy on a non-443 port. Sandboxed sessions route egress
   through an HTTPS proxy that does not carry raw-TCP Postgres, so
   `prisma migrate`/seed scripts fail with `P1001` even though the URL is
   correct. Run DB commands from a machine with direct network access, or
   against a local throwaway Postgres.
4. **Next.js does not read the root `.env`.** It loads env from its own project
   root, so local `npm run dev:web` needs `web/.env` (a symlink is enough).
   Railway is unaffected — there the service supplies the vars.

## Notes for future work

- `web/CLAUDE.md` / `web/AGENTS.md` are generated and maintained by the Next.js
  tooling itself (regenerated by `next dev`) — they carry version-specific
  Next.js guidance and are separate from this file.
- The bot has no ESLint config yet; the web app's linting is scoped to `web/`.
- **Waiting for Opponents** is a `MoveReviewStatus` value the Moves table
  already colours, but nothing ever sets it — a GM parks an Opposed Move by
  simply not solving it yet.
- The **mid-game tag store isn't routed yet.** `PointBuy.js` already supports it
  (`afterStartOnly`) and `Character.tagPoints` carries the balance; what's
  missing is a route that spends it and the rules for earning points during play.
