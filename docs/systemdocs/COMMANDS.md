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
picker. `/gm` `/message` `/add` `/remove` appeared twice, and the four
retired `/hunt` `/fish` `/farm` `/herd` were still listed with no handler
left to answer them. Since registration is global, an empty guild-scoped
list is the correct state, so the sweep enforces it. Don't add a per-guild
registration back — it would be invisible in DMs *and* duplicate whatever the
global list already has.

Each command declares its contexts:

- `Guild` only — needs a channel or thread to act on.
- `Guild` + `BotDM` — usable anywhere, including the bot's DMs.

## 2. Slash commands

| Command | Options | Who | Contexts | Handler |
|---|---|---|---|---|
| `/move` | — | Living character | Guild, DM | `handleMoveOpen` |
| `/location` | — | Living character | Guild, DM | `handleTravelOpen` — the **Location** picker (§4) |
| `/conceal` | — | Living character | Guild, DM | `handleConcealCommand` |
| `/message` | — | Living character | Guild, DM | `handleMessageCommand` |
| `/roll` | — | Anyone | Guild | `handleRollCommand` |
| `/add` | `character` (role) | Conversation or private-Room member, or GM | Guild | `handleThreadMemberCommand` |
| `/remove` | `character` (role) | Conversation or private-Room member, or GM | Guild | `handleThreadMemberCommand` |
| `/gm` | `message`, `attachment` | GM | Guild | `handleGmCommand` |
| `/dm` | `recipient` (user), `message` | GM | Guild | `handleGmDmCommand` |
| `/heal` | `character` (role) | GM | Guild | `handleHealCommand` |

Notes:

- `/move`, `/location` and `/message` are the twins of the three console
  buttons in §3. Each opens the same flow.
- `/conceal` toggles `Character.concealed`, a standing state rather than a
  per-message one — that's why it needs a DM context the same way `/location`
  does, rather than living only as a `/character` checkbox. See §2c.
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
- `/labor` is retired — laboring is now the **Labor checkbox** on the Move
  modal (`LABORING.md` §4).
- `/persistent` is retired too — Bascinet 2 dropped forum topics, private
  Create-a-Thread anchors and any long-lived form of a player-made thread.
  The only thread a player can open now is a Conversation, and every
  Conversation is wiped clean at the next Dawn regardless (`CHANNELS.md` §4).
- `/dm` was named `/message` until `/message` became the player-facing speak
  command.
- Commands taking a character take a **role** option, not a user option, so
  the picker names characters rather than Discord accounts. The role is the
  character's personal name-token role (`CHANNELS.md` §3).

### 2b. `/add` and `/remove` in detail

Both work on two things, and **the channel decides which**:
a `PlayerThread` row means a **Conversation**, a `Room` row means a **private
Room** (§2b-ii). A public Room takes neither — everyone standing in the
Location can already read it — and anywhere else refuses.

#### 2b-i. In a Conversation

**`/add` works on any `ALIVE` character, wherever they stand.** There is no
location gate. Discord refuses (or quietly sheds) a thread member who can't
view the parent Location channel, so the command records a
**`PlayerThreadInvite`** row first — that is what survives when the Discord
add can't land yet — and then attempts the add. If the target is already
standing **here** (`target.locationId === row.locationId`) it lands
immediately; otherwise `db/lib/threadInvites.js#applyPendingInvites` replays
it the moment they arrive, called from `applyLocationMoveSideEffects` on
every move (`MAP.md` §4). Adds are **silent**: the REST thread-members
endpoint is used rather than `channel.members.add`, which would ping-mention
them in the channel. The target is DM'd instead — where they were let in, and
a link, never the content. Discord's own "added to a thread" notice is easy to
miss and says nothing about where.
Mentions into a Conversation follow the same contract — a character-role
mention there is also an invite (`bot/src/events/messageCreate.js`).

**`/remove`** deletes the invite row and then removes the thread member. If the
bot is missing `Manage Threads` the caller is told so, rather than seeing "the
application did not respond".

#### 2b-ii. In a private Room

The other way into a private Room, and the only one that isn't a key
(`CHANNELS.md` §4a). `/add` writes a **`RoomGuest`** row, adds the thread
member and sends the same DM.

Three differences from the Conversation form, all downstream of the grant
being **spent when the guest leaves the Location**:

- **The target must already be standing there.** A row handed to somebody
  across the map would be deleted before they ever saw the door.
- **They stay until they leave.** `syncCharacterRoomAccess` drops every guest
  row that isn't where the character now stands, so walking out is what shuts
  the door. Coming back needs a fresh `/add`.
- **`/remove` refuses a key-holder** — *"Their key admits them. Take the
  key."* Removing them would undo itself on their next arrival, so the honest
  answer is to name the real removal.

A guest gets the room's **full reach**, not just the thread: the stash, the
Transfer dialog, Storage, equipment standing there, corpse handling. That
falls out of `accessibleRooms()` being the one predicate behind all of them.

Both forms are open to anyone already in the thread (checked via
`channel.members.fetch`), plus GMs — the same posture as pinging someone in,
which any participant can already do.

### 2c. `/conceal` in detail

`Character.concealed` is a standing toggle, not a per-message prefix — there
is no more typed prefix to open a message with. `handleConcealCommand`
(`bot/src/events/interactionCreate.js`) flips it, writes a
`character_conceal_toggled` `AuditLog` row, and replies naming the alias:
"You now speak as **a young man**. Nobody sees your name until you run
`/conceal` again." / "You speak under your own name again."

While concealed, every message proxies under `concealedAlias(character)`
with the unknown-silhouette avatar (`messageCreate.js`), and the **Who's
here?** anchor button lists the character under that same alias, with no
Role shown (§4). The web app carries the identical toggle as a `<Switch>` on
`/character`, next to turn-ping (`AvatarField.js`).

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
| Travel | 🗺️ | `loc:open` | The Location picker (§4) |
| Move | ⚜️ | `move:open` | The Move modal (§5) |
| Speak | 🔊 | `say:open` | The Speak picker (§5) |

Tracked on `GameConfig.turnsConsoleChannelId` / `turnsConsoleMessageId`.

## 4. Component custom IDs

`namespace:verb` for singletons, `namespace:verb:{id}` where an id is needed,
parsed by literal `startsWith` + `slice`.

| customId | Type | Does |
|---|---|---|
| `loc:open` | Button | Offer the connected Locations |
| `loc:pick` | Select | Pick a destination Location |
| `loc:drag:{locationId}` | Select | Pick who to bring along (min 0) |
| `loc:confirm:{locationId}` | Button | Execute the travel |
| `loc:cancel` | Button | Dismiss |
| `loc:who:{locationId}` | Button | Reply privately with who's standing here (§ below) |
| `loc:secret:{locationId}` | Button | Reply privately with the private Rooms and Conversations here you can see |
| `loc:converse:{locationId}` | Button | Offer the Rooms you can link a new Conversation to |
| `room:storage:{roomId}` | Button | Reply privately with what's lying in the Room's stash (`CARRY.md` §7) |
| `room:intercom:{roomId}` | Button | Show the Intercom modal. **Council Room only**, and the one button here that must NOT be `ack()`'d — `showModal` is the acknowledgement |
| `intercom:send:{roomId}` | Modal | Broadcast the PA (`CHANNELS.md` §7a) |
| `conv:room:{locationId}` | Select | Pick which Room to link the Conversation to, then show the Converse modal |
| `conv:new:{roomId}` | Modal | Create the Conversation |
| `move:open` | Button | Show the Move modal |
| `say:open` | Button | Show the Speak picker |
| `say:pick` | Select | Pick a destination, then show the Speak modal |
| `heal:pick:{characterId}` | Select | Clear the chosen afflictions |
| `edit:open:{messageId}` | Button | Show the Edit-message modal, prefilled |
| `edit:send:{messageId}` | Modal | Rewrite a proxied message |
| `offer:accept:{offerId}` | Button | Accept a Lesson or Bind `Offer` |
| `offer:decline:{offerId}` | Button | Decline a Lesson or Bind `Offer` |

Retired with the zone rework: `zone:place`, `zone:confirm:{zoneId}`,
`zone:cancel`, `zone:who:{zoneId}`, `topic:new:{zoneId}`,
`topic:create:{zoneId}`, `priv:new:{zoneId}`, `priv:create:{zoneId}`.

**The two `edit:` ids arrive in a DM**, from the button the ✏️ reaction sends
(`bot/src/lib/editModal.js`, `PROXYING.md` §4). `interaction.guild` and
`.member` are null there, so both handlers resolve the author from
`recentProxies` rather than from the guild — and `edit:open:` opens a modal, so
it is one of the handlers that must **not** ack first.

**The two `offer:` ids also arrive in a DM**, on the message `db/lib/offerRow.js`
builds for a Lesson or Bind `Offer`'s responder (`LESSONS.md` §3). Handled by
`bot/src/lib/offers.js`, routed in `interactionCreate.js` alongside the `edit:`
namespace. The click's acknowledgement is `interaction.update()`: the buttons
come off the message and the outcome is written under it in place, so nothing
can be clicked twice and no message id needs to be stored elsewhere.

**The travel flow lives in `bot/src/lib/locationTravel.js`, all
`loc:`-namespaced** (`bot/src/events/interactionCreate.js`). The console
button keeps its historical id, `loc:open` — that id is baked into every
standing `#turns` console message, so renaming it would break every console
posted before the rework, and it is also the id the three anchor buttons'
namespace was chosen to match. `handleTravelOpen` (the `/location` twin too)
offers the current Location's direct neighbours (`Location.connectsTo`), or
every non-cave Location for a character who has none yet — arriving is not
travel. Picking one (`handleTravelPick`) shows the cost as an option
description and a `-#` line rather than asking the server anything: "Same
zone" (free, on a cooldown), "Crosses into {Zone} — costs your Move", or
"Arriving costs you nothing" on a first placement.

**Every hop always offers dragging**, on the same message as the Confirm/
Cancel row: `loc:drag:{locationId}` lists zone-mates (not just Location-mates)
who are a corpse, hold an incapacitating tag, or are in the mover's faction
if the mover leads it — `db/lib/locationTravel.js#dragCandidates`. The select
is `minValues: 0`, and `buildDragRow` returns `null` (dropping the row
entirely) when there is nobody to bring, since Discord rejects an empty
select. The picked list is **not** carried on the component — Discord hands
the Confirm click no memory of what the drag select last held — so
`handleTravelDrag` parks it in an in-memory `Map` keyed on Discord user id,
`DRAG_TTL_MS` = 10 minutes, same posture as `recentProxies`
(`bot/src/lib/proxy.js`): a missing entry means "nobody picked", never a
gate. `handleTravelConfirm` re-resolves and re-authorizes everyone server-side
inside `performLocationMove`'s own transaction (`canDrag`) — a candidate who
wandered off between the picker and the confirm fails the whole move rather
than being silently dropped. See `MAP.md` §3.

**The three anchor buttons ride on the Location anchors**
(`db/lib/locationAnchorRow.js` — plain component JSON, because the sync
posts them over REST from `db/`, which has no discord.js, while the bot
answers the clicks over the gateway). The Location id rides in the custom id
so the handlers need no channel→Location lookup; change a prefix in that
file and you must change it in `interactionCreate.js` too.

- **Who's here?** (`handleWhosHere`) lists everyone `ALIVE` and standing in
  this Location: named characters first (with their `roleTitle` shown to a
  fellow member of the same real faction, same rule the 🔍 inspect gate
  uses), then concealed characters as their alias with an article — "a young
  man" — and no title, since a Role is as identifying as a name. Nobody here
  ⇒ "Nobody is here."
- **Secret rooms?** (`handleSecretRooms`) lists the private Rooms this
  character's held tags admit them to (`db/lib/roomAccess.js#accessibleRooms`)
  and the Conversations here they created or were invited to — two separate
  lines, each dropped when empty; nothing at all ⇒ "No secret rooms for you
  here."
- **Converse** (`handleConverseOpen`) offers every Room here the character
  can see (public, plus private ones their tags admit) via `conv:room:`; that
  select's handler, `handleConverseRoomPick`, must **not** ack — it goes
  straight to `showModal` — so the picker outliving a player's departure is
  caught on submit instead. `handleConverseCreate` re-checks the character is
  still standing in the Room's Location, opens a private, non-invitable
  thread on the **Location channel** (Discord has no threads inside threads,
  so the Room is only the link the whisper poll reads), adds the creator
  silently, and writes the `PlayerThread` row (`locationId`, `roomId`) plus a
  `conversation_opened` `AuditLog` entry.

`say:nav` is the value carried by a **group header** option in the Speak
picker. Discord select menus have no option groups, so headers are ordinary
options; picking one re-renders the panel unchanged.

## 5. Modals

Three modals. All need discord.js >= 14.27 for the component types involved:
`Label` (18) wrapping a `TextInput` (4), `RadioGroup` (21) or `Checkbox` (23),
plus a bare `TextDisplay` (10) for the `-#` line.

A modal must be shown within 3 seconds of the interaction and **cannot be
deferred first**. That is why the Move button opens its modal directly — it
makes the single cheap cutoff check below and falls through to the modal if
that read fails, since submit checks it again — while Converse and Speak both
go through a picker first (enumerating Rooms or threads costs API calls), so
each picker's handler shows the modal with nothing awaited, and every real
gate runs on submit instead.

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
auto-labor pass are untouched.

Submitting runs every gate the old `#turns` message flow ran — living
character, open turn, before the cutoff, hasn't already acted, non-empty body,
Labor resolved **before** any `Action` row exists so a refusal never costs a
turn — then
locks the Move in through `bot/src/lib/moveConfirm.js#confirmMove` and
replies ephemerally. **Submit = locked**: there is no edit window, the dice
and resource roll happen now, and the payout — like every Move payout — lands
at the turn-end push (`ADJUDICATION.md`). See `TURN-ENGINE.md`.

### Converse — `conv:new:{roomId}` (`bot/src/lib/converseModal.js`)

| Field | customId | Type |
|---|---|---|
| Name | `conv:name` | Short, required, max 90 |

Replaces the two creation modals of the zone rework (Create a Topic, Create a
Private Thread) — players no longer make Rooms, only Conversations, and a
Conversation is always private and always linked to a Room. The Room id rides
the custom id, coming straight off the `conv:room:` select that opened this
(§4), so submit needs no channel→Room lookup; every gate runs on submit
(`handleConverseCreate`): a living character, still standing in the Room's
Location — the select lives on an ephemeral message that can outlive a
player walking out of the Location, same posture the old topic/private
modals took toward the zone.

On success the bot opens a private, non-invitable thread on the Room's
**Location channel** (Discord has no threads inside threads), adds the
creator silently, and writes the `PlayerThread` row (`locationId`, `roomId`)
plus a `conversation_opened` audit entry. Players hold no create-thread
permission anywhere — the bot makes every Conversation, which is what keeps
`PlayerThread` a complete record. See `CHANNELS.md` §4.

### Speak — `say:send:{channelId}` (`bot/src/lib/speakModal.js`)

| Field | customId | Type |
|---|---|---|
| Message | `say:body` | Paragraph, required, max 1800 |

The Conceal checkbox and the attachment field are both gone. Concealment is
no longer asked per-message — it's the standing `Character.concealed` toggle
(`/conceal`, §2c), read off the character rather than the modal, so a post
while concealed goes out under `concealedAlias(character)` with no extra
choice to make on submit.

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

### Intercom — `intercom:send:{roomId}` (`bot/src/lib/intercomModal.js`)

| Field | customId | Type |
|---|---|---|
| Announcement | `intercom:body` | Paragraph, required, max 1200 |

The button lives on the Council Room's starter post, and standing in that room
is the whole gate — there is no tag any more (`CHANNELS.md` §7a). Like Speak,
the gate is re-checked on **submit**, because an ephemeral modal outlives its
player walking out of the Keep.

1200 characters is not arbitrary. The composed line has to fit one Discord
message per zone: the broadcast pings `@here`, and a chunked message would ping
once per chunk.

## 6. Reactions

All in `bot/src/events/messageReactionAdd.js`, all gated on `recentProxies`
except 🌫️ and ⭐. Each is stripped back off after being processed.

| Emoji | Who | Does |
|---|---|---|
| ❌ | Owner or GM | Delete the message and its `ArchiveEntry` |
| ✏️ / 📝 | Owner | DM-based edit |
| 🔍 / 🔎 | Anyone | Inspect embed, gated by the viewer's own tags |
| ❓ | Anyone | DM the character's bio |
| ⭐ | Anyone | Save a personal `Note` — works on any bot- or webhook-authored message, not just a tracked proxy (`PROXYING.md` §7) |
| ⚜️ | GM | Full dossier on the speaking character |
| 🌫️ | GM | Delete and repost as the bot, de-attributing it |

There used to be a 🌬️ ghost whisper here — one haunting line a dead player
could breathe into a channel, on a 12-real-hour cooldown tracked in a
`GhostWhisper` table. It is **gone**, along with the table and
`db/lib/ghostWhisper.js`. A ghost has no voice now. The thing that reports an
unburied body is the body: `bot/src/lib/deathSmell.js` nags the Location it is
lying in every 4–10 real hours (`CORPSES.md` §5), which says the same thing
without needing the dead player to be at their keyboard to say it.

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
| `bot/src/lib/locationTravel.js` | The Location picker/drag/confirm rows, the pending-drag map, `performMove` |
| `db/lib/locationTravel.js` | `performLocationMove` — validation, the cooldown or the Move, dragging (`MAP.md` §3) |
| `db/lib/locationMove.js` | `applyLocationMoveSideEffects` — the Discord half of a move, shared by bot and web (`MAP.md` §4) |
| `db/lib/locationAnchorRow.js` | The three anchor buttons (Who's here? / Secret rooms? / Converse), as shared component JSON |
| `db/lib/roomAccess.js` | `syncCharacterRoomAccess`, `accessibleRooms`, `heldTagSlugs` — private Room membership |
| `bot/src/lib/converseModal.js` | The Converse modal |
| `bot/src/lib/whisperPoll.js` | The 15-minute Room whisper cron |
| `bot/src/lib/moveConfirm.js` | Resolving a Move |
| `bot/src/lib/speakModal.js` | The Speak picker and modal |
| `bot/src/lib/speakTargets.js` | Where a character may speak |
| `bot/src/lib/interactionGuild.js` | Guild/member resolution for DM-run commands, the GM gate |
| `bot/src/events/messageReactionAdd.js` | Every reaction |
