# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## How to write and talk

Apply ASD-STE100 principles to all responses.

* Keep each response concise, complete, and easy to understand.
* Remove information that does not help the user.
* Let the completed work show the result.
* Format according to the user's needs.
* Include all necessary context in your response.

Or... really, what I mean, is just write like a freaking human! Explain things
simply, just kind of... relax. Don't write these super jargon-y things.

## What this file is

This file is the map, plus the rules that apply everywhere. Each game system
has its own doc under `docs/systemdocs/` — see the table below. This file
does not repeat what those docs say.

## What Bascinet is

Bascinet is a big, month-long asynchronous megagame. The setting is a cryptic
mix of low fantasy and sci-fi.

It's half strategy, half roleplay. It's built to run smoothly with 100+
players, where each in-game day is one real-world day. A website and a Discord
bot automate the communication and the mechanics, so the game stays
asynchronous and low-friction.

The game has two faces: the Discord and the web app. For the web app, the
priorities are functionality, usability, cleanliness, responsiveness, and
browser performance. The thing to avoid is the typical slow, laggy Discord bot
dashboard. This one needs to feel fast and scroll smoothly.

### Bascinet is the project; the Lifeweb is a thing inside it

The Lifeweb is the Tower that keeps Ravenheart alive, fed by its people's
blood (`docs/lore.md`). The game used to be *called* Lifeweb before it was
retitled. So the name still shows up all over the codebase, and it looks like
an unfinished rename. It isn't. **A `grep -i lifeweb` hit is not a bug.**
Leave all of these alone:

- The in-fiction Tower: the `/lifeweb` route, `Lifeweb*.js` components,
  `LifewebIcon`, `db/lib/lifeweb.js`, `LIFEWEB_SPUTTER_THRESHOLD`, and the
  `lifewebBlood` / `lifewebDecayPerTurn` / `ArchiveKind.LIFEWEB` schema fields.
- The npm scope, frozen on purpose: `@lifeweb/db` and `@lifeweb/bot`, plus the
  Railway service name `@lifeweb/bot` in the root `redeploy` script.
- The local checkout directory, unchanged on purpose: `lifeweb`. (The
  GitHub repo itself was renamed to `peace-lock/helmetmegagame` and made
  private once players found it.)
- The three Prisma migration directories with `lifeweb` in their names. Those
  names are checksummed rows in `_prisma_migrations`, so renaming them breaks
  Prisma.

## Read the system doc first

**Before you work on any system in this table, open its doc.** Each doc is
the source of truth for its system. The summaries below only exist to help
you pick the right doc — they are never enough to change code with.

| Doc | Read this when… |
|---|---|
| [`ARCHITECTURE.md`](docs/systemdocs/ARCHITECTURE.md) | You're deciding where a new module goes, or touching anything that talks to Discord from both faces |
| [`COMMANDS.md`](docs/systemdocs/COMMANDS.md) | You're adding or changing a slash command, button, modal or reaction |
| [`TURN-ENGINE.md`](docs/systemdocs/TURN-ENGINE.md) | You're touching how a turn advances — hunger, default moves, weather, the side-effect thunk |
| [`LAUNCH.md`](docs/systemdocs/LAUNCH.md) | You're opening a game or running a Restart Game wipe — the order that keeps players from being locked out |
| [`SYNC.md`](docs/systemdocs/SYNC.md) | You're editing a YAML master or a sync script, or wondering what a sync deletes |
| [`CHANNELS.md`](docs/systemdocs/CHANNELS.md) | You're changing Discord channel layout, visibility, or the Dawn wipe |
| [`CHARACTERS.md`](docs/systemdocs/CHARACTERS.md) | You're touching creation, roles, names, the point economy, death, or launch gating |
| [`TAGS.md`](docs/systemdocs/TAGS.md) | You're touching the tag catalog, **pricing or rebalancing a tag** (§4a is the canonical point scale), **pricing an injury or adding a health tag** (§5c is the canonical cure ladder), its gates, stacks, consuming, or equipment |
| [`SMITHING.md`](docs/systemdocs/SMITHING.md) | You're pricing a weapon or armor, changing the crafting ladder, or touching the Smithing / Crafting / Fighting skill families |
| [`BREWING.md`](docs/systemdocs/BREWING.md) | You're pricing a brew, changing a recipe, or touching the Brewing skill family |
| [`REQUESTS.md`](docs/systemdocs/REQUESTS.md) | You're adding or changing anything a player does to their own sheet |
| [`ADJUDICATION.md`](docs/systemdocs/ADJUDICATION.md) | You're working on `/gm/turns` — the arbitration workspace, staging, or the turn-end push |
| [`DEV-PANEL.md`](docs/systemdocs/DEV-PANEL.md) | You're touching `/gm/dev/characters/[characterId]`, the GM microactions, or `/gm/dev/tags` |
| [`MAP.md`](docs/systemdocs/MAP.md) | You're touching geography, travel cost, or the `/map` panel |
| [`PROXYING.md`](docs/systemdocs/PROXYING.md) | You're touching how a player's message becomes a character's — proxying, avatars, reactions, `/conceal`, mentions, nicknames, notes |
| [`FACTIONS.md`](docs/systemdocs/FACTIONS.md) | You're touching factions, the Silo, or Leader/Treasurer authority |
| [`GAMEMASTERS.md`](docs/systemdocs/GAMEMASTERS.md) | You're touching the zone colour code, a GM's zone seat, `/gm/gamemasters`, or who can see the audit log |
| [`PRODUCTION.md`](docs/systemdocs/PRODUCTION.md) | You're touching `/hunt` `/fish` `/farm` `/herd`, payouts, or resource shorthand |
| [`PARTY-SIZE.md`](docs/systemdocs/PARTY-SIZE.md) | You're touching the Cult of Bacchus's party goals or the `{partysize:N}` token |
| [`ARCHIVE.md`](docs/systemdocs/ARCHIVE.md) | You're touching the transcript or `/archive` |
| [`DOCUMENTS.md`](docs/systemdocs/DOCUMENTS.md) | You're touching `/documents` or `docs/documents.yaml` |
| [`INFOCHANNEL.md`](docs/systemdocs/INFOCHANNEL.md) | You're changing `#info` or `docs/systemdocs/infochannel.yaml` |
| [`PORTRAITS.md`](docs/systemdocs/PORTRAITS.md) | You're touching the portrait maker, avatar art, or `Character.avatarData` |
| [`DESIGN-SYSTEM.md`](docs/systemdocs/DESIGN-SYSTEM.md) | You're writing or restyling **any** web UI |
| [`CRT-TERMINAL.md`](docs/systemdocs/CRT-TERMINAL.md) | Someone suggests a terminal/CRT look — read before rebuilding it |

Other reference docs, outside `systemdocs/`:

- `docs/lore.md` — the setting.
- `docs/threats.md` — the antagonist seats. It briefs 6 of them, while
  `db/lib/antagonists.js` ships 12 opt-in entries.
- `docs/tag-design.md` — the player-facing version of the tag point scale and
  the YAML format. `TAGS.md` §4a is the one that governs; keep the two in step.

## Repository layout

This is an npm-workspaces monorepo with three packages:

- `bot/` — the Discord bot (discord.js v14). It holds a **gateway**
  connection. Entry point: `bot/src/index.js`.
- `web/` — the web app (Next.js 16, App Router, JavaScript, Tailwind v4).
  It talks to Discord over **REST only**. Standard Next.js structure, rooted
  at `web/app`.
- `db/` — the shared data layer (`@lifeweb/db`). The Prisma schema is at
  `db/prisma/schema.prisma` and targets PostgreSQL. `db/index.js` exports a
  singleton `PrismaClient` (`const { prisma } = require("@lifeweb/db")`), so
  the bot and the web app read and write the same game state.

If both faces need something, put it in `db/lib/` — don't write it twice.
Add the dependency with `npm install @lifeweb/db --workspace=<bot|web>`.

Deployment is on Railway, built straight from this GitHub repo
(`peace-lock/helmetmegagame`). `bot` and `web` run as two separate Railway services
from the same repo, and both point at one Railway Postgres instance.

See `ARCHITECTURE.md` for the barrel rules, the REST/gateway twin convention,
the returned-side-effects pattern, rate-limit discipline, and why log tables
store snapshot columns instead of foreign keys.

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

npm run db:sync-narrowcast-channels  # one-off provisioning for the radio
                                     #   category and its #watch/#intercom channels
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
npm run db:backfill-cursed-access      # ghost seat: opens every non-Depths
                                       #   Location (category + all 3 channels)
                                       #   and #watch/#intercom to the Cursed
                                       #   role, and strips it from the Depths.
npm run db:backfill-tupper-attachment-restriction
npm run db:prune-orphan-categories
npm run db:prune-orphan-roles          # deletes Discord character roles no living
                                       #   character claims. DRY RUN unless given
                                       #   `-- --apply`. Only touches roles carrying
                                       #   the character-role signature (mentionable
                                       #   + hashNameToColor colour), so divider and
                                       #   GM cosmetic roles are never candidates.
                                       #   Guards the 250-role guild cap.

npm run build --workspace=web        # production build of the web app
npm run lint --workspace=web         # eslint over the web app
npm run audit:contrast --workspace=web   # AA gate over globals.css themes
npm run assets:letters --workspace=web   # regenerate default letter-plaque avatars
```

Environment variables (see `.env.example`): `DATABASE_URL`, `DISCORD_TOKEN`,
`DISCORD_GUILD_ID`, `DISCORD_GM_ROLE_ID`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET`, `AUTH_SECRET`.

The player and spectator role IDs are **not** env vars. They're hardcoded in
`db/lib/roleIds.js` — see "Discord permission model" below for why.

Neither package has any test setup yet.

## How the bot populates the database

On `ready`, the bot upserts a `GameConfig` singleton row and runs its
catch-up passes for anything it missed while disconnected. `guildMemberAdd`
writes a `member_joined` `AuditLog` entry.

Two **privileged intents** must be turned on for the bot in the Discord
Developer Portal (Bot → Privileged Gateway Intents). Without them, the bot
either fails to log in or silently sees nothing:

- **Server Members** (`GuildMembers`) — needed for nickname sync and member
  events.
- **Message Content** (`MESSAGE_CONTENT`) — needed for the whole proxy
  pipeline.

## Web app auth

Auth is Auth.js (`next-auth@5`, `web/lib/auth.js`) with the Discord provider.
`session.discordUserId` holds the Discord user ID, attached in the
`jwt`/`session` callbacks. `Character` rows are looked up by `discordUserId`.
There is no separate user table.

**Leave `AUTH_URL` unset. The app signs in on any host it is served from.**
Here's the problem it solves: behind Railway's proxy, Next.js builds
`request.url` from the container's own listener (`https://localhost:8080`)
and ignores the Host header. The real domain is in `x-forwarded-host` and
`host`. This only breaks one path. The `signIn()`/`signOut()` server actions
are fine, because `@auth/core`'s `createActionURL` already reads
`x-forwarded-host`. But the `/api/auth/*` route handler gets its origin from
the request URL — and that's where the OAuth `redirect_uri` is built. So
`web/lib/auth.js` wraps `handlers` and rebuilds the origin from the forwarded
headers before Auth.js sees the request.

The hosts in that file are an **allowlist**, not just accepted as-is. An
origin taken from a client-controllable header would be an open-redirect hole
in an OAuth flow. Any host it doesn't recognize falls back to the canonical
origin. **To add a domain, do two things:** add it to `ALLOWED_HOSTS`, and
register `<host>/api/auth/callback/discord` in the Discord Developer Portal.
Register the full callback path, not the site root — Discord matches it
exactly.

Setting `AUTH_URL` overrides all of this and pins every redirect to one host.
That is the emergency rollback (`railway variable set
AUTH_URL=https://ravenheart.quest --service web`) and nothing else. One
gotcha: `railway variable delete` does not reliably trigger a redeploy, so
you may need `railway redeploy -s web --from-source -y` to make the change
take effect.

GM-only pages (`web/app/gm`) check the signed-in user's guild roles through
`web/lib/discordGuild.js`. That calls the Discord REST API with the bot token
against `DISCORD_GUILD_ID`/`DISCORD_GM_ROLE_ID`. It does not trust anything
from the OAuth profile itself.

**A server action is a public endpoint.** Every one of them re-validates
everything the client sent, resolves the acting character from the session
(never from a posted id), and re-checks any gate the UI already applied. A
disabled input or a hidden button is a hint, not a lock.

## Discord permission model

There is no single unified permission system. A few independent kinds of
Discord role each control one thing, each synced from a different piece of
state, plus one env-configured admin role. `Faction` is **not** one of them
(`FACTIONS.md` §1).

| Role | Source | What it gates |
|---|---|---|
| **Personal character role** | `Character.discordRoleId`, one per `ALIVE` character, titled after the **bare** name | A mentionable **name token only** (`PROXYING.md` §6) — held by nobody and granting nothing. Channel access is a per-member overwrite instead (`CHANNELS.md` §3). |
| **GM role** | `DISCORD_GM_ROLE_ID` env var | `/gm` pages, the `/gm` and `/message` slash commands. Checked via REST (`isGm`), not stored on any model. |
| **Spectator role** | `SPECTATOR_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | A standing read-only observer seat, applied at provisioning time. See `CHANNELS.md`. |
| **Player role** | `PLAYER_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Who may create a character, paired with `GameConfig.openToPlayers` (`CHARACTERS.md` §4b). |
| **Leader Whitelist role** | `LEADER_WHITELIST_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Who may pick a role flagged `leader: true` at character creation — unless `GameConfig.leaderWhitelistEnabled` is switched off on `/gm/dev` (`CHARACTERS.md` §2). |
| **Cursed role** | `DISCORD_CURSED_ROLE_ID` env var | What a player may re-roll as after a death (`CHARACTERS.md` §4), **and** the ghost seat: read-only view of every Location except the Depths, plus the 🌬️ whisper (`CHANNELS.md` §3, `COMMANDS.md` §6). |
| **Turn-ping role** | `DISCORD_TURN_PING_ROLE_ID` env var | Plain opt-in notification, toggled from `/character`. |

One more gate exists that is **not** a Discord role, and it's the only soft
one in the app. `GmAssignment` (keyed on `discordUserId`, set from
`/gm/gamemasters`) seats each of the four zone-GMs in a Zone. All it does is
decide which zone that GM's tables *open* on. No query is scoped by it, and
no row is hidden — an Opposed Move crosses zones by nature, so hiding rows
would break the job. Every other row in the table above is real enforcement;
this one is just convenience. Read
[`GAMEMASTERS.md`](docs/systemdocs/GAMEMASTERS.md) before you try to harden
it.

`/gm/audit` and `/gm/gamemasters` are **superadmin-only**, not GM-visible.
With five GMs, the audit log is a record *of* them, not a tool *for* them.

**Why two role IDs live in code instead of env vars:** a role ID is not a
secret — anyone in the guild can read it. Bascinet runs in a single guild, so
there is exactly one correct value, and it can never differ per environment.
Meanwhile, a missing env var would have failed silently: a deploy where the
player gate locked everyone out, or the spectator overwrite did nothing.
`web/lib/superadmin.js` uses the same reasoning. `DISCORD_TOKEN` is a real
credential, so it stays in `.env`.

## Slash commands

The full reference is [`COMMANDS.md`](docs/systemdocs/COMMANDS.md) — read it
before adding or changing a command. Three things cause real problems:

- **Registration is global**, not per-guild
  (`client.application.commands.set` in `bot/src/events/ready.js`). A guild
  command can never appear in the bot's DMs, no matter what contexts it
  declares — and `/move` `/location` `/message` `/labor` need to work there.
  The cost of global registration is real: a new or renamed command takes
  **up to an hour** to show up. `set` fully replaces the list, so removing a
  command needs no separate deregistration step.
- **Use contexts, not `setDMPermission`.** Any command that needs a channel
  or thread to act on (`/gm`, `/dm`, `/add`, `/remove`, `/persistent`,
  `/heal`) declares `Guild` only. That way it never shows up in a DM picker
  where it could only refuse to run.
- **`interaction.guild` and `interaction.member` are null in a DM.** No
  player handler may use them directly. Go through
  `bot/src/lib/interactionGuild.js#resolveActingMember`, and use `isGmMember`
  from the same module for the GM gate.

**Acknowledge before you work.** Discord gives the bot three seconds to
acknowledge an interaction, and every handler that touches the database calls
`ack()` from `bot/src/lib/respond.js` as its first statement, then answers with
`respond()` instead of `interaction.reply` — which also clamps the reply to
2000 characters. Doing the work first means a slow turn-open shows the player
"The application did not respond" for something that already committed, and
retrying tells them they have already acted. The exception is a handler that
opens a modal: `showModal` **is** the acknowledgement, and a deferred
interaction can no longer open one.

Player-facing work happens in **modals**, not in messages typed into a
channel. The reason: typing in a channel shows a typing indicator under the
player's *real* account, and a modal never does. The three entry points are
buttons on one anchor message in `#turns` (`bot/src/lib/turnsConsole.js`),
and each button has a slash-command twin.

## Direct message logging

Every DM the bot or web app sends or receives is logged to `DirectMessage`
(`discordUserId`, `direction: INBOUND|OUTBOUND`, `content`). That's what lets
`/gm/messages` show a full per-player conversation with a reply box.

There are **three `sendDm` functions with three signatures**, one per calling
context. Never send a DM any other way, or it goes unlogged:

| Context | Function | Signature |
|---|---|---|
| Bot, gateway | `bot/src/lib/dm.js` | `sendDm(user, payload)` |
| Web, REST | `web/lib/discordGuild.js` | `sendDm(discordUserId, content)` |
| `db/`, REST | `db/lib/dm.js` | `sendDm(prisma, discordUserId, content)` |

The `db/` one takes `prisma` as a parameter, because requiring `db/index.js`
back from inside `db/lib/` would resolve to a partial exports object. It is
deliberately **not** exported from the `@lifeweb/db` barrel — three exports
with the same name would make it easy to grab the wrong one. Require it by
path.

Inbound DMs are logged directly in `bot/src/events/messageCreate.js`.

## Bot message style ("aura")

Bot-authored Discord text should feel understated, not like a typical bot
dashboard. No big colorful emoji — small unicode marks only.

Discord's `-#` subtext is part of the vocabulary too. Use it for a line of
guidance that shouldn't compete with the message itself — the
Move-declaration DM uses it to explain Routine/Gambit/Opposed under the
dropdowns. Use it sparingly: it's for explaining a control, not for
footnoting prose.

Lines that quote or restate player/character content get a `»` prefix — e.g.
`» {move description}`. `web/lib/discordGuild.js#sendDm` adds that prefix
**automatically** to every DM a GM sends a player, so those callers pass raw
text. Bot-composed DMs write the `»` at the call site instead, because
they're mixed with other formatting (zone, dice roll) that doesn't go through
`sendDm`.

## Resources glyph (`⬢`)

`⬢` is the Resources glyph. It **replaces the word — it never sits next to
it**. This applies everywhere text is written: the YAML masters, bot/DM
strings, and the web UI.

- Prose that names Resources (or the Silo) **as a concept** uses the plain
  word and no glyph: "you are only limited by your Resources".
- Anywhere a **quantity** is shown, drop the word and write `{number} ⬢`:
  `0–4 ⬢`, `3 ⬢`, `+5 ⬢`, `30 ⬢ flat`. Never `3 Resources ⬢`.
- In the UI, the label carries the word and the value carries the glyph —
  `<th>Resources</th>` over cells reading `12 ⬢` — never the other way
  around. A number `<input>` just gets a plain label.

Two exceptions. A `{resource:…}` bubble already renders its own glyph via
`ResourceChip.js`, so never write a glyph after one. `PartySizeChip.js` is
the opposite case and carries **no** glyph, because a party threshold is a
count of people, not a currency. Also, literal syntax a player is meant to
*type* (`+3`, `5-12`, `/hunt`) is quoted as-is. The glossary line in
`docs/systemdocs/infochannel.yaml` is, on purpose, the one place the glyph is
introduced to players.

## Confirm dialog

For any "are you sure?" moment in the web app, use the shared confirm dialog.
Don't roll a one-off modal or `window.confirm`.
`web/app/components/ConfirmProvider.js` mounts once in `web/app/layout.js`
and exposes `useConfirm()`, a promise-based hook:

```js
const confirm = useConfirm();
if (!(await confirm({ title, message, confirmLabel, cancelLabel }))) return;
```

All fields are optional, and it reuses the existing `.modal-overlay` /
`.modal-panel` styling. If the confirm needs a typed reason plus arbitrary
JSX, use `RequestDialog.js` instead (`REQUESTS.md`).

## Web UI conventions

Full detail in [`DESIGN-SYSTEM.md`](docs/systemdocs/DESIGN-SYSTEM.md) — read
it before writing any UI. Four rules apply everywhere:

- **Never hardcode a hex/rgb colour.** Always use `var(--x)`, so the colour
  follows the active theme. There are currently zero hardcoded colours in the
  whole app; keep it that way. Run `npm run audit:contrast --workspace=web`
  after touching a colour.
- **Use the shared components, not hand-rolled markup.** `PageShell` +
  `PageHeader` for every top-level page, `DataTable`/`useTableState` +
  `Pager` for every long list, `.panel` / `.btn` / `.field` / `.chip` for
  everything else. A bare `<select>` outside `.field` visibly breaks the
  theme.
- **`--font-mono` is for data only** (numbers, IDs, timestamps), applied with
  `.mono`. Headings get their serif automatically from the tag — never
  hand-apply a font class. `--font-display` (blackletter) is for a handful of
  thematic moments.
- **`react-hooks/set-state-in-effect`, `react-hooks/immutability` and
  `no-undef` are errors in this repo.** Reset paging inside the setter, not
  in an effect. Read `localStorage` through `useSyncExternalStore`, not an
  effect. The Next preset turns `no-undef` off because it assumes TypeScript
  is catching those — but this is a JavaScript codebase, so nothing was. The
  result: a component referenced without its import built clean, linted
  clean, and threw only when someone opened the page. That's why the rule is
  on.

## Git workflow

**Bascinet is master-only. There are no branches and no pull requests.** All
work is committed straight to `master` and pushed as soon as it's finished,
so it can be pulled locally the moment it's done. That immediacy is the point
of the whole setup, and a feature branch defeats it. Railway also builds from
`master`, so work sitting on a branch is work that hasn't shipped.

```
npm run push -- "Commit message"   # git add -A, commit, git push -u origin master
npm run push                       # same, with a "wip" message
```

Never `git checkout -b`, never open a PR, never ask which branch to use. If a
remote session gets handed a throwaway `claude/<slug>` branch, it abandons it
for `master`. `.claude/hooks/session-start.sh` (a `SessionStart` hook) does
that automatically, and in the same pass deletes any `origin/claude/*` branch
that holds nothing `master` doesn't already have. It refuses to move off a
branch with uncommitted changes or unmerged commits, and it never deletes an
unmerged branch — so it can't lose work. It just prints what it skipped.

That hook also **fetches**, which matters more than it sounds. A remote
container clones once at session start and then goes stale. Without the
fetch, a session can spend an hour editing files that `master` moved past
hours ago.

**Pushing to `master` is a deploy.** Read the next section before pushing
anything that carries a schema change.

## Deploy workflow

Unless the user says otherwise, after finishing a set of changes, run
`npm run deploy` from the repo root.

```
npm run deploy      # git push origin master, ./migrate.sh, redeploy web + bot
npm run redeploy    # just the redeploy, no push, no migration
```

`./migrate.sh` sits **between** the push and the redeploy on purpose. If you
migrate first, new columns just sit unused for a few seconds — harmless. If
you redeploy first, you ship code that queries columns the database doesn't
have yet, for the whole length of a build.

**Migrations do not run themselves, and a bare `git push` is enough to
deploy.** Railway builds from this GitHub repo, so pushing to `master`
triggers a deploy with no chance for any script in this repo to migrate
first. If that deploy carries a new migration, the shipped code queries
columns the database doesn't have. The symptom is brutal to diagnose from the
browser: the page throws `P2022` server-side, and Next redacts it to a bare
digest (`ERROR 330354103`). The whole route goes down, not just the feature
that needed the column. **This has happened three times.**

The only complete fix is a **Pre-Deploy Command on the `web` service**
(Railway dashboard → web → Settings → Deploy):

```
npm run db:migrate:deploy
```

It runs after the build and before the new version takes traffic, so a failed
migration aborts the deploy instead of shipping a half-migrated app. It's
scoped to `web` on purpose — `bot` shares the database and would only race
it. Don't use a root `railway.json`, which would apply to both services.

Until that field is set, run `npm run db:migrate:deploy` by hand after any
deploy that adds a migration. (`db:migrate` is `migrate dev` — **never**
point that at production.) `./migrate.sh` is the one-liner: it sources the
root `.env` first, since npm won't load the file for you.

Two more things that cause real problems:

- **`--from-source` is required — don't drop it.** A plain
  `railway redeploy` re-runs the *existing* deployment, meaning the same
  commit. Both scripts already pass the flag.
- **A `RAILWAY_TOKEN` must be in the environment.** It has to be a *project*
  token (Railway dashboard → the project → Settings → Tokens), not an account
  token. A project token needs no `railway link`. Without one, the CLI fails
  unauthenticated and nothing deploys.

The service names in the scripts (`web`, `bot`) must match the names in the
Railway project.

## Cloud session setup (Claude Code on the web, and similar)

A fresh remote container clones the repo and nothing else — no `.env`, no
global CLIs. To make one able to build, run, and deploy:

1. **Secrets.** Set every key from `.env.example` as an environment variable,
   plus `RAILWAY_TOKEN`. The bot and the Prisma CLI read a root `.env` file,
   so a setup step should also write those values to
   `/home/user/lifeweb/.env` (it is gitignored; never commit it).
2. **Railway CLI.** `npm i -g @railway/cli` — it is not preinstalled.
3. **The database is not reachable by default.** `DATABASE_URL` points at
   Railway's public TCP proxy on a non-443 port. Sandboxed sessions route
   their traffic through an HTTPS proxy that can't carry raw-TCP Postgres. So
   `prisma migrate` and seed scripts fail with `P1001` even though the URL is
   correct. Run DB commands from a machine with direct network access, or
   against a local throwaway Postgres.
4. **Next.js does not read the root `.env`.** It loads env from its own
   project root, so local `npm run dev:web` needs a `web/.env` (a symlink is
   enough). Railway is unaffected — there, the service supplies the vars.

## Notes for future work

- `web/CLAUDE.md` / `web/AGENTS.md` are generated and maintained by the
  Next.js tooling itself (regenerated by `next dev`). They carry
  version-specific Next.js guidance and are separate from this file.
- The bot has no ESLint config yet; the web app's linting is scoped to
  `web/`.
- **Waiting for Opponents** is a `MoveReviewStatus` value the Moves table
  already colours, but nothing ever sets it. A GM parks an Opposed Move by
  simply not solving it yet.
- The **mid-game tag store is `/store`**: the shared `PointBuy.js` experience
  mounted with `afterStartOnly`, spending `Character.tagPoints`, each cart
  filed as one `BUY_TAGS` request. What's still open is the rules for earning
  points during play (Desires are currently the only faucet).
- **`prisma migrate diff` proposes dropping `ArchiveEntry_content_trgm_idx`.**
  That index lives only in raw migration SQL, so Prisma's schema doesn't know
  about it. Decline the drop; it is not drift you introduced.
- The **Dev Panel doesn't surface the REST breaker yet.** `GameConfig` now
  carries `restInvalidCount` / `restInvalidWindowStart` /
  `restBreakerOpenUntil`, and `getInvalidResponseStats()` reads them, but the
  only reader is the startup line in `bot/src/events/ready.js`. A GM-visible
  number would be a small addition.
