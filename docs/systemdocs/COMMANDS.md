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

Each command declares its contexts:

- `Guild` only — needs a channel or thread to act on.
- `Guild` + `BotDM` — usable anywhere, including the bot's DMs.

## 2. Slash commands

| Command | Options | Who | Contexts | Handler |
|---|---|---|---|---|
| `/move` | — | Living character | Guild, DM | `handleMoveOpen` |
| `/location` | — | Living character | Guild, DM | `handleOpen` |
| `/message` | — | Living character | Guild, DM | `handleMessageCommand` |
| `/labor` | `type` (choice: hunt/fish/farm/herd) | Living character | Guild, DM | `handleLaborCommand` |
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
- `/labor` replaced four separate commands (`/hunt`, `/fish`, `/farm`,
  `/herd`). The **text shorthand** a Move body accepts is unchanged and still
  spelled `/hunt`; see `PRODUCTION.md` §3.
- `/dm` was named `/message` until `/message` became the player-facing speak
  command.
- Commands taking a character take a **role** option, not a user option, so
  the picker names characters rather than Discord accounts.

## 3. The `#turns` console

The buttons ride on the rolling turn announcement — `#turns` is one message,
reposted each turn by `db/lib/turnAnnouncement.js#postTurnsConsole`, so the
console is always the last thing in the channel (see `TURN-ENGINE.md` for why
it stopped being three separate messages).

`bot/src/lib/turnsConsole.js#ensureTurnsConsole` runs on ready and is only the
cold start: it locks the channel down and posts the message if none exists —
a fresh guild, or a `#turns` that was wiped and has not seen a turn advance
since. The buttons themselves are one shared definition in
`db/lib/turnsConsoleRow.js`, plain component JSON because the REST side (the
web Dev Panel's End Turn) and the gateway side both post it.

`@everyone` is denied `SendMessages` in `#turns`. Anything typed there is
deleted and files nothing.

| Button | Emoji | customId | Opens |
|---|---|---|---|
| Travel | 🗺️ | `loc:open` | The location picker (§4) |
| Move | ⚜️ | `move:open` | The Move modal (§5) |
| Speak | 🔊 | `say:open` | The Speak picker (§5) |

Tracked on `GameConfig.turnsConsoleChannelId` / `turnsConsoleMessageId`.

## 4. Component custom IDs

`namespace:verb` for singletons, `namespace:verb:{id}` where an id is needed,
parsed by literal `startsWith` + `slice`.

| customId | Type | Does |
|---|---|---|
| `loc:open` | Button | Offer connected locations |
| `loc:place` | Select | Pick a destination |
| `loc:confirm:{locationId}` | Button | Execute the travel |
| `loc:cancel` | Button | Dismiss |
| `move:open` | Button | Show the Move modal |
| `say:open` | Button | Show the Speak picker |
| `say:pick` | Select | Pick a destination, then show the Speak modal |
| `heal:pick:{characterId}` | Select | Clear the chosen afflictions |

`say:nav` is the value carried by a **group header** option in the Speak
picker. Discord select menus have no option groups, so headers are ordinary
options; picking one re-renders the panel unchanged.

## 5. Modals

The repo's only modals. Both need discord.js >= 14.27 for the component types
involved: `Label` (18) wrapping a `TextInput` (4), `RadioGroup` (21),
`Checkbox` (23) or `FileUpload` (19), plus a bare `TextDisplay` (10) for the
`-#` line.

A modal must be shown within 3 seconds of the interaction and **cannot be
deferred first**. That is why the Move button opens its modal directly (it
reads nothing) while Speak goes through a picker first (enumerating threads
costs API calls).

### Move — `move:new` (`bot/src/lib/moveModal.js`)

| Field | customId | Type |
|---|---|---|
| Your Move | `move:body` | Paragraph, required, max 1800 |
| Kind | `move:kind` | Radio: `ROUTINE` / `GAMBIT`, required |
| Opposed | `move:opposed` | Checkbox |

Submitting runs every gate the old `#turns` message flow ran — living
character, open turn, hasn't already acted, non-empty body, labor shorthand
resolved **before** any `Action` row exists so a refusal never costs a turn —
then resolves the Move through `bot/src/lib/moveConfirm.js#confirmMove` and
replies ephemerally. See `TURN-ENGINE.md`.

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
you cannot post a message to a forum channel, and `-private` denies
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
except 🌫️. Each is stripped back off after being processed.

| Emoji | Who | Does |
|---|---|---|
| ❌ | Owner or GM | Delete the message and its `ArchiveEntry` |
| ✏️ / 📝 | Owner | DM-based edit |
| 🔍 / 🔎 | Anyone | Inspect embed, gated by the viewer's own tags |
| ❓ | Anyone | DM the character's bio |
| ⭐ | Anyone | Save a personal `Note` |
| ⚜️ | GM | Full dossier on the speaking character |
| 🌫️ | GM | Delete and repost as the bot, de-attributing it |

⚜️ applies **no** vision gates — every tag, the Desire, the Fear, this
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
| `bot/src/lib/moveConfirm.js` | Resolving a Move |
| `bot/src/lib/speakModal.js` | The Speak picker and modal |
| `bot/src/lib/speakTargets.js` | Where a character may speak |
| `bot/src/lib/interactionGuild.js` | Guild/member resolution for DM-run commands, the GM gate |
| `bot/src/events/messageReactionAdd.js` | Every reaction |
