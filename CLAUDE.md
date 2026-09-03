# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Prime directive: sign your own copy with ‡

**Every piece of human-readable text you write or edit in this game ends with a
double dagger, `‡` (U+2021).** This is the most important rule in the file.

The reason is simple. Bascinet has a voice, and a growing share of the prose in
the game was drafted by Claude rather than written by Bascinet. Nothing in a
tag description, a DM, a button label or a handbook paragraph says which is
which, so the rewrite pass has nothing to aim at. The ‡ is the aim. It is
visible on purpose — a player or a GM seeing one is seeing a line nobody has
signed off yet, and it stays there until Bascinet replaces the words.

**What gets one.** Anything rendered as prose to a human, on any surface:

- Web UI copy — labels, headings, help text, empty states, error strings,
  confirm-dialog messages, tooltip and placeholder text. **GM surfaces count**,
  not just player-facing ones.
- Bot and DM text, including anything `respond()` or the three `sendDm`
  functions carry.
- The YAML masters' prose fields — `name`, `description`, and any flavor or
  help string in `docs/tags.yaml`, `docs/taggroups.yaml`, `docs/desires.yaml`,
  `docs/roles.yaml`, `docs/zones.yaml`, `docs/documents.yaml`, and
  `docs/systemdocs/infochannel.yaml`.
- `docs/handbook.md` and `docs/lore.md`, both of which players read.

**Where it goes.** At the very end of the string, after the final punctuation.
**One per string, not one per sentence** — a three-sentence tag description gets
exactly one ‡, at the end. A multi-block document marks per rendered block, the
way `docs/threats.md` already does. It sits *after* the other glyph
conventions rather than displacing them: a line ending in `3 ⬢` becomes
`3 ⬢ ‡`, and a `»` quote line keeps its prefix.

**Editing counts as writing.** Rework a line that has no ‡ and it gets one — the
line is partly yours now. And never strip a ‡ that is already there: removing it
is Bascinet's signal, not yours.

**What is exempt.**

- Text Bascinet dictated to you verbatim. Their words, their line, no marker.
  (This is the rule `docs/desires.yaml` already states.)
- Code comments and identifiers.
- `docs/systemdocs/*` and this file — internal reference, not game text. (A
  few marks already sit in `DESIRES.md` and `TAGS.md` §4a. Those are an older,
  narrower use — a drafted *rule* awaiting sign-off, not copy — and they stay.)
- Commit messages, `CHANGELOG.md`, and your replies in chat. The changelog is
  internal reference like `docs/systemdocs/*`, and its entries are commit
  subjects, so it is exempt twice over. Never mark it.

**Never put one in a value something matches on.** This is the caveat that keeps
the directive from breaking the game. No ‡ in a slug, an id, an enum value, a
`{resource:…}` token, a Discord channel or role name, or any
string a sync or a lookup compares. Those are keys, not prose. A tag's `name` is
safe, because the catalog matches on `slug`; a Zone's Discord role title is not,
because the channel doctor matches on it.

**Finding them.** `grep -rn "‡" docs web bot db` lists every line still waiting
on a rewrite. That one command is the whole point of the convention.

## How to write and talk

Everything below is about voice. The rule about marking what you wrote is the
prime directive above, and it applies to all of it.

Apply ASD-STE100 principles to all responses.

* Keep each response concise, complete, and easy to understand.
* Remove information that does not help the user.
* Let the completed work show the result.
* Format according to the user's needs.
* Include all necessary context in your response.

Or... really, what I mean, is just write like a freaking human! Explain things
simply, just kind of... relax. Don't write these super jargon-y things.

## Delegation and orchestration

For significant multi-step work, the main Claude agent acts as the orchestrator.

The main agent remains responsible for:
- understanding Bascinet's actual goal
- architecture and consequential cross-cutting decisions
- decomposing work
- choosing appropriate workers
- resolving conflicts between workers
- integration
- final verification and acceptance

For important independent comparisons, obtain worker analyses independently before sharing one worker's conclusions with another when practical, to reduce anchoring.

### Claude subagents

Prefer Haiku subagents, often many in parallel, for strictly bounded batch
tasks that are fully specified by the dispatching agent and need no judgment:
- Absorbing verbose tool output (builds, dumps, large search results) and returning only the distilled result
- Enumeration feeding a higher-level agent's judgment (e.g. per-table writer/reader maps, per-file import lists), keeping the expensive context for synthesis
- Delegate for context savings when the delegated material is genuinely verbose. Opus/Fable leads should usually read ordinary relevant code directly. Lower-tier leads benefit more from scout delegation.
- Pattern-matching sweeps where the parent specifies exact patterns, scope, and success criteria
- Independent replication of single-sourced negative claims during reviews.  The dispatcher supplies the independently worded patterns/methods (never the original agent's), devising them is judgment work that stays with the dispatcher.
- Scout returns are unverified input, not deliverable content. Never ship scout-derived claims without lead spot-checking.
- For a disciplined lead, a self-run grep sweep often beats a scout fan-out on both cost and context. Fan out for wall-clock speed or genuinely verbose per-item output, not by default.

Haiku task contract: return verifiable evidence (file:line, matched text, counts), never bare conclusions. Treat a Haiku "found nothing" as a data point, not a verdict — interpretation stays with the dispatching agent. On ambiguity, Haiku reports back rather than deciding. Never use Haiku for cross-cutting tracing, refutation/verification judgment, or anything where choosing what to look for is part of the task — that's Sonnet or above. If a Haiku worker fails or returns ambiguity, respecify or escalate to Sonnet rather than retrying with more Haiku.

Prefer Sonnet subagents for tasks that do not require higher-level reasoning or advanced coding skills, including routine bounded work such as:
- project-context gathering
- repository investigation
- verification — both the kind where the exact commands are already known and the kind where working out what to run is part of the job
- code review, including first-pass branch reviews
- research into existing implementation
- bounded, fully specified implementation
- straightforward isolated tasks

Prefer Opus subagents for more complex planning tasks, comprehensive code reviews, or situations where Sonnet has failed to arrive at a solution. This includes putting a reviewer or an implementer on Opus rather than Sonnet where warranted: for reviews, generally when the change spans multiple subsystems, touches concurrency, persistence, or security-sensitive paths, or is the final pre-merge review of substantial work.

Fable subagents: only for peer-review of Fable-authored designs at gate time, as one competitor on expensive-to-reverse design problems, or as the escalation terminus when an Opus subagent has failed. Never for routine delegation.

No subagent may run on a Fable-class model without explicit approval in the current session. When one seems warranted, say why and ask; if proceeding without a response, substitute Opus and flag the substitution.

Dispatch posture by tier (deliberate gradient):
- Haiku: unrestricted - see above.
- Sonnet: the routine default for bounded work needing judgment.
- Opus: deliberate, for complex planning/review.
- Fable: approval-gated per the rules above.

There is no custom agent roster in this repo — `.claude/agents/` is empty on
purpose, and the tiers above are about which **model** to dispatch on, not which
named agent to pick. Use `Explore` for broad read-only sweeps, `Plan` for design
work, and `general-purpose` for everything else, including anything that writes.
Always pass an explicit model, so a worker never silently inherits a Fable-class
session model.

For a side task that genuinely requires the full current conversation context, use a fork subagent (subagent_type: fork) rather than restating that context in a dispatch prompt. Do not fork routine exploration or bounded work — fresh context is the point of a normal subagent, and forks inherit the session model (Fable-gate approval applies).

Give each subagent a clear objective, scope, modification authority, and expected output.

Grant write authority explicitly in the dispatch prompt, and only to a
`general-purpose` worker — `Explore` and `Plan` cannot edit files at all. Never
run concurrent writers against the same working tree: parallel implementation
shards require per-worker isolation (pass `isolation: worktree` at dispatch);
otherwise serialize writers. That matters more here than in most repos, because
several sessions share this one checkout — see the local verification note under
**Commands** for how quickly it moves underneath you.

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
  GitHub repo itself was renamed to `peace-lock/helmetmegagame`. It is
  public again at the moment; it was private for a while after players
  found it.)
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
| [`TURN-ENGINE.md`](docs/systemdocs/TURN-ENGINE.md) | You're touching how a turn advances — hunger, auto-labor, weather, the side-effect thunk |
| [`LAUNCH.md`](docs/systemdocs/LAUNCH.md) | You're opening a game or running a Restart Game wipe — the order that keeps players from being locked out |
| [`SYNC.md`](docs/systemdocs/SYNC.md) | You're editing a YAML master or a sync script, or wondering what a sync deletes |
| [`CHANNELS.md`](docs/systemdocs/CHANNELS.md) | You're changing Discord channel layout, visibility, or the Dawn wipe |
| [`CHARACTERS.md`](docs/systemdocs/CHARACTERS.md) | You're touching creation, roles, names, the point economy, death, or launch gating |
| [`TAGS.md`](docs/systemdocs/TAGS.md) | You're touching the tag catalog, **pricing or rebalancing a tag** (§4a is the canonical point scale), **pricing an injury or adding a health tag** (§5c is the canonical cure ladder), its gates, stacks, consuming, or equipment |
| [`SMITHING.md`](docs/systemdocs/SMITHING.md) | You're pricing a weapon or armor, changing the crafting ladder, or touching the Smithing / Crafting / Fighting skill families |
| [`BREWING.md`](docs/systemdocs/BREWING.md) | You're pricing a brew, changing a recipe, or touching the Brewing skill family |
| [`DEPOT.md`](docs/systemdocs/DEPOT.md) | You're pricing an imported ware, touching `/depot` or the Merchant's credit line, or setting a tag's `depotPrice` / `sellablePrice` |
| [`DESIRES.md`](docs/systemdocs/DESIRES.md) | You're touching the Desire catalog, its gates/cooldowns/locks, `conflictsWith`, or the Desires GM surface on `/gm/dev` |
| [`REQUESTS.md`](docs/systemdocs/REQUESTS.md) | You're adding or changing anything a player does to their own sheet |
| [`BIRD.md`](docs/systemdocs/BIRD.md) | You're touching the Bird's letters, the once-a-day send, the Reply window, or the **Literate cipher** (`db/lib/gribble.js`) that any future literacy feature should reuse |
| [`ADJUDICATION.md`](docs/systemdocs/ADJUDICATION.md) | You're working on `/gm/turns` — the arbitration workspace, staging, or the turn-end push |
| [`PLAYER-DESK.md`](docs/systemdocs/PLAYER-DESK.md) | You're working on `/gm/players` — the merged roster + conversations desk, GM notes, or ⌘K |
| [`DEV-PANEL.md`](docs/systemdocs/DEV-PANEL.md) | You're touching `/gm/dev/characters/[characterId]`, the GM microactions, or `/gm/dev/tags` |
| [`MAP.md`](docs/systemdocs/MAP.md) | You're touching geography, travel cost, or the `/map` panel |
| [`CAVING.md`](docs/systemdocs/CAVING.md) | You're touching the Caving Die, the cave loot table, or the Caving lens on `/gm/turns` |
| [`PROXYING.md`](docs/systemdocs/PROXYING.md) | You're touching how a player's message becomes a character's — proxying, avatars, reactions, `/conceal`, mentions, nicknames, notes |
| [`FACTIONS.md`](docs/systemdocs/FACTIONS.md) | You're touching factions, or who can see a member's ⬢ (Leader/Treasurer) |
| [`GAMEMASTERS.md`](docs/systemdocs/GAMEMASTERS.md) | You're touching the zone colour code, a GM's zone seat, `/gm/gamemasters`, or who can see the audit log |
| [`LABORING.md`](docs/systemdocs/LABORING.md) | You're touching Laboring — the tag ladder, a Location's `yield:` coefficients and their drift, the tools (`laborBonus`), the auto-labor pass, or the Labor? button |
| [`CARRY.md`](docs/systemdocs/CARRY.md) | You're touching carry caps, Overburdened, Pack Mule / Cart, room stashes, the Transfer dialog, or the Storage button |
| [`CORPSES.md`](docs/systemdocs/CORPSES.md) | You're touching what a body is — the corpse tag, butchering, Bury or Engrave, the rot clock, the death smell, or an **enforced recipe ingredient** (`requirement.items`) |
| [`LESSONS.md`](docs/systemdocs/LESSONS.md) | You're touching Learn Skill / Teach Skill, the Teaching tags, the Offer handshake (Bind's consent too), or the lesson turn pass |
| [`CRAFTING.md`](docs/systemdocs/CRAFTING.md) | You're touching Craft, Destroy, the four tag capability flags (`craftable` / `removable` / `healable` / `teachable`), multi-turn projects, or who pays for a recipe |
| [`ARCHIVE.md`](docs/systemdocs/ARCHIVE.md) | You're touching the transcript or `/archive` |
| [`DOCUMENTS.md`](docs/systemdocs/DOCUMENTS.md) | You're touching `/documents`, `docs/documents.yaml`, `/handbook`, or `docs/handbook.md` |
| [`INFOCHANNEL.md`](docs/systemdocs/INFOCHANNEL.md) | You're changing `#info` or `docs/systemdocs/infochannel.yaml` |
| [`PORTRAITS.md`](docs/systemdocs/PORTRAITS.md) | You're touching the portrait maker, avatar art, or `Character.avatarData` |
| [`DESIGN-SYSTEM.md`](docs/systemdocs/DESIGN-SYSTEM.md) | You're writing or restyling **any** web UI |
| [`CRT-TERMINAL.md`](docs/systemdocs/CRT-TERMINAL.md) | Someone suggests a terminal/CRT look — read before rebuilding it |

Other reference docs, outside `systemdocs/`:

- `docs/lore.md` — the setting.
- `docs/threats.md` — the antagonist seats. It briefs 6 of them, while
  `db/lib/antagonists.js` ships 11 opt-in entries.
- `docs/handbook.md` — the player handbook, read at runtime by the web app
  (`web/lib/handbook.js`) rather than repo-only reference. It renders on two
  live surfaces: the pinned "Player Handbook" card on `/documents` and the
  public, no-sign-in `/handbook` page. Editing it changes what players see on
  the next request, no sync or deploy of any other file required.

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

npm run db:generate                  # prisma generate. Runs on `npm install`
                                     #   via a root postinstall, but if you
                                     #   only pulled a schema change (no new
                                     #   dependency), run it explicitly — a
                                     #   stale generated client throws
                                     #   `PrismaClientValidationError: Unknown
                                     #   argument` for fields that are right
                                     #   there in schema.prisma, which reads
                                     #   like a schema bug but isn't.
npm run db:migrate                   # prisma migrate dev. LOCAL POSTGRES ONLY.
                                     #   Against Railway it offers a full reset
                                     #   on drift, which is how game one died.
                                     #   .claude/hooks/prisma-guard.sh refuses
                                     #   it when DATABASE_URL points at Railway.
npm run db:migrate:deploy            # prisma migrate deploy (production).
                                     #   ./migrate.sh wraps it with a Railway
                                     #   backup first.
npm run db:backup                    # Railway volume backup, now. Needs
                                     #   RAILWAY_API_TOKEN in .env.

# YAML masters -> DB. `db:sync` runs all six in the working order; the
# individual scripts exist for one master at a time. See SYNC.md.
npm run db:sync                      # zones, narrowcast channels, tags,
                                     #   roles, desires, documents.
npm run db:sync-zones                # docs/zones.yaml      (destructive; zones,
                                     #   Locations, Rooms, their channels/
                                     #   threads + roles)
npm run db:sync-tags                 # docs/tags.yaml       (upsert-only)
npm run db:sync-roles                # docs/roles.yaml      (prunes unreferenced)
npm run db:sync-desires              # docs/desires.yaml    (upsert-only; soft-
                                     #   retires a template absent from the
                                     #   YAML — see DESIRES.md §10)
npm run db:sync-documents            # docs/documents.yaml  (destructive; last)
npm run db:sync-narrowcast-channels  # #watch/#intercom provisioning + reconcile.
                                     #   Run AFTER db:sync-zones.
npm run db:rebuild-info-channel      # destructive rebuild of #info

# Ops. Scripts live in db/scripts/ops/. See SYNC.md §4.
npm run db:doctor                    # the channel doctor: diffs Discord roles/
                                     #   channels/threads against the DB. DRY
                                     #   RUN unless given `-- --apply`; add
                                     #   `-- --full` for overwrites + threads.
                                     #   Also runs cheap+apply on every bot
                                     #   start. See CHANNELS.md.
npm run db:prune-tags                # deletes tags absent from docs/tags.yaml.
                                     #   DRY RUN unless given `-- --apply`.
npm run db:prune-orphan-roles        # deletes Discord character roles no living
                                     #   character claims. DRY RUN unless given
                                     #   `-- --apply`. Guards the 250-role cap.
                                     #   `-- --include-catatonic` also accepts
                                     #   the Catatonic repaint, which can never
                                     #   match the normal signature.
npm run db:prune-stale-channels      # deletes categories, channels and zone/
                                     #   location roles from a PREVIOUS game
                                     #   that no DB row references. db:sync-
                                     #   zones cannot see these. DRY RUN unless
                                     #   given `-- --apply`.
npm run db:report-inactive-characters  # read-only inactivity report
npm run db:open-rp-channels          # between games: open every roleplay
                                     #   channel to the guild. DRY RUN unless
                                     #   given `-- --apply`.

npm run build --workspace=web        # production build of the web app
npm run lint --workspace=web         # eslint over the web app
npm run audit:contrast --workspace=web   # AA gate over globals.css themes
npm run assets:letters --workspace=web   # regenerate default letter-plaque avatars
```

### Verifying a change locally

The app signs in only through Discord, so `next dev` starts fine but every page
redirects — which used to mean UI work could be compiled but never actually
looked at. Two dev-only scripts close that, and **neither touches application
code**: sessions here are JWTs signed with the `AUTH_SECRET` already in
`web/.env.local`, so a valid cookie can just be minted.

```
npm run dev:session -- --gm               # print a session cookie for a superadmin
npm run dev:session -- --character "Ada"  # ...or for a named ALIVE character
npm run dev:check                         # load every route as the right persona
npm run dev:check -- --gm /gm/turns       # load named routes as a superadmin
npm run dev:check -- --anon /character    # no cookie, to confirm a gate still shuts
```

`npm run dev:web` must already be running. `dev:check` also asserts the negative
cases — that a player is still bounced off `/gm/*` — so loosening a gate by
accident fails the run.

Two things it knows that a plain `curl` does not. A `redirect()` called from a
page rather than a layout arrives as a **200** with `NEXT_REDIRECT` buried in the
streamed payload, and a server component that throws also answers **200**, with
the error encoded as a flight row. Status alone is not a verdict, so the body is
what's judged.

If a route reports `PrismaClientValidationError` on a field that plainly exists
in `schema.prisma`, the running dev server is holding a stale generated client:
run `npm run db:generate` **and restart `dev:web`** — regenerating alone does not
reach the process that already imported it. This happens most often right after
someone else's commit lands, since several sessions share this one checkout.

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
| **Zone role** | `Zone.discordRoleId`, one per presence zone ("Zone: Town"), created by `db:sync-zones` | Opens the zone's `#summary`, and — via `#turns`/`#intercom`'s own role grants — the standing channels. Swapped by travel; reconciled by the channel doctor. |
| **Location overwrite** (not a role) | A per-member permission overwrite on the Location's channel, written by `db/lib/locationMove.js` | Channel access: holding it is what shows you the one Location channel a character actually stands in. Swapped by every location change; reconciled by the channel doctor's `location-occupancy` check. Locations wear **no** Discord role — 56 of them would have eaten 56 of the guild's 250, and Discord allows 1000 overwrites per channel. |
| **Personal character role** | `Character.discordRoleId`, one per `ALIVE` character, titled after the **bare** name | A mentionable **name token only** (`PROXYING.md` §6) — held by nobody and granting nothing. Channel access is the **zone role and the Location overwrite** instead (`CHANNELS.md` §3). |
| **GM role** | `DISCORD_GM_ROLE_ID` env var | `/gm` pages, the `/gm` and `/message` slash commands. Checked via REST (`isGm`), not stored on any model. |
| **Spectator role** | `SPECTATOR_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | A standing read-only observer seat, applied at provisioning time. See `CHANNELS.md`. |
| **Player role** | `PLAYER_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Who may create a character, paired with `GameConfig.openToPlayers` (`CHARACTERS.md` §4b). |
| **Leader Whitelist role** | `LEADER_WHITELIST_ROLE_ID`, hardcoded in `db/lib/roleIds.js` | Who may pick a role flagged `leader: true` at character creation — unless `GameConfig.leaderWhitelistEnabled` is switched off on `/gm/dev` (`CHARACTERS.md` §2). |
| **Cursed role** | `DISCORD_CURSED_ROLE_ID` env var | What a player may re-roll as after a death (`CHARACTERS.md` §4), **and** the ghost seat: read-only view of every zone (cave levels included; private threads stay invisible), plus the 🌬️ whisper. Its color is pinned to 0 so ghosts aren't outed in the member list (`CHANNELS.md` §3, `COMMANDS.md` §6). |
| **Turn-ping role** | `DISCORD_TURN_PING_ROLE_ID` env var | Plain opt-in notification, toggled from `/character`. |

One more gate exists that is **not** a Discord role, and it's the only soft
one in the app. `GmAssignment` (one row per seat, keyed on the pair
`discordUserId` + `zoneId`, set from `/gm/gamemasters`) seats a zone-GM over
one or more of the six **seat** zones — Town, Fortress, Forest, East Forests,
Marshes, Underground — never one of the two cave levels. All it does is decide which zones that GM's
tables *open* on. No query is scoped by it, and no row is hidden — a Move
crosses zones by nature, so hiding rows would break the job. Every other row in
the table above is real enforcement; this one is just convenience. Read
[`GAMEMASTERS.md`](docs/systemdocs/GAMEMASTERS.md) before you try to harden
it.

`/gm/gamemasters` and `/gm/dev` are **superadmin-only**, not GM-visible —
those are host access, not game permission. `/gm/audit` is **open to every
GM**: it used to be the master's alone, on the argument that with five GMs the
log is a record *of* them, but that left four people unable to answer "who
changed this", which is what the log is for.

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
  declares — and `/move` `/location` `/message` `/conceal` need to work there.
  The cost of global registration is real: a new or renamed command takes
  **up to an hour** to show up. `set` fully replaces the list, so removing a
  command needs no separate deregistration step.
- **Use contexts, not `setDMPermission`.** Any command that needs a channel
  or thread to act on (`/gm`, `/dm`, `/add`, `/remove`, `/heal`) declares
  `Guild` only. That way it never shows up in a DM picker
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
Move-declaration DM uses it to explain Routine/Gambit under the
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

- Prose that names Resources **as a concept** uses the plain
  word and no glyph: "you are only limited by your Resources".
- Anywhere a **quantity** is shown, drop the word and write `{number} ⬢`:
  `0–4 ⬢`, `3 ⬢`, `+5 ⬢`, `30 ⬢ flat`. Never `3 Resources ⬢`.
- In the UI, the label carries the word and the value carries the glyph —
  `<th>Resources</th>` over cells reading `12 ⬢` — never the other way
  around. A number `<input>` just gets a plain label.

One exception. A `{resource:…}` bubble already renders its own glyph via
`ResourceChip.js`, so never write a glyph after one. Also, literal syntax a
player is meant to *type* (`/move`, `/conceal`) is quoted as-is. The glossary
line in
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

## Game state: NOT LAUNCHED — act, don't ask

**The next game has not started.** There are no players, no live turns, and
nothing in the database that cannot be rebuilt from the YAML masters and a
wipe. Until Bascinet says the game is live, treat production as a sandbox:

- **Push and deploy destructive changes without asking.** Migrations that
  drop columns, `db:sync-zones`, `db:sync-documents`, `db:prune-tags --
  --apply`, a Restart Game wipe, a `#info` rebuild — all fine. Just do it and
  say what you did afterwards.
- **Don't stop for confirmation** on Railway, Prisma, or Discord work.
  Bascinet is usually away from the keyboard and would rather come back to
  finished work than to a question.
- **Still never `prisma migrate reset` or accept a `migrate dev` reset
  prompt.** That is how game one died on day 10, and the habit has to be
  gone before launch, not after. Author migrations so `migrate deploy`
  applies them.

When the game goes live, Bascinet flips this section and the rules above
invert: every destructive path needs an explicit go, and a backup taken
first.

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

### The changelog

**Every push writes an entry in `CHANGELOG.md` and posts the same entry to
Discord.** `npm run push` does both for you — the entry is written from the
staged diff *before* the commit, so it rides along inside that commit instead of
trailing behind in a second one, and the Discord post goes out after the push
succeeds.

```
npm run push -- "Message"   # commit, push, log, announce
npm run changelog           # log HEAD + announce, for a commit made by hand
npm run changelog -- --dry-run             # preview the CHANGELOG.md entry
npm run changelog -- --announce --dry-run  # preview the Discord message
```

Commit by hand and nothing is logged, so run `npm run changelog` afterwards.

The format is three symbols and nothing else — `+` a file arrived, `-` a file
went away, `✎` a file changed:

````
## 2026-09-03 · Keyed ways: hold the door open behind you for 24 hours

```
+ db/lib/keyedWays.js
✎ db/prisma/schema.prisma
- db/lib/oldGate.js
```
````

They sit inside a fenced block on purpose. Both GitHub and Discord read a
leading `+` or `-` as a list marker and would eat the symbol; a fence renders
all three literally and keeps the paths aligned.

The Discord half is **best-effort and never fails the push** — a missing
`DISCORD_TOKEN` or a Discord outage prints a warning and the run stays green.
The channel id is hardcoded in `scripts/changelog/log.js` for the reason
`db/lib/roleIds.js` gives: a channel id is not a secret, there is one guild, and
a missing env var would have failed silently.

## Deploy workflow

Unless the user says otherwise, after finishing a set of changes, run
`npm run deploy` from the repo root.

```
npm run deploy      # git push origin master, ./migrate.sh, redeploy web + bot
npm run redeploy    # just the redeploy, no push, no migration
```

`./migrate.sh` takes a Railway backup first (`npm run db:backup`), then
migrates. It sits **between** the push and the redeploy on purpose. If you
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
- **Waiting for Opponents** (`MoveReviewStatus.WAITING_FOR_OPPONENTS`),
  `MoveReviewStatus.IN_PROGRESS`, and `ActionStatus.PENDING_OPPOSED` are legacy
  values from the removed Opposed flag. Nothing writes any of them any more;
  they're kept in their Postgres enums rather than dropped, same as
  `ActionStatus.ADJUDICATED`. `TagSource.DESIRE_REWARD` and
  `TagSource.LEADER_GRANT` are the same shape from an earlier tag-sourcing
  design — declared in the enum, written and read nowhere.
  `GameConfig.mindlinkChannelId` is the same kind of orphan: the column
  stays in the schema, but nothing reads or writes it since the Cult of
  Bacchus was archived (`docs/archive/bacchus.yaml`).
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
