# #info channel

How the player-facing `#info` channel gets its content, and how it's
rebuilt. Unlike every other Discord subsystem documented in this directory
(`CHANNELS.md`, dawn wipe), `#info` carries no gameplay state and no
player-generated content — it's a static directory the GMs maintain by hand
and push wholesale, so this doc is short: identification, content format,
and the rebuild mechanism.

## 1. Purpose & identification

`#info` is a plain text channel the whole guild can read, used as a landing
page: a directory message (game pitch + rules) followed by a set of topic
threads a player can jump into. It's looked up by exact name match
(`c.type === 0 && c.name?.toLowerCase() === "info"`), the same convention
already used for `#turns` — there's no hardcoded
channel ID anywhere in code, deliberately, so renaming or recreating the
channel doesn't require a code change. (For reference, the channel's current
ID is `1539629144801812641`.)

## 2. Content source of truth

`docs/systemdocs/infochannel.yaml` is the hand-authored source of truth —
see its own top-of-file comment for the full field-by-field schema. In
short: an optional `banner` (a path, relative to `docs/`, to an image posted
as a bare attachment), a `main_message` (the intro/pitch copy, posted
verbatim) and `categories`, each holding an optional `name` and an ordered
list of `threads` (`title` + `body`). Each `title`/`body` pair becomes one
standalone thread on `#info`; a category with a `name` becomes a heading in
the directory message grouping its threads' links, while a nameless
category's thread links are listed with no heading above them.

Editing the file has no effect on Discord until
`npm run db:sync-info-channel` is run by hand — same "never auto-synced"
posture as `docs/zones.yaml`, just without the reconcile semantics (see §4).

## 3. Directory + thread structure

The message actually posted to `#info` is **not** just `main_message`
verbatim — the script appends a generated directory listing after it: for
each category, an optional bold heading line (`***{category name}:***`,
skipped when the category has no `name`) followed by one line per thread,
each a Discord thread mention (`<#threadId>`, which Discord renders as a
clickable `#thread-title` link). This listing can only be generated *after*
the threads exist, since thread IDs are assigned by Discord at creation
time — it's never hand-authored in the YAML.

The **Fates** thread is the one generated body (`generated: roles-intro`).
It reads `docs/roles.yaml` and groups every fate into the same seven social
buckets `/character`'s picker uses — `db/lib/roleGroups.js`, imported rather
than restated, so the two can never disagree, and a role that overrides its
faction's bucket (the Fisherman) moves in both places at once. It prints **no
zone name at all**: it used to head each section with the zone, which told
every reader where the Brigands camp before the game had started.

Threads themselves are created as standalone public threads directly on the
channel (Discord's "no starter message" thread type), not threads-off-a-
message — the thread's `body` text is posted as its own first message right
after creation, by the same bot that created it.

## 4. Two ways to push it

### 4a. The rebuild

`npm run db:rebuild-info-channel` (`db/scripts/sync/rebuild-info-channel.js`) is
**always a full destructive wipe + rebuild**, run in this order:

1. Find `#info` by name (fatal error if missing — there's nothing else for
   this script to do).
2. **Wipe**: delete every top-level message in `#info`
   (`fetchAllMessages`/`bulkDeleteMessages`), then delete every thread on it
   — active and archived — one at a time (`deleteThread`, sequential, no
   parallel fan-out, same rate-limit-conscious pacing as `dawnWipe.js`).
3. **Banner** (if `banner` is set): post the image as a bare attachment.
   This happens *before* the threads are created, not merely before the
   directory message — Discord orders a channel oldest-first, and creating
   a thread emits its own system message into the timeline, so going first
   is the only way the banner is guaranteed to sit at the very top.
4. **Rebuild**: create each `infochannel.yaml` thread (`startThread`), post
   its `body` as the thread's first message, then post `main_message` +
   the generated directory listing as the new top-level message in
   `#info`.

**Attachments need multipart.** Discord accepts a file only as
`multipart/form-data`, so `discordRequest` — JSON-only by design — cannot
carry one. `postAttachment` in `db/lib/discordRest.js` builds the body by
hand: a `payload_json` part with the message object, plus one `files[n]`
part per file. The `attachments[].id` in `payload_json` is the **part
index**, not a snowflake, and must match the `files[n]` suffix or Discord
accepts the request and silently drops the file. The `Content-Type` header
is deliberately omitted so `fetch` can set its own multipart boundary.

Unlike `sync-zones.js` (matched by slug, never re-creates already-
provisioned channels), this script has no notion of "already exists" — every
run throws away whatever is currently live in `#info` and reposts from
scratch. That's a deliberate simplification: `#info` is GM-authored front
matter, not player state, so there's nothing worth diffing or preserving
between runs. Re-running it is always safe and idempotent in effect (same
end state each time for the same YAML), even though the mechanism itself is
destructive.

That simplification has one real cost, and it is the reason for §4b: **a
rebuild notifies everybody.** Deleting and re-creating a thread pings every
player who was following it, so fixing a typo announces itself to the whole
guild.

### 4b. The in-place sync — the default

`npm run db:sync-info-channel` (`db/scripts/sync/sync-info-channel.js`) does
the same job by **editing what is already posted**. Discord sends no
notification for an edit, so a normal content change is silent.

**The thread title is the match key.** Nothing anywhere persists a Discord
message or thread id — `#info` has no DB row of any kind (§5) — so the title
plays the part `slug` plays in every other sync. It is already unique, and it
is the thing a GM changes deliberately. The script refuses to run at all if
two threads in the YAML share a title, since matching would then silently
overwrite one with the other.

Per run:

1. Index every live thread on `#info` — active, archived public, archived
   private — by lowercased title.
2. **Matched**: un-archive if needed (you cannot edit inside an archived
   thread), then reconcile the body. The text is chunked exactly as
   `postMessageBatched` would have posted it; chunk *i* is edited onto the
   bot's *i*-th message in the thread, a chunk with no message to land on is
   posted, and any surplus message past the last chunk is deleted. **Identical
   content is skipped entirely**, so a no-op run costs nothing and leaves no
   "(edited)" marks.
3. **Missing**: created with `startThread` and its body posted, exactly as the
   rebuild does. This is the one case that notifies, and it should — a new
   thread is news.
4. **Orphans**: a live thread the YAML no longer names is reported and left
   alone. `--prune` deletes it. Nothing links it once the directory is
   rewritten, so leaving it is safe.
5. **Banner**: posted only when `#info` holds no attachment at all. An
   attachment cannot be edited in place, and reposting it is the exact
   notification this script exists to avoid.
6. **Directory message**: rebuilt and reconciled onto the bot's own top-level
   text messages by the same edit/post/delete-surplus pass.

Everything it writes is scoped to messages **the bot itself wrote**
(`DISCORD_CLIENT_ID`, the same identity `db/lib/channelDoctor.js` uses, with
`/users/@me` as a fallback). It never edits or deletes anybody else's message.

`--dry-run` prints the whole plan and writes nothing.

**What it cannot do is reorder.** A thread keeps the position Discord gave it,
so moving an entry up in the YAML changes the directory listing and not the
sidebar. A renamed title reads as "a new thread, plus an orphan" rather than a
rename. Both are the trade for a silent run, and both are what §4a is still
for.

**Message-length batching**: any `body` (or the combined directory message)
over Discord's 2000-char limit is split into multiple messages posted in
order, the same batching approach used anywhere a long body has to clear Discord's 2000-char cap — no
content is truncated.

## 5. Where the code lives

`db/lib/discordRest.js` (`startThread`, `postAttachment`, `editMessage`,
`chunkMessage`, alongside the channel/message/thread REST helpers `dawnWipe.js`
already uses), `db/lib/infoChannel.js` (the shared content half: the YAML load,
the `generated:` bodies, the directory message, finding the channel — no
writes), `db/scripts/sync/sync-info-channel.js` (§4b, the default) and
`db/scripts/sync/rebuild-info-channel.js` (§4a, the destructive one),
`docs/systemdocs/infochannel.yaml` (content), `npm run db:sync-info-channel` /
`npm run db:rebuild-info-channel` (entry points). No `prisma`/DB dependency —
`#info` has no DB-backed state, so this is REST-only, same posture as
`dawnWipe.js`/`turnAnnouncement.js`.
