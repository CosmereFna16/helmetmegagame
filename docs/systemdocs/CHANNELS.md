# Discord Channel Schematic

How Discord channels get their behavior in Bascinet, and how visibility is
controlled. Two independent mechanisms are involved — channel *type/name*
(what the channel is for) and *role* membership (who can see it) — and they're
easy to conflate, so this doc keeps them separate.

Since Bascinet 2 a zone is a category plus a `#summary` channel, and a
character actually **stands** in a Location — one text channel per Location,
with Rooms as threads under it. `MAP.md` is the game side of the same change.

## 1. Tupper / summary opt-in

A channel opts into tupper/summary behavior by being one of a zone's or a
Location's provisioned channels (§2), or a special channel whose registry
entry says `tupper: true` (§7), matched by Discord channel **ID** — there is
no name-based marker, and channel names are otherwise meaningless to this
system.

| Channel | Tupper | Summary |
|---|---|---|
| A zone's `#summary` | yes | yes — adjudication results and staged public declarations post here |
| A Location channel (surface or cave level) | yes | no |
| `#watch` | yes | no — it is tied to no place, so there is no adjudication result to post there |

Two independent implementations check this: `bot/src/lib/channels.js`
(gateway cache, refreshed on ready and every 5 minutes) and
`web/lib/discordGuild.js` (`isSummaryChannel`/`isTupperChannel`, REST-based).
Keep them in sync if the rule changes.

The same refresh builds `channelContexts`: channel id → `{ zoneId, zoneName,
locationId, locationName, channelKind }`, so the proxy can stamp an archive
row with where a message was said without a DB round trip per message.
`channelKind` is one of `summary | location | watch | intercom` (a plain
string field, not a Prisma enum — see `ARCHIVE.md`). `intercom` no longer means
the channel of that name, which is gone: it is now what a PA broadcast is
filed as in the archive (§7a). A Room thread or a
Conversation reports its parent Location
channel's context and keeps its own name as the scene.

## 2. Zone and Location channel layout

Everything is provisioned by `db/lib/syncZones.js` from `docs/zones.yaml`
(`npm run db:sync-zones`, `SYNC.md`). The layout itself is described **once**,
by `db/lib/zoneChannelSpec.js#zoneChannelSpec` (the zone's category and
`#summary`) and `#locationChannelSpec` (one Location's text channel) — both as
create payloads — and both first-time provisioning and the every-run reconcile
build from them, so the two can never disagree.

**A zone** (Town, Fortress, Forest, Black Hills, Marshes, Underground) is a category and, for a
`SURFACE` zone only, a `#summary` channel:

| Channel | Type | Purpose | Notes |
|---|---|---|---|
| `#summary` | text | Abstracted, big-picture play. Adjudication results and staged public declarations land here. | 300s (5 min) slowmode — the slowmode is what stops it becoming a second moment-to-moment channel. Wiped at Dawn. |

The `CAVE_GROUP` row (Underground) owns the shared category and nothing else —
no `#summary`, no role. Each `CAVE_LEVEL` (Caves, Depths) has no channels of
its own either; its Locations' channels parent straight onto the Underground
category, interleaved across levels in
`level.sortOrder * 10 + location.sortOrder` order, so the three levels' rooms
sit together the way `docs/zones.yaml` lists them rather than clumped by
level.

**A Location** — where a character actually stands — is one text channel,
named after its slug, parented to its zone's category (or the Caves category
for a cave-level Location). Its topic is the Location's `description`
(truncated to Discord's 1024-character cap). Top-level messages in it are the
Location's open street; its Rooms (§4) are threads under it that only the bot
may create. It is opened by a per-member overwrite, not a role (§3).

**Creation is one-time; a lot is reconciled every run.** The sync only creates
a channel/category/role whose id column is null, and channel *names* are
never touched again — renaming a zone or Location in the YAML does not rename
a live channel. But for everything already provisioned it re-applies channel
**topics** and slowmode, the full set of **permission overwrites**, category
and channel **ordering**, each Location's **Room threads** and **pinned
anchor** (§4), and the cursed role's colour. So `npm run db:sync-zones` is the
repair path for a zone or Location whose channels drifted.

> **Ordering: `parent_id` must not ride along in a bulk position call.**
> Positions are bulk; reparenting is not — Discord rejects the whole request
> with `400` code `40009`, *"Only one channel can have a parent_id modified at a
> time"*. So a channel that drifted out of its category is repaired first with
> its own `PATCH`, and only when the live tree says it is actually misplaced.
> Categories are sorted by zipping YAML order onto the position slots those
> categories already hold, so non-zone categories keep their places.

## 3. Visibility: two access roles, zone and Location

Every channel is hidden from `@everyone` and opened by one of **two**
different mechanisms, and the difference matters.

A **zone role**, `Zone: {Name}` (e.g. `Zone: Town`), is a real Discord role,
created by the sync and held by every living character standing anywhere in
that zone. It opens `#summary`, `#turns` (§3a) and the narrowcast channels
(§7).

A **Location** opens its own channel with a **per-member permission
overwrite** instead — one `ViewChannel` grant per character standing there,
written directly onto the channel. There is no `Location: {Name}` role any
more, and nothing creates one.

> **Why the asymmetry.** There are 5 presence zones with locations in them but
> **56 Locations**, and Discord caps a guild at **250 roles** while capping a
> channel at **1000 permission overwrites**. A role per Location would have
> spent a quarter of the guild's role budget on geography, on top of one
> personal name-token role per living character, and broken outright somewhere
> past a hundred players. Overwrites have no ceiling this game can reach. The
> cost is that an overwrite is invisible in the member list and has no
> equivalent of `db:prune-orphan-roles`, which is why the doctor's occupancy
> check (§6) exists.

Either way a Location's Rooms inherit channel visibility the way any thread
does, and a character always has exactly one zone role and exactly one
Location overwrite while alive. Travel swaps both as needed (§ below); nothing
else grants access to either.

> **`managedOverwriteIds()` must never learn to delete a member target.**
> `db/lib/syncZones.js` reconciles each channel's overwrites against a spec,
> and that function is the allowlist of targets it is permitted to DELETE. It
> contains only role ids. A wildcard there — or a member id finding its way
> into it — would evict every player from every Location on the next sync.

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

On top of that: the zone role gets `ViewChannel` + `SendMessages` +
`AddReactions` on `#summary`. Each character standing in a Location gets
`ViewChannel` + `SendMessages` + `SendMessagesInThreads` + `AddReactions` on
that channel, as a member overwrite (`LOCATION_MEMBER_ALLOW` in
`db/lib/zoneChannelSpec.js`) — top-level talk is allowed (the open street),
and thread talk covers both a public and a private Room. Note that this grant
is **not** part of `locationChannelSpec`: the spec is the channel's standing
shape, and who is standing there changes every turn.

**Room and Conversation creation is denied to `@everyone` on every Location
channel.** `CREATE_PUBLIC_THREADS` and `CREATE_PRIVATE_THREADS` are both
denied, while `SEND_MESSAGES_IN_THREADS` stays open — so players can talk
inside any thread they can see but can never open one themselves. The bot
alone creates a Room (the sync, from `docs/zones.yaml`) or a Conversation (the
Converse button, §4). Players hold no create permission anywhere, which is
what keeps `PlayerThread` a complete record of every Conversation that exists.

**Per-member overwrites on zone and Location channels are gone.** The old
model added a `ViewChannel` overwrite keyed on `Character.discordUserId` to
every channel of a Location and removed it from the old one. Two role calls
now replace many overwrite writes per hop, and the channel doctor treats *any*
member overwrite on a zone or Location channel as a stray to be deleted (§6).
The only surviving member overwrites in the game are the special channels'
grants (§7) and each private Room's thread membership (§4).

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
alive: `dawnWipe`, `fullWipe` and the channel doctor all walk zone/Location
channels, `SPECIAL_CHANNELS` or `PlayerThread`, so a thread under a channel
none of them know about is never touched.

### One function does the Discord half of every location change

`db/lib/locationTravel.js#performLocationMove` does no Discord work — it's the
database half only (validation, the cooldown or the Move it files, dragging;
`MAP.md` §4). Every caller, whichever face it runs on, hands the result to the
same function for the Discord half:

`db/lib/locationMove.js#applyLocationMoveSideEffects(prisma, entry)` — grants
the member overwrite on the destination channel before deleting the one on the
origin, announces the crossing if the edge is a gate (`MAP.md` §2a), and (only
if the zone changed too) swaps the zone role and reconciles narrowcast access;
then
resyncs private-Room membership for wherever the character now stands
(`db/lib/roomAccess.js#syncCharacterRoomAccess`) and replays any standing
Conversation invites there (`db/lib/threadInvites.js#applyPendingInvites`).
Every call inside it is individually catch-logged, never thrown — the channel
doctor is the safety net for whatever one call misses.

It's pure REST, so the Travel button on `#turns`, `/location`, the web's
writers (creation, GM raw edit, GM Bulk Move, `MOVE_CHARACTER`) and the staged
"Relocate to" applied at the turn push all call it after their own DB write
has committed. Grant-before-revoke throughout, deliberately: an interrupted
swap leaves the player seeing two Locations for a moment (harmless,
self-healing) rather than none (a lockout a player can't diagnose).

Any new writer of `Character.locationId` must call
`applyLocationMoveSideEffects`. A raw Prisma write alone leaves the old
overwrite standing and the new one missing, and the player either sees the
wrong place or none.

### Death and departure

`db/lib/accessSweep.js#revokeAllCharacterAccess` strips every zone role (a
removal of a role the member doesn't hold is a no-op, so this costs less than
working out which ones they held from possibly-stale state) and sweeps their
member overwrites off every Location channel, zone channel and special
channel. Its callers are `killCharacter`, `guildMemberRemove` and
`wipeGameData`; any new path that ends a character must call it too.

**That overwrite sweep is load-bearing now, not tidy-up.** A Location grants
sight by overwrite, and an overwrite has no equivalent of the role strip
`db:prune-orphan-roles` performs — so this is the only thing that stops a
corpse from going on reading the room it died in. `allAccessChannelIds()`
already enumerates every Location channel, which is why the shape did not have
to change when the roles went away.

`revokeAccessForCharacters` in the same file is the bulk form for Restart Game:
one paginated member-list read, then one removal per (member × zone role
actually held), plus a channel-major overwrite sweep — read each channel once,
delete only what's actually on it. That's what keeps a full-roster wipe at
hundreds of calls instead of tens of thousands. Both return counts and failure
lists rather than nothing, because a revoke that silently fails leaves a
departed player still reading rooms.

## 4. Anchors, rooms and conversations

### The pinned anchor

Every Location channel carries one pinned anchor message, hash-reconciled on
`Location.anchorHash` (body + its button row) so a re-sync with no YAML edits
makes no Discord writes at all (`db/lib/syncZones.js#syncLocationAnchor`, the
successor to the old `zoneAnchorRow.js`). A body change is edited in place; a
message a GM deleted by hand 404s and gets reposted. Its shape
(`buildAnchorBody`, `db/lib/locationAnchorRow.js`):

```
**Square**
-# An open clearing — …

**Public Rooms**: <#t1> | <#t2>
[Who's here?] [Secret rooms?] [Converse]
```

Private Rooms are deliberately absent from the index — **Secret rooms?** is
what surfaces those. The three buttons (`loc:who:{id}`, `loc:secret:{id}`,
`loc:converse:{id}`, all keyed on the Location's id) are routed by the bot.
Rooms are synced **before** the anchor, since the anchor body embeds their
thread mentions.

### Rooms: public and private

A Room is a thread under its Location's channel, authored in `docs/zones.yaml`
(`SYNC.md`) and owned end-to-end by the sync — **players cannot create one.**
Public rooms are ordinary public threads; private rooms are non-invitable
private threads (`Room.accessTagSlugs` non-empty makes a room PRIVATE), never
locked, so nothing here stops the roleplay inside once you're in. Both
auto-archive after 10080 minutes (a week) idle, and the sync re-asserts
`archived: false` on every run — so a Room that idled into the archive comes
back at the next `db:sync-zones`, not seven days of dead air.

Each Room's first message is its body (name + description) plus a button,
**Storage** (`db/lib/roomStarterRow.js`, `room:storage:{id}`), which prints
what is lying in the room's stash — every Room holds unlimited ⬢ and tags,
moved through the web's Transfer and surviving the Dawn wipe since they live
in the database (`CARRY.md` §5). The message is reconciled by content hash on
`Room.postHash` (body + button row); a changed body is rewritten **in place**
(clear every reply but the starter, edit it, re-post overflow). Because a
thread's starter has its own message id, distinct from the thread id itself —
unlike a forum post, where they're the same — `Room.starterMessageId` is
tracked separately, and it's what the Dawn wipe clears down to (§8) rather
than the thread id.

**Private-room membership is pull-based, not pushed from a tag writer.**
`db/lib/roomAccess.js#syncCharacterRoomAccess(prisma, character)` recomputes,
for every PRIVATE room, whether the character should be a thread member: any
of `Room.accessTagSlugs` held — **or** a `RoomGuest` row (§4a) — **and**
standing in that Room's Location adds them; anything else removes them. It's called from both travel side-effect
paths (§3) and from every existing call site that already calls
`syncCharacterNarrowcastAccess` when tags, location or life status change —
`/heal`, a character joining the guild, and the ~15 web request/GM-action
writers that grant, revoke, consume, transfer, heal, loot, bind, free or harm
tags. A miss is logged and left for the doctor's `room-membership` check (§6)
to catch and repair. Hold the Baron's Key and you're admitted to The Charon
the moment you next arrive or the key changes hands — there is no separate
"open the door" action.

### 4a. Room guests: `/add` in a private Room

A key is not the only way in. Somebody already inside a private Room can
`/add` a character standing in the same Location, which writes a **`RoomGuest`**
row and lets them in at once — the Baron waving a visitor into his office.

- **Who may work the door:** anyone already in the room, or a GM. Membership
  is pulled from standing there with a key or a guest row, so "in the room" is
  already exactly the set the fiction wants; there is no separate owner.
- **The target must be standing in the Location.** The grant is spent on
  leaving (below), so inviting somebody across the map would hand them a row
  that dies before they ever saw the door.
- **The grant is spent when they leave.** `syncCharacterRoomAccess` deletes
  every `RoomGuest` row whose Room is not where the character now stands, and
  every mover already calls it with the destination — so walking out of the
  Keep is what shuts the door behind you. A guest who comes back needs a fresh
  `/add`. This is the one way room access differs from a key, which readmits
  you forever.
- **`/remove` refuses a key-holder**, and says so: *"Their key admits them.
  Take the key."* Removing them would undo itself on their next arrival or tag
  change, so the honest answer is that the key is the thing to take.
- **A guest gets full reach**, not just the thread: the stash, the Transfer
  dialog, the Storage button, workshop and surgical equipment standing in the
  room, and corpse handling. That falls out of `accessibleRooms()` being the
  one predicate behind all of them (below) — being in the room is being in the
  room.
- **The target is DM'd** where they were let in, plus a link. Discord's own
  "added to a thread" notice is easy to miss and says nothing about where. The
  Conversation `/add` sends the same DM, so the two feel alike.
- Death and departure spend every grant
  (`accessSweep.js#revokeAllCharacterAccess`).

> **`accessibleRooms(rooms, heldSlugs, guestRoomIds)` is the one door.** It
> answers for the Storage button, the Transfer dialog, `/character`'s room
> list, **Secret rooms?**, the Converse picker, corpse placement, equipment
> reach and the doctor's `room-membership` check. Any new reader loads both
> halves with `roomAccessKeys(prisma, characterId)` — passing keys but not
> guests is how a guest ends up standing in a room the Transfer dialog says
> they cannot touch.

### Conversations

A **Conversation** is the one thread a player can open: a private thread
linked to a Room, created from the anchor's **Converse** button and tracked as
a `PlayerThread` row (`locationId`, optional `roomId` — the room the
whispering is heard in, §below). `/add` and `/remove` work here too, and the
handler tells the two apart by the channel: a `PlayerThread` row means a
Conversation, a `Room` row means §4a. A Conversation's `/add` is the looser of
the two — it takes a character wherever they stand, and a standing
`PlayerThreadInvite` is replayed the moment its target next arrives at the
Conversation's `locationId`
(`db/lib/threadInvites.js#applyPendingInvites`) — Discord refuses to add a
member who can't see the parent channel, so the invite waits for them to be
able to.

Leaving a Location does **not** drop you from a Conversation you're already in
— you stay a member, exactly as before. There is no more per-message
`/conceal` prefix, no `persistent` flag, no forum tags, and no inactivity
expiry on a Conversation: every one of them is wiped clean at the next Dawn
(§8), so nothing needs to age out on its own.

**The whisper poll.** Every 15 minutes, each Conversation linked to a Room
posts one line into that Room naming who's been talking in it — "A young man
and an old woman are whispering…" — built from `ArchiveEntry` rows in the last
15 minutes (up to 5 named, then "and others"), aliased the same way a
concealed message is, so the Room never learns who's actually inside.

**Who's here?** names the characters standing in the Location: the concealed
ones only as what a stranger could tell at a glance, and anyone wearing a
forced identity (`Tag.forcedName`, `PROXYING.md` §5) under that name with no
Role.

### What's gone

Persistence, the three forum tags, `/persistent`, quest posts
(`bot/src/lib/questPost.js`) and inactivity expiry (`threadExpiryPass.js`) are
all retired — a Conversation has no long-lived form any more, and a
GM-made off-catalog thread is simply adopted by the Dawn wipe the same way an
ordinary unknown thread is (§8). The web `/map` panel is gone too (`MAP.md`).

## 5. The ghost seat

The Cursed role — a dead player, not yet buried or engraved — gets
`ViewChannel` plus `AddReactions` and a deny on everything else, including
`ManageThreads`. Reactions are allowed where the spectator seat denies them,
because the 🌬️ whisper (`COMMANDS.md` §6) is a ghost's only voice.

**Ghosts now see every zone**, cave levels included — the Depths blackout and
its `DEPTHS_SLUGS` exclusion list are gone. They read `#watch` too
(each special-channel entry declares `ghostsMaySee`). Private threads stay
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

- **cheap** — role membership (zone roles vs `Character.zoneId`, turn-ping vs
  `turnPingOptIn`, cursed vs the dead-and-not-yet-rerolled set), character
  roles existing/orphaned, **`location-occupancy`** (below), a
  **`connection-slug`** check that every tag and Role a `LocationLink` names
  actually exists in the catalogs — they cannot be foreign keys, because tags
  and roles sync *after* zones — and the structural checks: zone channels and
  roles exist, Location channels exist, a **`character-place` check** that
  `Character.zoneId` agrees with `location.zoneId` (repaired from the location,
  the authority), the **bot's own highest role sits above every zone role** (or
  the swaps 403 — report-only, moving roles is a human decision), cursed colour
  0, and no seat-scoped `zoneId` pointing at a cave level. One member-list read
  plus a handful of requests.

  **`location-occupancy` is the successor to the old Location-role membership
  check, and it matters more than that one did.** The member overwrites on a
  Location channel must be exactly the living characters standing there;
  extras are deleted and missing ones added. It is the only sweep that catches
  a location grant the move pipeline failed to swap, or one a dead character
  kept — an overwrite has no `db:prune-orphan-roles` to fall off through. It
  costs no extra requests, because the overwrites arrive on the channel object
  the structure pass already fetched.
- **full** — all of the above plus the expensive halves: zone and **Location
  channel overwrites** vs the spec (the *role* half; occupancy is cheap-scope),
  leftover per-member overwrites on zone channels, **`room-thread`** (a Room's thread exists and is
  unarchived — recreating a missing one is the sync's job, so this is
  report-only), **`room-membership`** (a private Room's actual thread
  membership vs who currently holds one of its `accessTagSlugs` **or a
  `RoomGuest` row** and stands in its Location, via `listThreadMembers`),
  **`room-guest`** (rows whose character is dead or has wandered out of the
  room's Location), `PlayerThread` rows whose threads
  404, dead `PlayerThreadInvite` rows, the special channels' member overwrites
  vs the registry rules, and `#turns`'s own overwrites vs
  `db/lib/turnsChannelAccess.js` (§3a).

Where it runs: **cheap + apply on every bot ready** (`bot/src/events/ready.js`),
after every turn advance when `GameConfig.autoReconcileEnabled` is on, as the
final step of Restart Game, from the Dev Panel's System Reports buttons (full
scope, dry or repair), and from a terminal with `npm run db:doctor`
(`-- --full`, `-- --apply`).

Every check is independently caught and the whole run is persisted as a
`SystemReport` (`kind: DOCTOR`) the Dev Panel renders. That is the structural
answer to the old wipe-time complaint: instead of hoping every removal in a
hundred-call loop lands, a miss becomes visible and repairable.

## 7. Special channels (`#watch`)

Standing channels outside the zone system, under one `radio` category (id on
`GameConfig.radioCategoryId`). There is one of them left.
`db/lib/specialChannels.js` is a **registry**:
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

The Radio tags are transferable, so possession is what matters — a bracelet
handed to a non-Watch character still opens `#watch`.

The sync still enforces `roleViewZones` in both directions: it grants the
listed zone roles view *and* deletes any zone-role grant the registry no longer
lists. Nothing currently uses the field — `#intercom` was its only client — but
that deletion half is why dropping the channel really silenced it.

### `#intercom` is gone; the PA is a button now

There used to be a second entry. `#intercom` was a standing channel every
above-ground zone role could see, and that a holder of the **Intercom** tag
could type into while standing in the Fortress.

It is now a button on the Council Room's starter post — which is what
`docs/zones.yaml` always said was on that table — broadcasting into every
zone's own `#summary` instead of into a channel of its own (§7a). That removed
the channel, the registry entry, the `roleViewZones` grant, the per-member
speak overwrite and the **Intercom tag**, which is deleted from
`docs/tags.yaml` and off the Baron's starting list.
`GameConfig.intercomChannelId` stays as an orphan column, the way
`mindlinkChannelId` did.

The reason is not tidiness. A PA you travel to is not a PA — the announcement
landed somewhere nobody was standing, and hearing it meant being in a channel
rather than in a room. Now it arrives where people already are.

### 7a. The intercom

`db/lib/intercom.js`. The **Intercom** button sits on the Council Room's
starter row (`db/lib/roomStarterRow.js`, keyed on `INTERCOM_ROOM_SLUG =
"council-room"`, hardcoded for the `roleIds.js` reason). It opens a modal, and
the modal posts one line into each zone's `#summary`:

```
@here You hear a voice from the intercom: {text}. ‡
```

**This is the one world-narration line that is NOT `-#` subtext**, and the
exception is deliberate. Everything else the world says is scenery and belongs
under the conversation; a PA is a loudspeaker. Delivering the loudest
notification Discord has in the quietest text it renders was backwards. Full
size also means the body may carry newlines safely — there is no per-line
prefix left to break, which is what `ambientLine` has to handle for everyone
else.

- **The gate is standing in the Council Room**, and nothing else. Getting into
  the Keep and up to that table is the whole barrier. Re-checked at *submit*,
  never at open — an ephemeral modal outlives somebody walking out of the Keep.
- **The button must not be `ack()`'d.** `showModal` **is** the acknowledgement,
  and a deferred interaction can no longer open one (`COMMANDS.md`), so the
  button handler does no database work at all.
- **The Black Hills do not hear it** (`OUT_OF_RANGE_ZONE_SLUGS`, the slug
  `east-forests` — it never moved when the zone was renamed). The barony's writ
  thins out across the river and no speaker was ever strung that far. The cave
  levels need no exclusion: they have no `#summary`, so the rock swallows the
  PA for free.
- **Sequential fan-out, each zone individually caught.** Never `Promise.all`
  this (`TURN-ENGINE.md`). A run that reached four zones of five says so to the
  speaker rather than swallowing it.
- **`allowed_mentions: { parse: ["everyone"] }`** — the one place this game
  uses a channel-wide ping. It does two jobs: it lets the `@here` through, and
  it makes every user and role ping a player types into the box inert, the same
  posture `proxy.js` takes with character speech pointed the other way. The
  modal caps the body at 1200 characters so the message never chunks, because
  chunking would ping `@here` once per chunk.
- **Archived.** One `ArchiveEntry` per broadcast (not per zone — it was one
  thing said, heard in several places), `channelKind: "intercom"`, naming the
  speaker even though the channel line names nobody. The old `#intercom` was a
  tupper channel, so its traffic was proxied and archived; a bot post is not,
  and without this the PA would be the one kind of public talk missing from
  `/archive`.
- Audited as `intercom_broadcast`.

`#mindlink` used to be the Cult of Bacchus's own telepathy channel, and set
the `slowmode` field — `entry.slowmode` is still optional on a registry
entry and only applied when present, but nothing currently in the registry
uses it. `#mindlink` is gone along with the Cult, archived in
`docs/archive/bacchus.yaml`.

`db/lib/syncSpecialChannels.js` provisions and **reconciles every run** (topic,
slowmode, `@everyone` deny, GM allow, spectator, ghost, and the
`roleViewZones` grants) — a channel that misses its role grants is a channel
nobody can hear. Channel identity (name, id) stays one-time, and a same-name
channel that already exists is adopted rather than duplicated. Run it with
`npm run db:sync-narrowcast-channels` — **after** `db:sync-zones`, since the
grants name zone roles the zone sync may have just recreated.

Per-character access is applied by the two `syncCharacterNarrowcastAccess`
twins: `db/lib/locationMove.js#reconcileNarrowcastAccess` (REST, shared by bot
and web, run from `applyLocationMoveSideEffects` on every zone-crossing move
and from `/heal` when a tag moves) and `web/lib/discordGuild.js` (REST, from
the web travel action, GM raw edits, Bulk Move, character creation and
`grantTag`/`revokeTag`).
Both build the context with `buildNarrowcastContext` and run
`computeNarrowcastAccess` against the registry.

## 8. Wipes: three of them, and what survives

| Pass | When | What it does |
|---|---|---|
| **Dawn wipe** (`db/lib/dawnWipe.js`) | every turn that opens with `phase === "DAWN"`, if `GameConfig.messageWipeEnabled` | clears roleplay content per the table below |
| **Full wipe** (`db/lib/fullWipe.js`) | Restart Game only | spares nothing (`LAUNCH.md`) |
| **`#turns` sweep** (`db/lib/turnAnnouncement.js#postTurnsConsole`, via `dawnWipe.js#clearMessagesExcept`) | every turn, Dawn or Dusk | deletes everything in `#turns` except the console message just posted — a stray GM post, an orphaned console from before a config reset |

`#turns` is **not** in `SPECIAL_CHANNELS` and the Dawn wipe never reaches it —
it is one rolling message (the turn announcement, weather banner, and player
console) that gets deleted and reposted every turn regardless of
`messageWipeEnabled`, so its sweep runs on that same cadence rather than the
Dawn-only one above. It is best-effort: a sweep failure is logged but never
costs the turn announcement that already went out. Its *access* is managed
though — see §3a.

The Dawn wipe is wired into `db/index.js#advanceTurn()`'s side-effect thunk,
so it fires identically whether Dawn came from the bot's twice-daily cron or a
GM's "End Turn" button.

**The Dawn wipe only deletes.** The transcript is recorded at *send* time
(`db/lib/archive.js`, read at `/archive` — `ARCHIVE.md`), so nothing here reads
message content and there is no `#archive` channel. Deleting is the cheap half:
`bulkDeleteMessages` moves 100 messages per request, and it splits by age
because Discord rejects an entire 100-message batch if a single member is over
14 days old. Rooms go through the same batching (`clearMessagesExcept`, moved
into `db/lib/discordRest.js` so both the Location channel's own clear and a
Room's use it); they used to be cleared one message per request, which on a
busy turn was the single largest cost in the whole pass.

**Every rule below is bounded by a cutoff, and that is the important part.**
The wipe takes a `cutoffMs` — the moment `advanceTurn()`'s side-effect thunk
began — and touches nothing created at or after it. A Discord snowflake carries
its own creation time, so this needs no exemption list and no stored message
ids: `fetchAllMessages` is handed a synthetic `before` snowflake, and a thread
newer than the cutoff is skipped whole.

Two things depend on it. The first is that the turn's own adjudication
survives: the staged public declarations are
posted to `#summary` at the top of the same thunk that runs the wipe at the
bottom, and before the cutoff existed they were deleted seconds after landing —
`StagedMessage` stamped `sentAt`, so nothing showed it had happened. The second
is that a player posting *during* the wipe keeps their message. The wipe is
long and walks zones in order, so without a cutoff whether your post survived
depended on where you were standing.

Per target, for every zone including cave levels, and per Location in it:

| Target | Dawn wipe behaviour |
|---|---|
| a zone's `#summary` | every message deleted |
| a Location channel | every top-level message deleted **except the pinned anchor** |
| a Room | every message deleted **except the starter** (`Room.starterMessageId`); unarchived if it had idled into the archive |
| a Conversation | deleted outright — thread, `PlayerThread` row and its invites. There is no persistence any more |
| a thread newer than the cutoff | left entirely — a Conversation someone opened while this very wipe was running isn't destroyed mid-use; it comes under the ordinary rules next Dawn |
| an untracked thread (no `PlayerThread` row, not a Room) | **adopted**: a `PlayerThread` row is written rather than the thread destroyed, so a GM's hand-made thread gets one full turn and a visible record instead of vanishing |
| every registry entry with `wipe: "clear"` (`#watch`) | every message deleted |

**Each Location is wiped inside its own `try`**, so one stale channel id costs
one Location rather than every Location after it plus the special channels.
Fetching a channel allows a 404 — one a GM deleted by hand is an ordinary
state for a blind sweep, not a reason to stop. The whole run is entirely
sequential (no `Promise.all` fan-out) to avoid bursting Discord's rate-limit
buckets, and lands on a `SystemReport` row (`kind: DAWN_WIPE`) the Dev Panel
shows.

That report now carries a **per-step breakdown** — elapsed ms, Discord request
count, and time spent asleep on a rate limit, one row per zone's `#summary`,
per Location, and per special channel, with the five slowest shown on the Dev
Panel. The wipe is the longest
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

## The landing pad

`landing-pad`, a PRIVATE thread under the Depot Location's channel, authored in
`docs/zones.yaml` with `access: [depot-keycard]`. Membership is exactly "holds
the keycard", handled by `db/lib/roomAccess.js` and reconciled by the channel
doctor's room-membership check — the Depot feature adds **no access code of its
own**.

Its starter description is static and sync-owned like every other room's. The
shuttle arriving and leaving is announced as ambient lines into the Depot's
Location channel instead, because a hash-reconciled starter message is the
wrong place for live state.

See `docs/systemdocs/DEPOT.md` §0d.
