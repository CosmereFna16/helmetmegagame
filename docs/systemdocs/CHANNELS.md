# Discord Channel Schematic

How Discord channels get their behavior in Bascinet, and how visibility is
controlled. Two independent mechanisms are involved — channel *type/name*
(what the channel is for) and *role* membership (who can see it) — and they're
easy to conflate, so this doc keeps them separate.

Since the zone rework there are **six standable zones** and no Location
channels at all. A Location is prose now: a generated forum post inside a
zone's public forum (§4). `MAP.md` is the game side of the same change.

## 1. Tupper / summary opt-in

A channel opts into tupper/summary behavior by being one of a zone's
provisioned channels (§2), or a special channel whose registry entry says
`tupper: true` (§7), matched by Discord channel **ID** — there is no name-based
marker, and channel names are otherwise meaningless to this system.

| Channel | Tupper | Summary |
|---|---|---|
| A surface zone's `#summary` | yes | yes — adjudication results and Default Move summaries post here |
| A surface zone's `#public` (forum) | yes | no |
| A cave level's forum | yes | no |
| A `#private` (surface zone or cave level) | yes | no |
| `#watch`, `#intercom` | yes | no — neither is tied to a place, so there is no adjudication result to post there |

Two independent implementations check this: `bot/src/lib/channels.js`
(gateway cache, refreshed on ready and every 5 minutes) and
`web/lib/discordGuild.js` (`isSummaryChannel`/`isTupperChannel`, REST-based).
Keep them in sync if the rule changes.

The same refresh builds `channelContexts`: channel id → `{ zoneId, zoneName,
channelKind }`, so the proxy can stamp an archive row with where a message was
said without a DB round trip per message. `channelKind` is one of
`summary | public | private | watch | intercom` (`ARCHIVE.md`). A thread
reports its parent's context and keeps its own name as the scene.

## 2. Zone channel layout

Everything is provisioned by `db/lib/syncZones.js` from `docs/zones.yaml`
(`npm run db:sync-zones`, `SYNC.md`). The layout itself is described **once**,
by `db/lib/zoneChannelSpec.js#zoneChannelSpec` — the category and channels as
create payloads — and both first-time provisioning and the every-run reconcile
build from it, so the two can never disagree.

**Surface zone** (Town, Fortress, Windlands) — a category named after the zone:

| Channel | Type | Purpose | Notes |
|---|---|---|---|
| `#summary` | text | Abstracted, big-picture play. Adjudication results and Default Move summaries land here. | 300s (5 min) slowmode — the slowmode is what stops it becoming a second moment-to-moment channel. Wiped at Dawn. |
| `#public` | forum | Moment-to-moment roleplay, in topics. | **Players cannot create posts.** The bot does, from the Create-a-Topic button (§4). Posts auto-archive after 24h idle (`default_auto_archive_duration: 1440`). |
| `#private` | text | Private scenes, as threads. | No top-level messages and **no player-created threads of either kind**. One permanent anchor message carries a Create button (§4). |

**Caves** — the `CAVE_GROUP` row owns the shared category and nothing else.
Each `CAVE_LEVEL` (Caverns, Railroad, Aberrant Pits) gets **two channels**,
both parented to that category: a forum named after the level, with exactly
the same forum rules as a surface `#public` — including its own Create-a-Topic
anchor — and a `#{level}-private` text channel with the same rules and Create
anchor as a surface `#private`. The private channel carries the level's slug
in its name because all three levels share one category; the pairs are
interleaved in level order (caverns, caverns-private, railroad, …). Cave
levels have no `#summary`.

**Creation is one-time; a lot is reconciled every run.** The sync only creates
channels whose id column is null, and channel *names* are never touched again —
renaming a zone in the YAML does not rename a live channel. But for everything
already provisioned it re-applies channel **topics** and slowmode, the full set
of **permission overwrites**, the **forum tags**, category and channel
**ordering**, the **anchor posts**, the **generated Location topics**, and the
cursed role's colour. So `npm run db:sync-zones` is the repair path for a zone
whose channels drifted.

> **Ordering: `parent_id` must not ride along in a bulk position call.**
> Positions are bulk; reparenting is not — Discord rejects the whole request
> with `400` code `40009`, *"Only one channel can have a parent_id modified at a
> time"*. So a channel that drifted out of its category is repaired first with
> its own `PATCH`, and only when the live tree says it is actually misplaced.
> Categories are sorted by zipping YAML order onto the position slots those
> categories already hold, so non-zone categories keep their places.

## 3. Visibility: the zone role is the access model

Every channel is hidden from `@everyone` and opened by **one role per presence
zone**, named `Zone: {Name}` (e.g. `Zone: Town`), created by the sync and held
by exactly the living characters standing there. Travel swaps the role; nothing
else grants zone access.

> **A channel does not reliably inherit its category.** Discord "syncs" a
> channel to its category by *copying* the overwrites at creation; the two
> drift apart afterwards, and a later change to the category never reaches a
> channel that has come unsynced. Relying on inheritance is what once left
> every channel except the one that named `@everyone` itself world-visible
> after a clean re-sync. Every target now states its own privacy in full, and
> the category keeps a copy as defense-in-depth.

The overwrites every target carries (`baseOverwrites`):

- **`@everyone` denied `ViewChannel` + `AttachFiles`.** The `ViewChannel` half
  is the entire privacy mechanism; everything else is an allow layered back on
  top of it.
- **The GM role**, allowed explicitly on every channel, not just the category —
  Discord resolves channel overwrites after category ones, and a role with no
  entry of its own falls through to whatever `@everyone` says there.
- **The spectator seat** (`db/lib/spectatorAccess.js`) — standing read-only.
- **The ghost seat** (`db/lib/cursedAccess.js`) — see §5.

On top of that, the zone's own role gets: `ViewChannel` + `SendMessages` +
`AddReactions` on `#summary`; `ViewChannel` + `SendMessagesInThreads` +
`AddReactions` on a forum; `ViewChannel` + `SendMessagesInThreads` on
`#private`.

**Post/thread creation is denied to `@everyone` on every forum and on
`#private`.** Creating a forum post is `SEND_MESSAGES` on the forum channel, so
denying that while allowing `SEND_MESSAGES_IN_THREADS` is what makes posts
bot-only while keeping the talk inside them open; `CREATE_PUBLIC_THREADS` and
`CREATE_PRIVATE_THREADS` are denied alongside as belt-and-braces. Players hold
no create permission anywhere, which is what keeps `PlayerThread` a complete
record — persistence, expiry and invites all hang off that row.

**Per-member overwrites on zone channels are gone.** The old model added a
`ViewChannel` overwrite keyed on `Character.discordUserId` to every channel of
a Location and removed it from the old one. Two role calls now replace eight to
fourteen overwrite writes per hop, and the channel doctor treats *any* member
overwrite on a zone channel as a stray to be deleted (§6). The only surviving
member overwrites in the game are the special channels' grants (§7).

Every `ALIVE` character still has a **personal Discord role**
(`Character.discordRoleId`), titled after their **bare** name — first + last via
`formatBareName`, never the honorific or the granted title — and coloured
deterministically by `db/lib/roleColor.js#hashNameToColor` from that same bare
string. It is **assigned to nobody and grants nothing**: putting the player in
it would list their account under the character's name and deanonymize the
game. It exists to be `@`-mentioned (`PROXYING.md` §6) and to be the option in
the `/add` and `/remove` pickers.

### 3a. `#turns`: seen by anyone with a character

`#turns` sits outside the zone spec — nothing in the repo creates it, and both
its writers find it by exact name (`isTurnsChannel` in
`db/lib/turnsChannelAccess.js`). Its access is still built from the zone roles,
in `db/lib/turnsChannelAccess.js#syncTurnsChannelAccess`:

- `@everyone` denied `ViewChannel` + `SendMessages` + `AttachFiles`. The
  channel stays bot-only; the console's Travel/Move/Speak buttons are
  components, not messages, so nobody needs send.
- **every** zone role allowed `ViewChannel`. This is the gate. A living
  character holds exactly one zone role from the moment `createCharacter` runs,
  and travel only swaps it — so "has a character" and "holds some zone role"
  are the same set, and the channel appears the instant a character exists.
  Same trick `#intercom` uses (`roleViewZones`, §7).
- the GM role, the spectator seat and the ghost seat, each via the helper that
  already exists for it.

It used to manage nothing but `SendMessages`, so *visibility* was whatever had
been clicked by hand in Discord — a player finished creation and still saw
nothing until a GM added an override. That list above is now the **complete**
description of who may see the channel, so the sync deletes every overwrite it
doesn't name: the per-member grants GMs added one player at a time, and the
**Player** role's view grant, which said "approved to make a character", not
"has one". A bot's own overwrite is the single exception, left alone so a guild
whose bot isn't an administrator can't lock itself out of the channel it posts
to.

Re-applied on every bot ready (`bot/src/lib/turnsConsole.js`), at the end of
every `db:sync-zones` (a repaired zone role has a **new** id, and the old grant
would point at a dead one), and by the channel doctor's full scope.

### 3b. The OOC report channel

A fixed text channel (`REPORT_CHANNEL_ID` in `db/lib/reportChannelAccess.js`,
hardcoded for the `roleIds.js` reason) holding one bot post — "Report an OOC
problem." with a green **Open Ticket** button — and a private thread per
report. Same shape as `#turns`: the bot re-asserts access at every ready
(`bot/src/lib/reportChannel.js#ensureReportAnchor`), finds its anchor by the
button on it rather than a tracked id, and sweeps every other message out of
the channel. Anything typed into the channel afterwards is deleted on arrival
(`messageCreate.js`, beside the `#turns` rule) — GMs' messages included. Send
is neither granted nor denied: Gunboat asked that everyone keep it, and the
deletion rule makes a lock unnecessary (buttons work without send either way,
as `#turns` shows).

Access: `@everyone` denied `ViewChannel`; the **Player** role allowed the view
plus `SendMessagesInThreads` / `AttachFiles` / `AddReactions`; the GM role that
plus `ManageThreads` / `ManageMessages`. Single-target PUTs, so anything else
set by hand on the channel stays. The spectator and ghost seats get no
overwrite: the spec is "only the Player role can view".

**Open Ticket** creates a private, non-invitable thread named `Report – <Discord
username>`, adds the reporter and every non-bot holder of the GM role, and
posts a pinned message pinging the GM role with a red **Close** button.
Threads auto-archive after a week (the longest Discord allows) rather than
the parent's 24h default. A second press while that thread exists — active
or archived — just links to it (matched by name: cache, then active, then
archived private threads, so a cold cache after a restart can't duplicate
one); a double-click is held by an in-flight set, and a fresh ticket within
60 seconds of the last is refused. **Close** is honoured only inside a private thread whose
parent is the report channel, and deletes the thread — anyone in it is the
reporter or a GM, so there is no further gate. Both are audited
(`ooc_report_opened` / `ooc_report_closed`, the "OOC report" family on
`/gm/audit`).

Report threads are **not** `PlayerThread` rows, and that is what keeps them
alive: `dawnWipe`, `fullWipe`, `threadExpiryPass` and the channel doctor all
walk zone channels, `SPECIAL_CHANNELS` or `PlayerThread`, so a thread under a
channel none of them know about is never touched.

### The two travel twins

`performTravel` does no Discord work (`MAP.md` §4); each caller runs its own
half:

| Trigger | Code | Mechanism |
|---|---|---|
| Travel button on `#turns`, or `/location` | `bot/src/lib/zoneTravel.js#performMove` → `swapZoneRole` | Gateway |
| Web map | `web/app/(app)/map/travelActions.js#travelTo` → `syncCharacterZoneRole` | REST |
| GM raw edit, GM Bulk Move, character creation | `web/lib/discordGuild.js#syncCharacterZoneRole` | REST |
| Staged relocation, applied at the turn push | `db/lib/zoneMove.js#applyZoneMoveSideEffects`, from the side-effect thunk | REST |

All of them **grant before revoke**, deliberately: an interrupted swap leaves the
player seeing two zones for a moment (harmless, self-healing) rather than none
(a lockout a player can't diagnose). Neither swallows a failure silently — the
doctor reconciles whatever they miss.

Any new writer of `Character.zoneId` must call one of these. A raw Prisma write
alone leaves the old role held and the new one missing, and the player either
sees the wrong zone or none.

### Death and departure

`db/lib/accessSweep.js#revokeAllCharacterAccess` strips every zone role (a
removal of a role the member doesn't hold is a no-op, so all six cost less than
working out which one they held from possibly-stale state) and sweeps their
member overwrites off every zone channel and special channel. Its callers are
`killCharacter`, `guildMemberRemove` and `wipeGameData`; any new path that ends
a character must call it too.

`revokeAccessForCharacters` in the same file is the bulk form for Restart Game:
one paginated member-list read, then one removal per (member × zone role
actually held), plus a channel-major overwrite sweep — read each channel once,
delete only what's actually on it. That's what keeps a full-roster wipe at
hundreds of calls instead of tens of thousands. Both return counts and failure
lists rather than nothing, because a revoke that silently fails leaves a
departed player still reading rooms.

## 4. Topics, anchors and player-made threads

### Location topics (sync-owned)

Each `topics:` entry in `docs/zones.yaml` becomes one `LocationTopic` row and
one generated forum post in its zone's public forum. The starter message
carries the topic's name and prose in bold/italic, then a compact
sub-location block: one `**Sublocations**: name1 | name2 | name3` index line
naming every sub-location, followed by one `-#` subtext line per
sub-location that actually has descriptive text. A sub-location with no text
appears in the index only — it gets no `-#` line, since there's nothing to
caption yet.

These posts are **unlocked** (players roleplay in them — that is the point of
the rework) and **not pinned** (Discord caps pinned posts per forum). They wear
the **Location** forum tag instead, which is the discoverability mechanism.
They are reconciled by content hash on `LocationTopic.postHash`, so a re-sync
with no YAML edits makes no Discord writes at all, and a changed body is
rewritten **in place**: unlock, delete every message except the starter, edit
the starter, re-post overflow chunks, then re-assert name, tags and lock state.
The starter message's id *is* the thread id, and deleting it would destroy the
post.

The starter message's button row is hashed separately, on
`LocationTopic.componentsHash` — a Location post currently carries no
buttons, but the column exists so a future button change on it never has to
go through the destructive rebuild above just to update a row of components:
a components-only change takes a cheap starter-message **edit** instead,
which matters here because the body rewrite deletes every reply in the
thread, and a Location post is where the day's roleplay actually lives.

Creating a new post first checks the forum for one already carrying that
exact title and adopts it rather than posting a duplicate (§7 has the same
posture for a special channel). This exists because a retried create — the
429 bounded-retry loop in `discordRest.js`, or a request Discord actually
applied before the client gave up waiting on it — can otherwise leave two
empty posts with the same name sitting side by side.

A topic whose zone changed in the YAML **moves**: a forum post can't change
forums, so the old post is deleted and the recorded ids nulled, and the post
pass recreates it in the new forum.

### The two anchors

| Anchor | Where | What it is |
|---|---|---|
| **Create a Topic** | one pinned, **unlocked**, Location-tagged forum post at the top of every public forum (surface and cave level) | Its single message carries the zone's blurb plus instructions; the `topic:new:{zoneId}` and `zone:who:{zoneId}` buttons ride on it |
| **Create** | one permanent message in every `#private` (surface and cave level) | Carries the `priv:new:{zoneId}` button |

The Create-a-Topic anchor is **unlocked on purpose**. Discord greys a message's
buttons out for anyone who cannot send in the thread, so while it was locked
every player saw two dead buttons and only GMs — who hold `MANAGE_THREADS` on
the forum — could press them. The lock's tidiness job is done instead by
`bot/src/events/messageCreate.js`, which deletes anything typed into an anchor
before it can be proxied or archived.

**Who's here?** replies privately with the names of every `ALIVE` character
standing in the zone — plus each name's `roleTitle` for anyone who shares the
viewer's faction, the same same-faction gate the bot's 🔍 inspect embed uses
(`FACTIONS.md` §4a). It lives on the anchor only, not on every generated
Location post below — one button per forum, not one per post. No extra gate
sits on the button itself: the forum it lives in is already visible only to
that zone's role, so pressing it reveals nothing a player in the room
couldn't already see by walking around.

Both are hash-gated the same way the topics are (`Zone.createTopicHash`,
`Zone.privateAnchorHash`). The `#private` anchor is a plain message, not a
thread, so a GM who deletes it by hand gets it reposted on the next sync (the
edit 404s and the code falls through to a post).

The button opens a modal asking for a **name** and a **persistent** checkbox
(`bot/src/lib/topicModal.js`). A modal must be shown within three seconds and
cannot be deferred first, so nothing is read when the button is pressed — every
gate runs on submit: a living character, standing in the zone whose id rode in
the custom id. A button is a hint, not a lock, and the ephemeral UI outlives
the player walking out of the zone.

On submit the bot creates the post or thread, adds the creator, and writes a
`PlayerThread` row (`kind: PUBLIC | PRIVATE`, creator, `persistent`,
`lastActivityTurn`) plus an audit entry. A public topic's opening message
mentions the creator, which is what puts the new post in their mentions and
makes them a follower.

### Persistence

**`PlayerThread.persistent` in the database is the truth.** The wipe reads the
column, never a Discord marker, so a hand-stripped forum tag can't make a
standing side-room vanish. On a public post the **Persistent** forum tag is
mirrored for visibility (and re-asserted by the wipe); a private thread carries
**no marker at all** — the old ⏰ name prefix and its two-renames-per-ten-minutes
rate limit are gone.

None of the three forum tags carries an emoji. **Location** is the strongest
and is applied only by the sync: a Persistent post survives the wipe but is
*emptied*, while a Location post keeps its starter forever and loses only its
replies. `/persistent` refuses to touch a sync-owned post, checked against the
recorded thread ids rather than the tag, so a hand-edited tag opens no hole.
`db/lib/persistence.js` owns all three names.

`/persistent` is documented in `COMMANDS.md`; it writes a
`thread_persistence_changed` audit row.

### Quest posts

**Quest** is the third tag, and the GM-made counterpart of a Location topic. A
GM presses Discord's own **New Post** button in a location forum and types the
hook; `bot/src/lib/questPost.js`, hooked in ahead of the proxy gate in
`bot/src/events/messageCreate.js`, deletes that post and immediately re-creates
it verbatim **as the bot** — same title, same text, tagged Quest, starter
message pinned in-thread — then records it as a `PlayerThread` with
`persistent: true, keepStarter: true`.

Three things make the trigger safe without a role check. Players are denied
`CREATE_PUBLIC_THREADS` on every location forum, so a hand-made post is a GM's
by construction. Every legitimate bot-made post (the Location topics, the
anchor, a player's topic) arrives with a bot author, which `messageCreate`
filters out first. And the hook sits **before** `isDesignatedTupperChannel`, so
a GM who also has a living character never has their starter proxied — deleting
a forum post's starter message would destroy the post.

It is **text only**: attachments are not re-uploaded, and the GM gets a DM
saying so rather than a silent loss. An image-only post can't be re-sent at all
(Discord refuses a forum post with no body), so that one is left standing and
explained by DM. The replacement always goes up *before* the original comes
down, so a failed create costs nothing.

At Dawn a Quest post is treated exactly like a Location topic — replies
cleared, starter kept — and the wipe never deletes it. `/persistent` refuses to
toggle it. **Inactivity expiry still applies**, so a hook nobody answers for
`THREAD_EXPIRY_TURNS` turns still ages out; one reply resets that clock.
Otherwise it goes away when a GM deletes it by hand. The audit row is
`gm_quest_created`.

### Inactivity expiry

`db/lib/threadExpiryPass.js` runs at every Dawn, after the Dawn wipe. The
wipe already deletes every non-persistent `PlayerThread` outright, that same
Dawn (§8) — so by the time this pass runs, the only rows left to find are
`persistent: true` ones. This pass exists purely to age those out: any
`PlayerThread` with no messages for `THREAD_EXPIRY_TURNS` turns (hardcoded,
5) is deleted — thread, row and invites. Location topics and the anchors
have no `PlayerThread` row, so they are structurally exempt; there is no
exclusion list to keep in sync.

The clock is **turns, not wall time**, and it lives on the row rather than in
Discord: a persistent thread is emptied nightly, so "no messages for N turns"
cannot be read back out of it. `bot/src/events/messageCreate.js` writes
`lastActivityTurn`/`lastActivityAt` live (debounced), and before deleting
anything the pass cross-checks the thread's `last_message_id` snowflake, so a
message the bot missed while disconnected still counts.

## 5. The ghost seat

The Cursed role — a dead player, not yet buried or engraved — gets
`ViewChannel` plus `AddReactions` and a deny on everything else, including
`ManageThreads`. Reactions are allowed where the spectator seat denies them,
because the 🌬️ whisper (`COMMANDS.md` §6) is a ghost's only voice.

**Ghosts now see every zone**, cave levels included — the Depths blackout and
its `DEPTHS_SLUGS` exclusion list are gone. They read `#watch` and `#intercom`
too (each special-channel entry declares `ghostsMaySee`). Private threads stay
invisible to them the way they are to any non-member; no overwrite is needed to
keep that so.

**The role's colour is part of the seat.** It is pinned to `0` (Discord's "no
colour"), never hoisted, by `ensureCursedRoleAppearance` — re-asserted on every
zone sync and every doctor run. A coloured cursed role paints its holders'
names in the member list, which outs who is dead at a glance: exactly what a
concealed ghost seat must not do.

## 6. The channel doctor

`db/lib/channelDoctor.js` is the reconciliation sweep that makes this system
self-healing instead of drift-until-someone-notices. It compares what the
database says the game looks like against what Discord actually shows, reports
every mismatch, and — with `apply` — repairs it. **Dry run by default.**

Two scopes:

- **cheap** — role membership only (zone roles vs `Character.zoneId`, turn-ping
  vs `turnPingOptIn`, cursed vs the dead-and-not-yet-rerolled set), character
  roles existing/orphaned, and the structural checks: zone channels and roles
  exist, the **bot's own highest role sits above every zone role** (or the
  swaps 403 — report-only, moving roles is a human decision), cursed colour 0,
  and no seat-scoped `zoneId` pointing at a cave level. One member-list read plus a handful of requests.
- **full** — all of the above plus the expensive halves: channel overwrites vs
  the spec, leftover per-member overwrites on zone channels, `PlayerThread`
  rows whose threads 404, dead `PlayerThreadInvite` rows, the special
  channels' member overwrites vs the registry rules, and `#turns`'s own
  overwrites vs `db/lib/turnsChannelAccess.js` (§3a).

Where it runs: **cheap + apply on every bot ready** (`bot/src/events/ready.js`),
after every turn advance when `GameConfig.autoReconcileEnabled` is on, as the
final step of Restart Game, from the Dev Panel's System Reports buttons (full
scope, dry or repair), and from a terminal with `npm run db:doctor`
(`-- --full`, `-- --apply`).

Every check is independently caught and the whole run is persisted as a
`SystemReport` (`kind: DOCTOR`) the Dev Panel renders. That is the structural
answer to the old wipe-time complaint: instead of hoping every removal in a
hundred-call loop lands, a miss becomes visible and repairable.

## 7. Special channels (`#watch`, `#intercom`, `#mindlink`)

Standing channels outside the zone system, under one `radio` category (id on
`GameConfig.radioCategoryId`). `db/lib/specialChannels.js` is a **registry**:
one entry fully describes a channel — its `GameConfig` id columns, topic,
tupper routing, wipe behaviour, ghost visibility, static role grants, an
optional `slowmode`, and the per-character access rule. Adding a future
special channel is one entry plus one `GameConfig` column.

The rules stay **code**, deliberately: a special channel's access condition is
real logic over tags and zones, and a YAML mini-language would only be a worse
programming language. What the registry buys is that the logic lives in one
self-contained object instead of being smeared across a provisioning script,
two access twins and the wipe.

| Channel | Who sees it | Who speaks |
|---|---|---|
| `#watch` | **Radio Bracelet (Watch)** or **Radio System (Watch)** holders (per-member overwrite) | Radio System (Watch) holders only |
| `#intercom` | **every zone role except the Windlands** — five presence zones, a static `roleViewZones` grant; the hurricane winds drown the PA out there | a character holding the **Intercom** tag *and* standing in the **Fortress** zone (per-member overwrite) |
| `#mindlink` | any **Cultist of Bacchus** (`follower-of-bacchus`) holder (per-member overwrite) | **Mindlink** tag holders only |

Both tags are transferable, so possession is what matters — a bracelet handed
to a non-Watch character still opens `#watch`.

`#intercom`'s role-based view is the fix for a real scaling problem: its old
per-member view overwrite spanned a whole Zone and was drifting toward
Discord's ~100-overwrite-per-channel ceiling. Five role entries replace ~100
member entries. The speak half stays per-member, and its gate moved from
"standing in the Keep" to "standing in the Fortress zone" because the Keep is
prose now. The Windlands is deliberately off the list — the hurricane winds
drown the PA out, so a character standing there can't hear `#intercom` at
all. The sync enforces both halves: it grants the listed zone roles view
*and* deletes any zone-role grant the registry no longer lists, so dropping a
zone from `roleViewZones` really silences the channel there on the next run.

`#mindlink` is Bacchus's own telepathy — every Cultist reads it, but only a
Cultist holding the **Mindlink** tag can post. It carries a `slowmode` of
1800 seconds (30 minutes), the first special channel to set one; nothing else
in the registry does, so `entry.slowmode` is optional and only applied when
present.

`db/lib/syncSpecialChannels.js` provisions and **reconciles every run** (topic,
slowmode, `@everyone` deny, GM allow, spectator, ghost, and the
`roleViewZones` grants) — a channel that misses its role grants is a channel
nobody can hear. Channel identity (name, id) stays one-time, and a same-name
channel that already exists is adopted rather than duplicated. Run it with
`npm run db:sync-narrowcast-channels` — **after** `db:sync-zones`, since the
grants name zone roles the zone sync may have just recreated.

Per-character access is applied by the two `syncCharacterNarrowcastAccess`
twins: `bot/src/lib/zoneTravel.js` (gateway, after every zone change and after
`/heal` moves a tag) and `web/lib/discordGuild.js` (REST, from the web travel
action, GM raw edits, Bulk Move, character creation and `grantTag`/`revokeTag`).
Both build the context with `buildNarrowcastContext` and run
`computeNarrowcastAccess` against the registry.

## 8. Wipes: three of them, and what survives

| Pass | When | What it does |
|---|---|---|
| **Dawn wipe** (`db/lib/dawnWipe.js`) | every turn that opens with `phase === "DAWN"`, if `GameConfig.messageWipeEnabled` | clears roleplay content per the table below |
| **Thread expiry** (`db/lib/threadExpiryPass.js`) | every Dawn | deletes idle persistent player threads (§4) |
| **Full wipe** (`db/lib/fullWipe.js`) | Restart Game only | spares nothing (`LAUNCH.md`) |
| **`#turns` sweep** (`db/lib/turnAnnouncement.js#postTurnsConsole`, via `dawnWipe.js#clearMessagesExcept`) | every turn, Dawn or Dusk | deletes everything in `#turns` except the console message just posted — a stray GM post, an orphaned console from before a config reset |

`#turns` is **not** in `SPECIAL_CHANNELS` and the Dawn wipe never reaches it —
it is one rolling message (the turn announcement, weather banner, and player
console) that gets deleted and reposted every turn regardless of
`messageWipeEnabled`, so its sweep runs on that same cadence rather than the
Dawn-only one above. It is best-effort: a sweep failure is logged but never
costs the turn announcement that already went out. Its *access* is managed
though — see §3a.

Both Dawn passes are wired into `db/index.js#advanceTurn()`'s side-effect
thunk, so they fire identically whether Dawn came from the bot's twice-daily
cron or a GM's "End Turn" button. Expiry runs **after** the wipe on purpose, so
a thread the wipe just deleted isn't also "expired".

**The Dawn wipe only deletes.** The transcript is recorded at *send* time
(`db/lib/archive.js`, read at `/archive` — `ARCHIVE.md`), so nothing here reads
message content and there is no `#archive` channel. Deleting is the cheap half:
`bulkDeleteMessages` moves 100 messages per request, and it splits by age
because Discord rejects an entire 100-message batch if a single member is over
14 days old. Location topics go through the same batching
(`clearThreadExceptStarter`); they used to be cleared one message per request,
which on a busy turn was the single largest cost in the whole pass.

**Every rule below is bounded by a cutoff, and that is the important part.**
The wipe takes a `cutoffMs` — the moment `advanceTurn()`'s side-effect thunk
began — and touches nothing created at or after it. A Discord snowflake carries
its own creation time, so this needs no exemption list and no stored message
ids: `fetchAllMessages` is handed a synthetic `before` snowflake, and a thread
newer than the cutoff is skipped whole.

Two things depend on it. The first is that the turn's own adjudication
survives: the staged public declarations and the Default Move summaries are
posted to `#summary` at the top of the same thunk that runs the wipe at the
bottom, and before the cutoff existed they were deleted seconds after landing —
`StagedMessage` stamped `sentAt`, so nothing showed it had happened. The second
is that a player posting *during* the wipe keeps their message. The wipe is
long and walks zones in order, so without a cutoff whether your post survived
depended on where you were standing.

Per target, for every zone including cave levels:

| Target | Dawn wipe behaviour |
|---|---|
| `#summary` | every message deleted |
| the Create-a-Topic anchor | **untouched** — the wipe does not reach into it at all |
| a generated Location topic | every message deleted **except the starter**, whose id is the thread's own id |
| a Quest post (`keepStarter: true`) | survives; every message deleted **except the starter**, and its Quest tag is re-asserted. Never deleted by the wipe — a GM removes it by hand |
| a player topic with `persistent: true` | survives, emptied; its Persistent tag is re-asserted (the DB is the truth, the tag only a mirror) |
| a player topic with `persistent: false` | deleted entirely — thread, row and invites |
| a post with **no** `PlayerThread` row | **adopted**: a row is written (`persistent: false`) rather than the post destroyed, so a GM's hand-made post gets one full turn and a visible record instead of vanishing |
| `#private` threads | the same `PlayerThread` rule, with no visible marker either way. Surviving keeps the thread's member list, which is the practical point of persistence there |
| every registry entry with `wipe: "clear"` (`#watch`, `#intercom`) | every message deleted |

**Each zone is wiped inside its own `try`**, so one stale channel id costs one
room rather than every room after it plus the special channels. The forum fetch
allows a 404 — a channel a GM deleted by hand is an ordinary state for a blind
sweep, not a reason to stop. The whole run is entirely sequential (no
`Promise.all` fan-out) to avoid bursting Discord's rate-limit buckets, and
lands on a `SystemReport` row (`kind: DAWN_WIPE`) the Dev Panel shows.

That report now carries a **per-step breakdown** — elapsed ms, Discord request
count, and time spent asleep on a rate limit, one row per zone and per special
channel, with the five slowest shown on the Dev Panel. The wipe is the longest
thing either face does, and before this nobody could say which part of it was
slow. Check the breakdown before optimising anything here; the answer has been
guessed at twice already.

Private-channel content **is** in the transcript. The privacy tradeoff is
handled by `GameConfig.archiveVisible` keeping `/archive` shut to players until
the game ends, not by the code.

**But the thunk does not run itself.** `advanceTurn()` returns every side
effect as one `runSideEffects()` thunk, because the wipe walks every zone's
channels sequentially and awaiting it inside the Dev Panel's server action held
the request open — and a pending server action blocks client-side navigation,
so the whole web app appeared to freeze. The bot's cron awaits the thunk
inline; the web action passes it to `next/server`'s `after()`. Channels
clearing out a little after the turn flipped is expected, not a stall.
See `TURN-ENGINE.md`.

## 9. Testing visibility: the guild owner always sees everything

Discord's permission system exempts the **guild owner** from every overwrite —
denies, category-level or channel-level, never apply to them. If the account
you're testing with owns the server (true for whoever ran the bot setup), every
category will look visible to you regardless of what is actually set, even with
zero bugs. To observe the gating, test from a non-owner account, or read the
raw overwrites over REST. `npm run db:doctor -- --full` is the faster answer:
it diffs the live overwrites against the spec for you.
