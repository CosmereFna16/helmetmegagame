# Commands, buttons, modals and reactions

The full player- and GM-facing Discord surface. Behaviour lives in the system
doc for each subsystem; this page is the index of what exists and where its
handler is.

Everything is dispatched from `bot/src/events/interactionCreate.js`, except
reactions (`bot/src/events/messageReactionAdd.js`).

## 1. Registration

Commands are defined in `bot/src/lib/commands.js` and registered **globally**
via `client.application.commands.set()` in `bot/src/events/ready.js`.

Global rather than per-guild because a guild command cannot appear in the
bot's DMs, whatever contexts it declares. The cost is propagation: a new or
renamed command can take up to an hour to appear. Registration is a full
replace, so removing a command from the array deregisters it.

`registerCommands` also **sweeps every guild's own command list empty** on
each boot. That full replace only ever replaces the *global* list, so when
registration moved from per-guild to global, everything the old code had
written into the guild stayed there — and Discord shows both copies in the
picker. `/gm` `/message` `/add` `/remove` `/persistent` appeared twice, and
the four retired `/hunt` `/fish` `/farm` `/herd` were still listed with no
handler left to answer them. Since registration is global, an empty
guild-scoped list is the correct state, so the sweep enforces it. Don't add a
per-guild registration back — it would be invisible in DMs *and* duplicate
whatever the global list already has.

Each command declares its contexts:

- `Guild` only — needs a channel or thread to act on.
- `Guild` + `BotDM` — usable anywhere, including the bot's DMs.

## 2. Slash commands

| Command | Options | Who | Contexts | Handler |
|---|---|---|---|---|
| `/move` | — | Living character | Guild, DM | `handleMoveOpen` |
| `/location` | — | Living character | Guild, DM | `handleOpen` — the **zone** picker (§4) |
| `/message` | — | Living character | Guild, DM | `handleMessageCommand` |
| `/roll` | — | Anyone | Guild | `handleRollCommand` |
| `/add` | `character` (role) | Thread member or GM | Guild | `handleThreadMemberCommand` |
| `/remove` | `character` (role) | Thread member or GM | Guild | `handleThreadMemberCommand` |
| `/persistent` | — | Living character or GM | Guild | `handlePersistentCommand` |
| `/gm` | `message`, `attachment` | GM | Guild | `handleGmCommand` |
| `/dm` | `recipient` (user), `message` | GM | Guild | `handleGmDmCommand` |
| `/heal` | `character` (role) | GM | Guild | `handleHealCommand` |

Notes:

- `/move`, `/location` and `/message` are the twins of the three console
  buttons in §3. Each opens the same flow.
- `/message` run inside a channel the player can already speak in skips the
  destination picker and posts there. Anywhere else — including a DM — it asks
  where first. See `PROXYING.md`.
- `/roll` is one flat 1d6, with no options and no game effect — it settles
  things at the table, nothing more. It reuses `rollDie()` from
  `db/lib/moveEffects.js` rather than adding a second source of randomness.
  Guild-only, because a die rolled in a DM has no audience. The result is
  posted as a **plain bot message**, not as a public interaction reply: a
  public reply carries Discord's "@account used /roll" header, which names the
  player behind the character (`PROXYING.md`). So the roll goes out anonymous,
  and the roller gets a separate ephemeral telling them which one was theirs.
- `/labor` is retired too — laboring is now the **Labor checkbox** on the
  Move modal (`PRODUCTION.md` §3). A stub handler answers the stale picker
  entry during the propagation hour; delete it once the hour is past.
- `/dm` was named `/message` until `/message` became the player-facing speak
  command.
- Commands taking a character take a **role** option, not a user option, so
  the picker names characters rather than Discord accounts. The role is the
  character's personal name-token role (`CHANNELS.md` §3).

### 2b. `/add`, `/remove` and `/persistent` in detail

All three only work inside a thread, and all three changed with the zone
rework.

**`/add` works on any `ALIVE` character, wherever they stand.** There is no
zone gate. Discord refuses (or quietly sheds) a thread member who can't view
the parent channel, so the command records a **`PlayerThreadInvite`** row first
— that is what survives when the Discord add can't land yet — and then attempts
the add. If the target is already in this zone it lands immediately; otherwise
`db/lib/threadInvites.js#applyPendingInvites` replays it the moment they
arrive, and both travel twins call it (`MAP.md` §4). Adds are **silent**: the
REST thread-members endpoint is used rather than `channel.members.add`, which
would ping-mention them. Being brought into a room should be discovered, not
announced. Mentions into a private thread follow the same contract.

**`/remove`** deletes the invite row and then removes the thread member. If the
bot is missing `Manage Threads` the caller is told so, rather than seeing "the
application did not respond".

Both are open to anyone already in the thread, plus GMs — the same posture as
pinging someone in, which any participant can already do.

**`/persistent` toggles `PlayerThread.persistent`**, the database column the
Dawn wipe actually reads. On a forum post the Persistent tag is mirrored for
visibility (a failed mirror logs but never fails the command); a private thread
carries no marker at all. A thread with no row is **adopted** first, the same
posture the wipe takes.

It **refuses a sync-owned post** — a Location topic or a Create-a-Topic anchor
never wipes and never expires, and that isn't a player's to change. The check
is against the recorded thread ids, not the forum tag, so a hand-stripped tag
opens no hole. Its gate is a living character or GM, deliberately *not* the
thread-membership check `/add` uses: that would be wrong for a forum post you
can act on without having joined, and redundant in a private thread. Each use
writes a `thread_persistence_changed` `AuditLog` row. See `CHANNELS.md` §4.

## 3. The `#turns` console

The buttons ride on the rolling turn announcement — `#turns` is one message,
reposted each turn by `db/lib/turnAnnouncement.js#postTurnsConsole`, so the
console is always the last thing in the channel (see `TURN-ENGINE.md` for why
it stopped being three separate messages).

`bot/src/lib/turnsConsole.js#ensureTurnsConsole` runs on ready and is only the
cold start: it locks the channel down and posts the message if none exists —
a fresh guild, or a repost that failed. Restart Game used to be the common
case: it clears `#turns` and does not advance a turn, so the channel stayed
empty through Day 1. It now reposts the console itself
(`web/app/(app)/gm/dev/actions.js#finishGameWipe`), and this is the backstop
behind it. The buttons themselves are one shared definition in
`db/lib/turnsConsoleRow.js`, plain component JSON because the REST side (the
web Dev Panel's End Turn) and the gateway side both post it.

`@everyone` is denied `SendMessages` in `#turns`. Anything typed there is
deleted and files nothing.

| Button | Emoji | customId | Opens |
|---|---|---|---|
| Travel | 🗺️ | `loc:open` | The zone picker (§4) |
| Move | ⚜️ | `move:open` | The Move modal (§5) |
| Speak | 🔊 | `say:open` | The Speak picker (§5) |

Tracked on `GameConfig.turnsConsoleChannelId` / `turnsConsoleMessageId`.

## 4. Component custom IDs

`namespace:verb` for singletons, `namespace:verb:{id}` where an id is needed,
parsed by literal `startsWith` + `slice`.

| customId | Type | Does |
|---|---|---|
| `loc:open` | Button | Offer the connected zones |
| `zone:place` | Select | Pick a destination zone |
| `zone:confirm:{zoneId}` | Button | Execute the travel |
| `zone:cancel` | Button | Dismiss |
| `topic:new:{zoneId}` | Button | Show the Create-a-Topic modal |
| `topic:create:{zoneId}` | Modal | Create a public forum topic |
| `priv:new:{zoneId}` | Button | Show the Create-a-Private-Thread modal |
| `priv:create:{zoneId}` | Modal | Create a private thread |
| `zone:who:{zoneId}` | Button | Reply privately with who's standing in the zone |
| `move:open` | Button | Show the Move modal |
| `say:open` | Button | Show the Speak picker |
| `say:pick` | Select | Pick a destination, then show the Speak modal |
| `heal:pick:{characterId}` | Select | Clear the chosen afflictions |
| `edit:open:{messageId}` | Button | Show the Edit-message modal, prefilled |
| `edit:send:{messageId}` | Modal | Rewrite a proxied message |

**The two `edit:` ids arrive in a DM**, from the button the ✏️ reaction sends
(`bot/src/lib/editModal.js`, `PROXYING.md` §4). `interaction.guild` and
`.member` are null there, so both handlers resolve the author from
`recentProxies` rather than from the guild — and `edit:open:` opens a modal, so
it is one of the handlers that must **not** ack first.

**The travel flow is `zone:`-namespaced, but the console button is still
`loc:open`** — that id is baked into the standing `#turns` console message, so
renaming it would break every console posted before the rework. The picker
offers the current zone's direct neighbours (`Zone.connectsTo`), or every
presence zone for a character who has none yet; the Caves group is never a
destination. Every hop costs the Move, so the option descriptions say so
without asking the server anything. See `MAP.md`.

**The two creation buttons ride on the zone anchors** (`db/lib/zoneAnchorRow.js`
— plain component JSON, because the sync posts them over REST from `db/`, which
has no discord.js, while the bot answers the clicks over the gateway). The zone
id rides in the custom id so the handlers need no channel→zone lookup; change a
prefix in that file and you must change it in `interactionCreate.js` too.

`say:nav` is the value carried by a **group header** option in the Speak
picker. Discord select menus have no option groups, so headers are ordinary
options; picking one re-renders the panel unchanged.

## 5. Modals

Four modals. All need discord.js >= 14.27 for the component types involved:
`Label` (18) wrapping a `TextInput` (4), `RadioGroup` (21), `Checkbox` (23) or
`FileUpload` (19), plus a bare `TextDisplay` (10) for the `-#` line.

A modal must be shown within 3 seconds of the interaction and **cannot be
deferred first**. That is why the Move button and the two creation buttons open
their modals directly — the creation buttons read nothing and every gate runs
on submit; the Move button makes the single cheap cutoff check below and falls
through to the modal if that read fails, since submit checks it again — while
Speak goes through a picker first (enumerating threads costs API calls).

### Move — `move:new` (`bot/src/lib/moveModal.js`)

| Field | customId | Type |
|---|---|---|
| Your Move | `move:body` | Paragraph, required, max 1800 |
| Kind | `move:kind` | Radio: `ROUTINE` / `GAMBIT`, required |
| Labor | `move:labor` | Checkbox — Routine only, refused on a Gambit |

Moves close three hours before the turn ends — 9:00 AM / 9:00 PM
America/Chicago — so a GM can adjudicate what was filed before the push
(`TURN-ENGINE.md` §6a). Both `move:open` and the submit handler check it: the
button refuses to open the modal after the cutoff, and submit re-checks because
a modal can sit open on screen across it. Either way the refusal is ephemeral
and names the cutoff and the next turn's start. Travel, Speak, requests and the
Default Move pass are untouched.

Submitting runs every gate the old `#turns` message flow ran — living
character, open turn, before the cutoff, hasn't already acted, non-empty body,
Labor resolved **before** any `Action` row exists so a refusal never costs a
turn — then
locks the Move in through `bot/src/lib/moveConfirm.js#confirmMove` and
replies ephemerally. **Submit = locked**: there is no edit window, the dice
and resource roll happen now, and the payout — like every Move payout — lands
at the turn-end push (`ADJUDICATION.md`). See `TURN-ENGINE.md`.

### Create a Topic — `topic:create:{zoneId}` (`bot/src/lib/topicModal.js`)

### Create a Private Thread — `priv:create:{zoneId}` (same file)

| Field | customId | Type |
|---|---|---|
| Name | `topic:name` | Short, required, max 90 |
| Persistent | `topic:persistent` | Checkbox |

Two modals, one shape. Both gate on submit: a living character, standing in the
zone whose id rode in the custom id. The button lives in a channel only that
zone's role can see, but a button is a hint, not a lock — an ephemeral picker
outlives its player walking out of the zone.

On success the bot creates the forum post (with the Persistent tag applied if
ticked) or the private thread (adding the creator), and writes the
`PlayerThread` row plus an audit entry. A topic's opening message mentions the
creator, which is what puts the post in their mentions and makes them a
follower. Players hold no create-posts or create-threads permission anywhere —
the bot makes every thread, which is what keeps `PlayerThread` a complete
record. See `CHANNELS.md` §4.

### Speak — `say:send:{channelId}` (`bot/src/lib/speakModal.js`)

| Field | customId | Type |
|---|---|---|
| Message | `say:body` | Paragraph, optional, max 1800 |
| Conceal | `say:conceal` | Checkbox |
| Attachment | `say:file` | File upload, optional, max 1 |

The body is optional because an attachment alone is a valid post — the same
rule the `/conceal` prefix follows. Conceal posts under
`concealedAlias(character)` exactly as the prefix does.

Destinations come from `bot/src/lib/speakTargets.js#listSpeakTargets`, which
keeps anything that is **both** a tupper channel and one Discord says the
member may actually post in. That second test is the live answer to every
narrowcast rule without a second copy of them, so a channel added later
appears automatically.

"May post in" is two different permissions, and conflating them is a bug:

| Target | Needs |
|---|---|
| Text / forum channel | `ViewChannel` + `SendMessages` |
| Thread | `ViewChannel` + `SendMessagesInThreads` |

The two thread containers are **never** offered as destinations themselves —
you cannot post a message to a forum channel, and `#private` denies
`SendMessages` for `@everyone` by design (`CHANNELS.md` §2). Both are walked
for their threads on `ViewChannel` alone. A private thread additionally
requires the member to be in it.

Grouped Room / Threads / Broadcast, each group prefixed by a header option and
its entries carrying a group emoji, capped at Discord's 25 options with the
overflow counted rather than dropped silently. **Every option value must be
unique** — Discord rejects the whole payload otherwise, and `discord.js` does
not check this locally, so each group header carries its own `say:nav:{group}`
value rather than a shared one.

The destination is re-checked on submit: an ephemeral picker outlives its
player walking out of the room.

## 6. Reactions

All in `bot/src/events/messageReactionAdd.js`, all gated on `recentProxies`
except 🌫️, 🌬️ and ⭐. Each is stripped back off after being processed.

| Emoji | Who | Does |
|---|---|---|
| ❌ | Owner or GM | Delete the message and its `ArchiveEntry` |
| ✏️ / 📝 | Owner | DM-based edit |
| 🔍 / 🔎 | Anyone | Inspect embed, gated by the viewer's own tags |
| ❓ | Anyone | DM the character's bio |
| ⭐ | Anyone | Save a personal `Note` — works on any bot- or webhook-authored message, not just a tracked proxy (`PROXYING.md` §7) |
| ⚜️ | GM | Full dossier on the speaking character |
| 🌫️ | GM | Delete and repost as the bot, de-attributing it |
| 🌬️ | Cursed (a ghost) | Bascinet posts one haunting line in that channel or forum post |

🌬️ is the ghost whisper, and the only thing a dead player can do. It works on
**any** message — proxied or not, the bot's own posts included — but only in a
zone's `#summary` or a forum post (`channelKind` `summary` or `public`):
`#private`, `#watch` and `#intercom` refuse it, even though ghosts can *read*
all of them. Since the rework a ghost sees **every** zone, cave levels
included (`db/lib/cursedAccess.js`, `CHANNELS.md` §5). One press per ghost per
**12 real hours**, tracked
in `GhostWhisper` and enforced by `db/lib/ghostWhisper.js#claimGhostWhisper`.

Every refusal except the cooldown is silent, on purpose: a visible "you can't
do that" would tell the living that someone specific is watching. The cooldown
answers by DM for the same reason.

⚜️ applies **no** vision gates — every tag, the Desire, this
turn's Action, and the real name even on a concealed message. It has **no
channel fallback** when the DM bounces, unlike every other embed here:
posting it in the channel would hand the room everything it hides.

⚜️ is also the Move button's emoji. Buttons and reactions share no namespace,
so this is not a collision.

## 7. Where the code lives

| File | Role |
|---|---|
| `bot/src/lib/commands.js` | Definitions and global registration |
| `bot/src/events/interactionCreate.js` | Every command, button, select and modal handler |
| `bot/src/lib/turnsConsole.js` | The `#turns` anchor message |
| `bot/src/lib/moveModal.js` | The Move modal |
| `bot/src/lib/topicModal.js` | The two creation modals |
| `bot/src/lib/zoneTravel.js` | The zone picker rows and `performMove` |
| `db/lib/zoneAnchorRow.js` | The two anchor buttons, as shared component JSON |
| `bot/src/lib/moveConfirm.js` | Resolving a Move |
| `bot/src/lib/speakModal.js` | The Speak picker and modal |
| `bot/src/lib/speakTargets.js` | Where a character may speak |
| `bot/src/lib/interactionGuild.js` | Guild/member resolution for DM-run commands, the GM gate |
| `bot/src/events/messageReactionAdd.js` | Every reaction |
