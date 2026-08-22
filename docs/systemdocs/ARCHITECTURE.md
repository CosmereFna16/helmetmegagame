# Architecture

How the three packages fit together, and the handful of conventions that
recur everywhere. Subsystem detail lives in the other docs — this page is the
map and the cross-cutting rules.

> This file used to be a 2024-era redesign *plan*, written in the present tense
> about a build that has since happened. Everything it proposed shipped, and
> most of its "currently missing" claims were false by the time anyone read
> them. It was rewritten as an actual architecture document; if you need the
> old plan, it's in git history.

## 1. Three packages, one database

An npm-workspaces monorepo:

| Package | What it is | Entry |
|---|---|---|
| `bot/` | The Discord bot, discord.js v14, holds a **gateway** connection | `bot/src/index.js` |
| `web/` | Next.js 16 App Router, JavaScript, Tailwind v4. **REST only** — no gateway | `web/app` |
| `db/` | `@lifeweb/db` — Prisma schema, the singleton client, and all shared game logic | `db/index.js` |

Both faces read and write the same Postgres through the same singleton, so
game state has exactly one home. Deployment is Railway: `bot` and `web` run as
two services from this repo against one Postgres instance.

**Anything both faces need belongs in `db/lib/`**, not duplicated. That's why
the rules modules (`travelCost.js`, `narrowcastAccess.js`, `laborAccess.js`,
`mood.js`, `gambitModifier.js`, `persistence.js`, `characterName.js`) live
there as pure functions with no Prisma or Discord dependency of their own.

## 2. The barrel, and when not to use it

`db/index.js` re-exports most of `db/lib/` as `@lifeweb/db`. Three deliberate
exceptions, all requiring by path instead:

- **`db/lib/dm.js`** — there are three `sendDm` functions with three different
  signatures (bot gateway, web REST, db REST). A bare `sendDm` on the barrel
  would be a coin flip. See §4.
- **`db/lib/archive.js`** — takes `prisma` as its first parameter because
  `db/index.js` imports *it*; requiring the barrel back would resolve to a
  partial, prisma-less exports object.
- **`db/lib/factionPermissions.js`** — same parameter convention, with
  `web/lib/factionPermissions.js` as a thin shim binding the singleton so web
  callers keep the shorter signature.

A module reached from a **client component** must not come through the barrel
at all — the barrel pulls in Prisma and the YAML syncs (`node:fs`), neither of
which bundles for the browser. `web/lib/characterCreation.js` imports
`@lifeweb/db/lib/roleCapacity` directly for exactly this reason.

## 3. The REST/gateway twin pattern

The bot has a gateway client; the web app only has REST. Where both need the
same Discord behaviour, there are **two implementations of the same rule**,
kept in sync by hand:

| Behaviour | Gateway (bot) | REST (web / db) |
|---|---|---|
| Send a logged DM | `bot/src/lib/dm.js` | `web/lib/discordGuild.js`, `db/lib/dm.js` |
| Is this a tupper/summary channel | `bot/src/lib/channels.js` | `web/lib/discordGuild.js` |
| Build a nickname | `bot/src/lib/nickname.js#buildNickname` | `web/lib/discordGuild.js#buildNickname` |
| Post as a character | `bot/src/lib/proxy.js#sendAsCharacter` | `db/lib/discordRest.js#postAsCharacter` |
| Location access | `bot/src/lib/location.js#swapLocationAccess` | `web/lib/discordGuild.js#syncCharacterLocationAccess` |
| Narrowcast access | `bot/src/lib/location.js` | `web/lib/discordGuild.js` (same name) |
| Sort location categories | `db/lib/syncLocations.js` | `web/lib/discordGuild.js` |

**If you change one, change its twin.** Where the *rule* can be shared it
already is — `computeNarrowcastAccess`, `isTravelFree` and
`isPersistentThreadName` are single pure functions both twins call. What's
duplicated is only the Discord plumbing around them.

## 4. Side effects are returned, not performed

A recurring shape: a function that does database work **hands its Discord work
back to the caller** rather than doing it.

- `advanceTurn()` returns a `runSideEffects` thunk (`TURN-ENGINE.md` §3).
- `runHungerPass` returns `starvedDiscordUserIds`.
- `runDefaultMovePass` returns `posts` and `dms`.
- `performTravel` returns `oldLocation` so each caller runs its own access twin.

Two reasons, both load-bearing:

1. **The caller knows which Discord client it has.** The bot awaits inline; the
   web app has no gateway and often defers to `after()`.
2. **Awaiting Discord inside a server action freezes the web app.** A pending
   server action blocks client-side navigation, and the Dawn wipe is minutes
   long. The turn commits, the response flushes, Discord catches up behind it.

## 5. Rate-limit discipline

Everything that talks to Discord in a loop is **sequential**, never
`Promise.all`. This is not incidental: Discord bans an IP for an hour after
10,000 invalid responses (401/403/429) in 10 minutes, and sequential awaiting
makes that unreachable — at most one request is ever in flight. Valid requests
never count toward it, however fast.

`db/lib/discordRest.js#discordRequest` is the central wrapper: bounded retry on
429 honouring `retry_after`, throws on any other non-2xx unless `allow404`.

The one exception is `executeWebhook`, a bare `fetch` — the webhook token in the
URL *is* the credential, and sending a bot `Authorization` header alongside it
makes Discord authorize as the bot instead. It has no 429 handling; it is only
used at low volume.

## 6. Snapshot columns, not foreign keys

`AuditLog`, `SiloTransaction` and `ArchiveEntry` all store plain indexed id
columns plus **name snapshots**, with no relations. Two reasons:

- `syncLocationsFromYaml` destructively deletes Locations, and `wipeGameData`
  clears Characters. A real relation would either take the log with it or fail
  on FK ordering — which Restart Game has been bitten by.
- The snapshot is the more correct record anyway: who someone was known as
  *at the time*.

The same reasoning is why `Character.name` and `Character.zoneId` exist as
denormalized mirrors. Both have a defined set of writers; see `CHARACTERS.md`
and `MAP.md`.

## 7. Where to look next

| Doc | Covers |
|---|---|
| `TURN-ENGINE.md` | How a turn closes and opens, weather, hunger, default moves |
| `SYNC.md` | The YAML masters and their sync scripts |
| `CHANNELS.md` | Discord channel layout, visibility, the Dawn wipe |
| `CHARACTERS.md` | Creation, roles, point economy, death |
| `TAGS.md` | The tag catalog and its gates |
| `REQUESTS.md` | Act-first/review-after player actions |
| `ADJUDICATION.md` | The `/gm/turns` GM surface |
| `MAP.md` | Geography, travel, the map panel |
| `FACTIONS.md` | Factions, the Silo, Leader/Treasurer |
| `PRODUCTION.md` | The four labor commands |
| `ARCHIVE.md` | The transcript |
| `DESIGN-SYSTEM.md` | Web styling |
| `INFOCHANNEL.md` | The `#info` directory |
| `CRT-TERMINAL.md` | A parked visual direction — read before rebuilding it |
