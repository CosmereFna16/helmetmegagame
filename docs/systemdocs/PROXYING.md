# Proxying: how a player's message becomes a character's

Every word a character says in Discord is a webhook repost of something a
player typed. This doc covers that pipeline end to end — proxying, avatars,
the reactions that act on a proxied message, concealment, mentions, and the
nickname that ties a Discord account to a character.

Companion to `CHANNELS.md` (which channels opt in) and `ARCHIVE.md` (where
the transcript is written).

## 1. Which channels proxy

Not configured by hand. A channel opts in **only** by being one of a zone's
provisioned channels, or a special channel whose registry entry says
`tupper: true`:

| Channel | Tupper | Summary |
|---|---|---|
| A zone's `#summary` (text) | yes | **yes** |
| A zone's `#public` (forum), or a cave level's forum | yes | no |
| A zone's `#private` (text) | yes | no |
| `#watch` / `#intercom` | yes | no |

`#watch`/`#intercom` aren't tied to a place, so they're never summary.

Two independent implementations of that rule, kept in sync by hand — the
gateway/REST twin pattern (`ARCHITECTURE.md` §3):

- `bot/src/lib/channels.js` — gateway cache.
- `web/lib/discordGuild.js` — `isSummaryChannel` / `isTupperChannel` /
  `listGuildChannels`, REST-based.

There is **no name-based marker**. Channel IDs are checked directly.

## 2. The proxy itself

`bot/src/events/messageCreate.js` auto-proxies every message from a user with
an `ALIVE` character in a tupper channel: it reposts through a per-channel
webhook (`bot/src/lib/proxy.js#sendAsCharacter`) under the character's name and
avatar, then deletes the original.

**No bracket or trigger syntax.** Each player has exactly one living character
at a time, so there is nothing to disambiguate.

`sendAsCharacter` sets `allowedMentions: { parse: ["users"] }`. That is
load-bearing for §6: a role mention still *renders* as a chip but notifies
nobody, so the relay DM is the single notification path.

`bot/src/lib/proxy.js#postAsCharacterTo(channel, character, {content, files,
discordUserId, conceal})` is the **core send** — webhook, tracking, no source
message. `sendAsCharacter` is the message-driven wrapper around it, and is the
only thing that deletes an original. The Speak modal (`COMMANDS.md` §5) has no
message to delete, only an interaction, which is why the split exists.

### The original is deleted on every path, including the failing ones

This is the load-bearing rule of the whole file. The game's premise is that a
player's account and their character are separate, and a message left sitting
un-proxied under a real Discord name breaks that premise for everyone reading
the channel. For `/conceal` it is worse still: the text they wanted anonymous,
over their real name.

It used to delete only after a successful send, so anything the webhook
rejected stayed on screen with nobody told — a message over 2000 characters
(Nitro types 4000; the bot's repost still has to fit 2000), an attachment over
the guild's upload limit, a sticker-only message, or a webhook a GM had
deleted. The first three are now refused *before* the send and the rest are
caught after it; either way the original goes and `handBack` DMs the player
their words, in pieces if the reason it failed was length.

**Losing a message is recoverable, and handBack recovers it. Losing the mask is
not.** `sendAsCharacter` returns `null` when it refused, and the delete is
logged rather than swallowed — a swallowed delete is the same leak by another
route.

The webhook cache un-learns an entry on Discord's `Unknown Webhook` code and
rebuilds once, keyed on the error code and never on its message text. The
`WebhookClient` itself is cached too: a fresh one starts with zero knowledge of
the rate limits it is about to hit, so building one per message meant N
simultaneous messages in a busy room fired N blind requests into a ~5-per-5s
bucket.

Tracking through `trackProxy` is not optional for either caller: every
reaction below is gated on `recentProxies`, so an untracked message is inert
to all of them.

`db/lib/discordRest.js#postAsCharacter` is the REST twin, used for Default Move
summaries posted from `advanceTurn`'s side effects.

**Speaking without being seen to type.** Discord fires the typing indicator
under the player's *real* account, before the proxy ever runs — so composing
in a channel announces who you are regardless of what the webhook posts. The
Speak flow (the 🔊 button on the `#turns` console, or `/message`) composes in
a modal instead: the text arrives as an interaction, and there is no typing
indicator and no message to delete. `/message` run inside a channel you can
already speak in posts straight there; that does not hide the typing
indicator, since you are already in the channel, but it does stop the message
existing in plain sight before the proxy removes it.

**`recentProxies`** is the in-memory map tying a proxied message back to its
player and character — last 500, single bot process, no sharding, wiped on
restart. Every reaction below reads it, so a bot restart makes older messages
inert to all of them. That is the safe direction: a stale mapping would let the
wrong person delete someone's message.

## 3. Avatars and letter plaques

Profile pictures are stored **as bytes on the row** —
`Character.avatarData`/`avatarMimeType`, resized and compressed with `sharp` at
upload — not in a third-party bucket, and served by the web app itself at
`/api/avatar/<characterId>`. The bot builds a full URL from `WEB_BASE_URL` when
it needs an `avatarURL` for a webhook.

Uploading is gated on `GameConfig.avatarUploadsEnabled` (Dev Panel, off by
default). `AvatarField.js` hides the file input when it's off, but the real gate
is `updateCharacterProfile` ignoring a posted `avatar` field regardless — a
server action is a public endpoint. Flipping the flag changes nothing about
existing `avatarData`.

A character with no uploaded picture gets a **letter plaque**: a teal-tinted
stone tile bearing a blackletter capital of the first letter of their **first
name** — never the honorific or the granted title, so `Sir Alder "the Blind"
Crane` gets an **A**. The 27 tiles (A–Z plus `_default`) live in
`web/public/assets/letters/`, generated by `web/scripts/generate-letters.js`
(`npm run assets:letters --workspace=web`) from
`web/public/assets/background.png` and the vendored
`web/assets/fonts/UnifrakturMaguntia.ttf` — the same face `--font-display`
uses, vendored as TTF because `sharp`'s pango renderer cannot read the `.woff2`
that `next/font/google` caches.

Two things about the generator are load-bearing:

- It **tints in a second `sharp` pass, alone**. Chaining `.tint()` with
  `.modulate()` in one pipeline silently drops the tint and yields a flat grey
  plate.
- It **trims each glyph, then fits it into a fixed box**. Blackletter capitals
  differ enough in width that one point size makes some tower over others.

Output is WebP, matching what an uploaded avatar is stored as — ~145KB for the
set instead of ~1MB as PNG.

**Nothing regenerates an avatar on rename.**
`web/app/api/avatar/[characterId]/route.js` picks the plaque at *read* time from
the live row, so a rename follows implicitly, and an uploaded `avatarData`
always wins so nobody's own picture is overwritten. The `?v=<updatedAt ms>`
cache-buster every caller appends is what gets past the route's `immutable`
header. An accented, non-Latin, numeric or empty initial falls through to
`_default.webp` rather than 404ing.

Every successful proxy (and `/speak`) also touches
`Character.lastActivityTurn` via `db/lib/characterActivity.js#touchCharacterActivity`
— the clock `db/lib/catatonicPass.js` reads to lift the Catatonic (AFK) tag.
It's a separate write from the `ArchiveEntry` above on purpose: the archive
row is best-effort and a ❌ reaction deletes it outright, neither of which
should un-flag the activity that already happened.

## 4. Reactions on a proxied message

All in `bot/src/events/messageReactionAdd.js`, all gated on `recentProxies`.

| Emoji | Does |
|---|---|
| ❌ | Deletes the message. Also deletes its `ArchiveEntry` row. Gated on `proxy.discordUserId`. |
| ✏️ | DM-based edit. Mirrors into the archive **only after** Discord accepts the edit. Gated on `proxy.discordUserId`. |
| ❓ | DMs the character's bio. |
| 🔍 | Inspect embed — see §5 and `FACTIONS.md` §4. |
| ⭐ | Saves a personal `Note` — see §7. |
| 🌫️ | GM-only fog. |

DMs no longer carry any reaction-driven flow; the bot does not request the
`DirectMessageReactions` intent.

The bot needs the `MESSAGE_CONTENT` privileged intent for any of this
(Developer Portal → Bot → Privileged Gateway Intents), alongside `GuildMembers`.

## 5. Concealed identity (`/conceal`)

A message in a tupper channel beginning `/conceal` is reposted under an
anonymous alias instead of the character's name.

**It is open to everyone** — nothing equipped, no tag required. A player
decides for themselves when to go unnamed. `Tag.concealsIdentity` still exists
in the catalog and is still synced but nothing reads it (`TAGS.md`); re-gating
would be one query in `messageCreate.js`.

It is a **literal text prefix, deliberately not a registered slash command**. A
slash command replies through an interaction rather than the webhook, so
✏️/❌/⭐/🔍 would all stop working on the result. As a prefix it rides the
ordinary proxy path and every reaction behaves unchanged.

The alias comes from `db/lib/concealedIdentity.js` (pure, in the barrel beside
`characterName.js`):

- `Young` / `Old` / nothing, from `Character.age` — under 25, 55+, nothing
  between, nothing when age is null.
- `Man` / `Woman` / `Person`, straight off `Character.gender`. NEUTRAL reads
  Person.

**This used to be inferred from the title**, which meant an untitled character
was always "Person" however they present, and so was a Captain. Gender is a
real column now (`CHARACTERS.md` §1c), so the alias simply says it: an untitled
woman conceals as "a young woman". Concealing hides the name, the face and the
faction — it was never meant to hide how someone presents, which is what the
line above has always claimed it carries.

The alias is frozen into `ArchiveEntry.concealedAlias` at send time, so a later
gender correction never rewrites the archive. That is correct: it records who
someone was as they were known then.

The avatar is `web/public/assets/unknown.png`, served straight out of `public/`
and **identical for everyone** — a per-character concealed avatar would be a
fingerprint.

`recentProxies` records `concealed`/`alias`, and three handlers read it:

- **🔍** returns a **hardcoded** embed *before* any of the normal field logic:
  the concealed line, plus only `visibleOnInspect` ailments and
  `visibleOnInspect` equipped gear. No appearance, name, Desire, or
  Resources, even for a viewer whose gates are open. "Ailments" resolves as
  `tag.category === "Health"` — Health is its own category now (`TAGS.md` §5c)
  and so *is* the ailment set, which is what this used to reach for the
  `status-health` group slug to approximate. Mind the capital: `Tag.category`
  stores the display name, not the YAML slug. The doctor's eye below does
  **not** apply here — a concealed subject stays deliberately impoverished, and
  a surgeon reading a hood is still just reading a hood.
- **⭐** files the alias in `Note.characterName` rather than the real name.

The unconcealed 🔍 path carries one rule worth knowing here, described in full
at `TAGS.md` §5c: **an affliction you could treat as routine is one you can
see**, even when it's `visible: false` to everyone else. A medic inspecting
someone gets their Appendicitis; the man beside them gets nothing. Those rows
are marked `· your diagnosis`, because the patient isn't showing it to the room
— repeating it aloud is saying something nobody else could know.
`db/lib/medicalVision.js` decides it, and a cure needing a Gambit stays hidden
even from an Expert, since guessing isn't diagnosing.
- **✏️/❌** are unchanged; both already gate on `proxy.discordUserId`.

The archive records **both halves** — `ArchiveEntry.concealedAlias` alongside
the real `characterId`/`characterName` — so `/archive` renders
`Young Man (Sir Alder)`. That is the one surface where concealment is undone,
which is why `archiveVisible` is meant to stay shut until the game ends
(`ARCHIVE.md`).

## 6. Mentions and private threads

A character's personal Discord role is a **mentionable name token and nothing
else** — held by nobody, granting nothing (`CHANNELS.md` §3). `Character.discordRoleId`
is `@unique`, so a mentioned role id resolves straight back to one character. Mentioning a GM/spectator/player role resolves to nothing
and is silently ignored.

`bot/src/lib/mentions.js` owns both things a mention does;
`bot/src/events/messageCreate.js` calls it after proxying.

**Mentions must be read before the message is proxied** — `sendAsCharacter`
deletes the original, taking `message.mentions` with it — but the jump link
needs the *proxied* message's id. So the order is **capture → proxy → relay**.

### The relay DM

**Pinging your own character does relay.** There used to be a filter dropping
the sender's own characters — nobody needs telling they pinged themselves —
but because the proxy suppresses the ping itself (§2), a self-ping was the one
case that looked exactly like a broken relay while working as intended, and it
is the first thing anyone reaches for to test the feature. A redundant DM to
yourself is much cheaper than a feature nobody can verify.

Every rejection on this path is a bare return. `handleMentions` logs one
`[mentions]` line per ping — the role ids, how many resolved, and each
target's gate outcome — so the Railway logs can tell "out of earshot" from
"resolved nobody" without a debugger.

Otherwise, gated so a ping can't carry further than a voice would. Without a gate,
pinging is a free cross-map signalling channel. Two rules, because the two
kinds of channel mean different things by "in earshot":

- **Zone channels** gate on the **zone** — which is exactly as loose as the
  room now: someone in the Square topic can shout for someone reading the
  Cathedral one.
- **The special channels** have no zone at all, so they gate on whether the
  target currently *hears that channel* — `computeNarrowcastAccess` from
  `db/lib/specialChannels.js`, keyed on `NARROWCAST_SLUGS` rather than a
  hardcoded pair, so a future entry is covered by adding it to the registry.

The DM carries **where and a jump link, never the message text**. A ping into a
private thread the target hasn't joined would otherwise leak the room's
content, and a `DirectMessage` row outlives the ❌ that deletes the message it
quoted.

**A concealed message relays nothing at all** — the room isn't meant to know
who spoke, and a DM naming the place would hand the target a thread to pull
on.

### Adding to a private thread

In a private thread, a mention also **adds that character's player to it**.
Discord does this for free today by auto-adding a mentioned role's members, but
that stops working the moment the roles have zero members, so the bot takes it
over.

`/add` and `/remove` are the same operation by command, both taking a **role
option** rather than a user option on purpose: the picker then names
characters, never Discord accounts, so inviting someone can't reveal who plays
them. Anyone already in the thread may add or remove, plus GMs.

**A mention is an invite, on the same contract as `/add`** (`COMMANDS.md` §2b):
a `PlayerThreadInvite` row is recorded, the Discord add is attempted now, and
if the target is standing somewhere else `applyPendingInvites` replays it the
moment they arrive. Discord still requires a thread member to be able to view
the parent channel — that view is the zone role now — so an out-of-zone add
would put a thread in their sidebar they can't open. The pinger is told who was
invited rather than notified (collected into one DM, not one per target), since
a proxied message has no interaction to reply to and silence would read as a
bug.

One thing worth knowing rather than fixing: removing a member the bot didn't
add needs `MANAGE_THREADS`, which comes from the bot's own role and is not
granted by `zoneChannelSpec` — `/remove` reports that failure rather than
silently timing out.

## 7. Notes (⭐)

Reacting ⭐ to a proxied message in any zone channel saves it as a personal
`Note` for whoever reacted. `handleStarReaction` upserts a row keyed on
`(discordMessageId, discordUserId)` with the sending character, a zone
snapshot, content, and `sentAt`. Same `recentProxies` constraint as every other
reaction.

**The bot always strips the reaction back off** right after processing
(`reaction.users.remove(user.id)`), for any user, on any message — so Discord
never shows an accumulating star count, and the note on `/notes` is the only
lasting record. There's no "react again to unstar"; unstarring is the web UI's
delete button (`unstarNote` in `web/app/(app)/notes/actions.js`), which just
deletes the row.

`/notes` is **strictly personal and identical for both roles**: every signed-in
user, GM or player, only ever sees `Note` rows matching their own
`discordUserId`. There is no shared or all-players view. Notes render as
sortable-by-time, filterable-by-zone cards over the shared list shell
(`DESIGN-SYSTEM.md` §7), not a table.

## 8. Nickname sync

Every `ALIVE` named character's Discord server nickname is kept as
`{base} | {characterName}`, where `characterName` is the **bare** name (first +
last, via `formatBareName`) and `base` is the player's own Discord display name.
Truncated to fit Discord's 32-char cap — **both halves shrink proportionally**,
not just one.

There is deliberately **no override** for either half. The character half is the
character's name and the base is who the player is on Discord; a hand-typed
preference for the base (`Character.preferredNickname`, removed) was a second
source of truth for the same 32 characters and nothing else.

Gated behind `GameConfig.nicknameSyncEnabled` (off by default). Clearing a dead
character's nickname is **not** gated (`CHARACTERS.md` §5).

**The nickname is the one surface where a title deliberately does not appear.**
The 32-char cap is shared between the two halves — roughly 14 each — and
`Sir Jorren "the Blind" Vask` is 27 characters on its own, so titling here
would truncate essentially every nickname in the guild to garbage. Both copies
of `buildNickname` are fed the bare name by their callers; neither slices a
title off itself.

**Nothing polls.** It is event-driven like everything else in the bot:

| Trigger | Caller |
|---|---|
| Discord username/display name changes | `bot/src/events/userUpdate.js` |
| Rejoin | `bot/src/events/guildMemberAdd.js` |
| Character created, saved on `/character`, or renamed by a GM | `web/lib/discordGuild.js#syncCharacterNickname` (REST) |
| Bot connect/reconnect | `bot/src/events/ready.js` → `syncNicknamesForGuild`, a one-time catch-up bulk pass, not a recurring tick |

`buildNickname()` is hand-duplicated between `bot/src/lib/nickname.js` and
`web/lib/discordGuild.js` — the same twin convention as `isTupperChannel`.

## 9. Where the code lives

| Concern | File |
|---|---|
| Proxy send (gateway) | `bot/src/lib/proxy.js` |
| Proxy send (REST) | `db/lib/discordRest.js#postAsCharacter` |
| Message pipeline | `bot/src/events/messageCreate.js` |
| Reactions | `bot/src/events/messageReactionAdd.js` |
| Channel opt-in | `bot/src/lib/channels.js`, `web/lib/discordGuild.js` |
| Concealed alias | `db/lib/concealedIdentity.js` |
| Mentions, `/add`, `/remove` | `bot/src/lib/mentions.js`, `bot/src/lib/commands.js` |
| Inspect gates | `db/lib/inspectVision.js` |
| Doctor's eye on inspect | `db/lib/medicalVision.js` (`TAGS.md` §5c) |
| Nickname | `bot/src/lib/nickname.js`, `web/lib/discordGuild.js` |
| Avatar route | `web/app/api/avatar/[characterId]/route.js` |
| Plaque generator | `web/scripts/generate-letters.js` |
| Notes UI | `web/app/(app)/notes/` |
