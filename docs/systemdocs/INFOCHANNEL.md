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
already used for `#turns`/`#location` — there's no hardcoded
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
`npm run db:rebuild-info-channel` is run by hand — same "never auto-synced"
posture as `docs/locations.yaml`, just without the upsert semantics (see §4).

## 3. Directory + thread structure

The message actually posted to `#info` is **not** just `main_message`
verbatim — the script appends a generated directory listing after it: for
each category, an optional bold heading line (`***{category name}:***`,
skipped when the category has no `name`) followed by one line per thread,
each a Discord thread mention (`<#threadId>`, which Discord renders as a
clickable `#thread-title` link). This listing can only be generated *after*
the threads exist, since thread IDs are assigned by Discord at creation
time — it's never hand-authored in the YAML.

Threads themselves are created as standalone public threads directly on the
channel (Discord's "no starter message" thread type), not threads-off-a-
message — the thread's `body` text is posted as its own first message right
after creation, by the same bot that created it.

## 4. Rebuild mechanics

`npm run db:rebuild-info-channel` (`db/prisma/rebuild-info-channel.js`) is
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

Unlike `sync-locations.js` (upsert by slug, never touches already-
provisioned state), this script has no notion of "already exists" — every
run throws away whatever is currently live in `#info` and reposts from
scratch. That's a deliberate simplification: `#info` is GM-authored front
matter, not player state, so there's nothing worth diffing or preserving
between runs. Re-running it is always safe and idempotent in effect (same
end state each time for the same YAML), even though the mechanism itself is
destructive.

**Message-length batching**: any `body` (or the combined directory message)
over Discord's 2000-char limit is split into multiple messages posted in
order, the same batching approach used anywhere a long body has to clear Discord's 2000-char cap — no
content is truncated.

## 5. Where the code lives

`db/lib/discordRest.js` (`startThread` and `postAttachment`, alongside the channel/message/thread
REST helpers `dawnWipe.js` already uses), `db/prisma/rebuild-info-channel.js`
(the script itself), `docs/systemdocs/infochannel.yaml` (content),
`npm run db:rebuild-info-channel` (entry point). No `prisma`/DB dependency —
`#info` has no DB-backed state, so this is REST-only, same posture as
`dawnWipe.js`/`turnAnnouncement.js`.
