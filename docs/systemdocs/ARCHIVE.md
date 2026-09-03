# Archive

The game's transcript. Every proxied character message is written to
`ArchiveEntry` **at send time** — `db/lib/archive.js#recordArchiveMessage`,
called from `bot/src/lib/proxy.js#sendAsCharacter` (gateway) and from
`advanceTurn`'s `runSideEffects` for Default Move summaries (REST) — and read
back on the web at `/archive`.

This replaced archiving at *wipe* time, which `db/lib/dawnWipe.js` used to do
by reading every message out of Discord and re-posting it into a single
`#archive` channel. That was the most expensive thing the bot did: one channel
is one ~1 msg/sec rate-limit lane, so a busy turn meant hundreds of sequential
posts, and it scaled with player count. It was also approximate — the character
was matched by *current* name (a rename mis-attributed everything they'd ever
said) and the turn was inferred by comparing timestamps against
`Turn.gameDate`. Recording at write time makes both exact and reduces the Dawn
wipe to deletes, which are the cheap half (100 messages per bulk request).
There is no `#archive` Discord channel any more.

`ArchiveKind` puts system events in the same table as messages so the two
interleave chronologically and the transcript reads as a diary rather than a
chat log with no context: `TURN_START` (the chapter divider, written in
`advanceTurn` where the turn is created rather than in `runSideEffects`, so a
failed announcement can't leave two days with no boundary), `CHARACTER_CREATED`,
`DEATH`, `DESIRE_FULFILLED`, `LIFEWEB`, and `TRAVEL`
— the last gated behind `GameConfig.archiveTravelEvents`, off by default,
since arrivals are what make a zone read like a story and also two rows per
character per turn before anyone speaks.

Five things about it are load-bearing:

- **The id columns are not foreign keys.** Same posture as `SiloTransaction`
  and `AuditLog`'s snapshots. `syncZonesFromYaml` destructively deletes any
  Zone dropped from the YAML and `wipeGameData` clears Characters — a real
  relation would either take the transcript with it or fail on FK ordering
  (which Restart Game has been bitten by once already). Plain indexed ids plus
  `zoneName`/`characterName` snapshots survive both, and the snapshot is
  the more correct record anyway: who someone was known as *then*.

  The place columns are **`zoneId`/`zoneName`** — a row records the zone it
  was said in, and the Room or Conversation it was said in is `threadName`.
  `channelKind` reads `summary | location | watch | intercom` (a plain
  string field, not a Prisma enum, so old rows can still say `mindlink`
  from before the Cult of Bacchus was archived).
- **Restart Game clears the table.** `wipeGameData` deletes every
  `ArchiveEntry` inside the same transaction as Characters and Turns, so a
  restart starts on an empty transcript. It is the one thing here that is not
  keyed off a Discord pass — the rows are the record, and no channel wipe
  touches them. (This was missed originally, and Restart Game left the whole
  previous game readable at `/archive`.) The Dawn wipe is the opposite: it
  deletes Discord messages and never the transcript, which is the entire point
  of recording at send time.
- **Every write is best-effort and swallows its own failure**, logged not
  thrown. `recordArchiveMessage` runs inline with the proxy send; a transcript
  row is never worth breaking a player's message over.
- **`❌` deletes the row and `✏️` updates it**, keyed on `discordMessageId`
  (`bot/src/events/messageReactionAdd.js`). Delete means gone, so a player can
  trust the button — the accepted cost being that the record is incomplete and
  someone can quietly retract what they said. The edit is only mirrored *after*
  Discord accepts it, or a rejected edit would leave `/archive` showing text
  that was never posted.
- **Attachments are a placeholder** (`[image]`/`[attachment]`) and nothing
  more. Discord's CDN urls now carry expiry parameters, so storing one would
  fill the archive with dead images; actually preserving them would mean
  downloading the bytes the way avatars are stored, a deliberate non-goal. The
  placeholder at least makes the gap visible rather than silent, which is what
  the old wipe-time archive did.
- **`discordChannelId` is a channel snapshot, not an FK** (same posture as the
  other id columns above). It's the channel the message was posted in — the
  THREAD's own id when it was said inside a thread, since that's what a jump
  link's channel slot needs — written by the bot's `resolveChannelContext`
  alongside `channelKind`/`threadName`. It has two jobs, and only one of them
  stays useful: the Dawn wipe deletes every Discord message every turn, so a
  jump link built from this id is only live for the turn it was posted in
  (Room threads survive, emptied to their starter). The whisper poll
  (`bot/src/lib/whisperPoll.js`) is its other reader: "who spoke in this
  Conversation in the last fifteen minutes" is one query on this column. The other job — exact channel-identity grouping
  for the desk's archive-context popup — works regardless of the wipe, since it
  never depends on the Discord message still existing. Rows written before this
  column existed are null and stay null; the backfill that filled some of them
  is gone, and pre-existing thread rows (`threadName` set) never had their
  thread id captured anywhere else anyway.

`/archive` (`web/app/(app)/archive/`) is **server-side paged over `?page=`**,
the second such surface after `/gm/audit` and for the same reason — a
finished game's worth of rows can't be a client-side `useTableState`. Sorted
oldest-first by default (it's a diary to read forward, not a log to skim), with
`id` breaking `sentAt` ties so a burst of same-millisecond messages can't put
one row on two pages. It renders as a reading experience rather than a table:
turn headers, scene headers per zone/thread, avatar + name + prose.

`GameConfig.archiveVisible` gates it — GMs always, players only when it's on,
enforced in the page and mirrored in the nav. It is **effectively a one-way
door** and is meant to stay shut until the game ends: the archive shows every
zone regardless of where a character stood, and renders a concealed message
as `Young Man (Sir Alder)`, so opening it retroactively unmasks every
`/conceal` ever used.

