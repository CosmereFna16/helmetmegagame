# Paperwork

Paper as an object: a thing you buy, write on, seal with wax, hand over, send
by bird, nail to a wall, or tear back down. Reading it needs letters and
working eyes; everyone else sees the same six words.

## 1. Why paper is a tag

A written sheet is a `Tag` row minted at runtime — `custom: true`,
`ephemeral: true`, a `custom-` slug — exactly the shape `db/lib/corpseMint.js`
writes for a body and `db/lib/depotCrates.js` for a crate. That sounds heavier
than it is: being a tag buys carry weight, Transfer, room stashes, Loot and
theft for free, rather than needing a parallel inventory nothing else in the
game knows how to read.

Two things had to change before it could work, and both were owed anyway.

**Runtime tags used to outlive the game.** `wipeGameData` never touched the
`Tag` catalog and `db:prune-tags` skips every `custom` row on purpose, so
crates and headstones were permanent orphans accumulating across every game
ever run — only corpses escaped, through `Tag.corpseOfCharacterId`'s cascade.
`Tag.ephemeral` is the fix: set by every runtime minter, swept by the wipe,
and deliberately **not** `custom`, because a GM's homebrew from `/gm/dev/tags`
is custom too and must survive a restart.

**`Tag.description` is broadcast to every browser.** `getVisibleTags`
(`web/lib/referenceData.js`) ships the whole catalog into `TagsProvider` on
every page. A letter's text in that column would publish every letter in the
game to everyone playing it. So the text lives in `Tag.paperText`, which
`TAG_CHIP_FIELDS` never selects, and the description is composed per request,
per viewer.

That loader now also withholds `ephemeral` rows the caller isn't holding.
Without it the catalog payload would grow with every paper ever written — a
problem crates already had, with no consequences until paper made the set
unbounded.

## 2. The four states

| `Tag.paperKind` | What it is |
|---|---|
| *null*, slug `paper` | **Blank stock.** One stackable catalog tag. `depotPrice: 1`, the cheapest thing the Depot sells. |
| `PAPER` | **A written sheet.** Carries `paperText`. |
| `SEALED` | **A closed letter.** Same row, renamed in place. Carries `sealMark`. |
| `BROKEN_SEAL` | **A spent envelope.** Evidence somebody opened it, and whose wax it was. |

Blank paper is deliberately *not* a runtime row. You hold "Paper ×15" as one
`CharacterTag`; a sheet only becomes its own `Tag` when somebody writes on it,
so the row count grows with actual writing rather than with stock.

## 3. Reading

`db/lib/reading.js#readBlock(tags, { phase, indoors })` is the one gate.
It composes `examineVision.js#examineBlock` — blind, blind drunk, nearsighted
with the spectacles in a sack, sun-sensitive outdoors at Dawn — and adds the
`literate` tag on top.

**One message for every cause: `You can't read this. ‡`** A blind man and an
illiterate one get identical refusals. Naming which would leak a condition to
anyone reading over their shoulder, and it would differ between the tag chip,
the noticeboard and the server's own refusal — which is exactly the drift the
single predicate exists to prevent.

`db/lib/paper.js#paperDescription(tag, viewer)` composes what a given reader
sees. **A `SEALED` letter's text is never composed, literate viewer or not.**
That is what the seal is.

Three surfaces strip `paperText` before anything crosses to the browser:
`getVisibleTags`, the sheet's own `sheetCharacter` in
`web/app/(app)/character/page.js`, and the Write dialog, which fetches the
text on demand through `readMyPaper` rather than shipping it with the page.
**Holding a letter is not the same as being able to read it** — that is the
entire point of an illiterate courier, and a raw string in the page source
would end it.

## 4. Writing

The **Write** button on the Actions grid. Pick a sheet, type, submit.

- On a blank sheet: one unit off the stack, one new `PAPER` row.
- On a written one: **append**. The existing text is shown read-only above the
  box. Nothing in the game shortens `paperText`.

`web/app/(app)/character/paperActions.js`. **It files no `Request`**, the same
call `equipActions.js` makes: writing costs nothing, spends no Move, is the
most frequent thing a scribe does, and there is nothing for a GM to
adjudicate. What a GM needs is to *read* the letters, and they can — the text
is on the tag, and every GM surface that renders a tag renders it.

**A note's name is deliberately anonymous** — `A Note (TG-4596)`, a meaningless
waybill in the Depot's own house style. `Tag.name` travels everywhere a tag
does (Transfer, Loot, a room's Storage readout, the bot's inspect embed) and
none of those surfaces knows anything about literacy, so a title reading "hand
of Ada" would hand every one of them the one fact this system protects. The
writer is kept on `Tag.paperAuthor` for the GM and nothing else.

## 5. Wax

A wax stamp is declared by `sealMark:` in `docs/tags.yaml` — the line the wax
carries, "Three cups, stacked." `db:sync-tags` composes the whole description
around it, so the boilerplate is written once; authoring a `description:`
beside a `sealMark:` is an error rather than an override.

- **Six courtier seals**, `pointCost: 1`, gated on `courtier`, and
  **`exclusive`** — a courtier has *one* seal. It is a signature, not a
  collection, and a courtier who owned all six could sign as anybody.

  Note what that does and does not cover. `exclusive` is enforced on the
  purchase paths only — the creation wizard, `/store`, and their server-side
  re-checks — the same posture the Beliefs have. It does **not** stop a second
  seal arriving by Transfer, by Loot or from a GM, and that is deliberate: a
  seal is a physical object, so taking one off somebody is exactly the kind of
  thing the game is for. What you cannot do is *buy* a second.

  All six share `requiredTag: courtier`, which does not defeat the flag —
  `exclusiveConflict`'s exemption (`web/lib/characterCreation.js`) is for a
  direct parent/child pair, and neither seal requires the other.
- **Eight office stamps**, `purchasable: false`, each starting in the room its
  seat works out of (`docs/zones.yaml` `stash:`). All `tradeable: true` like
  every other piece of office regalia — prying the Bishop's stamp off the
  Bishop is the kind of thing the game is for (`TAGS.md` §5).

  **Not `exclusive`.** A stamp belongs to a seat rather than to a person, so
  holding two means you took one of them off somebody, which is a situation
  worth having. It would also be inert: nothing here is purchasable, and the
  purchase paths are the only place the flag is enforced.

**The Merchant's is the one stamp with no mark in the file.** His bears his own
initials, written once at character creation beside the line that teaches the
Depot turret his face (`db/lib/merchantSeal.js`). `db:sync-tags` leaves both
`sealMark` and `description` alone for any stamp that names an office but
carries no authored mark, so a re-sync cannot rub it back off.

**Sealing renames the row in place**, the same move a corpse makes when it rots
— a letter somebody is carrying seals in their hands with no second row to
reconcile. The stamp is **not** consumed.

**Breaking a seal is Consume**, and takes its own road out of
`consumeTagRequest`: the ordinary path reads `consumesInto`, which names
catalog *slugs*, and the letter inside a sealed one is a runtime row no slug
in `docs/tags.yaml` could ever name. It is a `BREAK_SEAL` request, and it is
the one Request in the game that undoes **exactly** — nothing was destroyed,
so re-waxing the row and taking the envelope back is the whole of it. What it
cannot undo is that they read it.

## 6. The Bird

The Bird carries an object now. It used to hold text of its own, ciphered into
runes for a recipient who could not read; `db/lib/gribble.js`, the Read button
and `ReadDialog.js` are all deleted. Paper does that job better, because an
illiterate recipient holds a real thing and can walk it to somebody who reads.

Everything else survives untouched: the once-a-day claim keyed on the in-game
**day**, the reachable-zone rule at both ends, the guessed zone, the instant
`delivered` computation, and `birdPass.js`'s delayed failure notice.

**The letter only leaves your hands if it arrives.** A wrong guess means the
bird comes back with it still tied on. Burning a player's letter as the price
of a bad guess would be a second punishment nobody was warned about — and the
guess already costs them the day's send. The sender's receipt says nothing
about whether it landed, for the same reason the failure notice is delayed.

The Reply button opens a **string select of the replier's held letters**, not a
modal: you write with the Write button, which has a real text box and no
three-second clock on it, and post it here. A reply can therefore go out
sealed, which a modal could never have expressed.

`BirdMessage.body` survives as the GM's snapshot of what went — null on a
sealed letter, because the bird did not open it either.

## 7. Noticeboards

`noticeboard: true` in a Location's `attributes:` map
(`docs/zones.yaml`, registered in `db/lib/locationAttributes.js`, which refuses
an unregistered key). Set on the Square, the Gatehouse, the Garrison, the
Factory and the Depot.

The button is the **fifth** on the Location anchor, which is exactly Discord's
per-row cap — anything after this needs a second row. `locationAnchorRow` takes
the whole Location rather than a bare id so it can read the attribute.

The panel is **ephemeral, and three selects rather than buttons per notice**:
five action rows would overflow the board at three papers.

- **Read** — `readBlock` against live tags, the open turn's phase and the
  Location's `indoors`. Either the refusal or the full text in a code block,
  which also stops anything written on it rendering as markup or pinging
  somebody. Nobody is told it was read.
- **Tear down** — open to anyone standing there, including on somebody else's
  paper. A board you cannot strip is not a board. The delete *is* the claim, so
  two people tearing at one paper cannot both walk away with it.
- **Pin** — written or sealed, and never gated on literacy. `NoticePost.tagId`
  is `@unique`: a paper is on a board or in somebody's hands, never both.

A pin and a tear each raise an ambient `-#` line naming the **paper and never
the person**. Anonymous notice-pinning is the point of a public board.

`GameConfig.noticeExpiryTurns` (default 10, live on `/gm/dev`) is how long one
stays up, counting the turn it went up in. **An expired notice is destroyed,
paper and all** — it blew away, which is what makes tearing one down worth
doing. The `noticeboard` pass in `db/index.js` deletes the `NoticePost` and the
`ephemeral` Tag row with it.

## 8. Where the code lives

`db/lib/reading.js` (the gate), `db/lib/paper.js` (names, descriptions, the
per-viewer composition), `db/lib/paperMint.js` (the four writes),
`db/lib/noticeboard.js` (board copy and the attribute),
`db/lib/merchantSeal.js` (his initials),
`web/app/(app)/character/paperActions.js` (Write and Seal),
`bot/src/lib/noticeboardPanel.js` (the board), `bot/src/lib/birdReply.js` (the
answer), `docs/tags.yaml` + `docs/zones.yaml` (the catalog and where the
stamps start).

## 9. What this does not do

- **No forgery.** The `forger` tag — "You know how to make letters, seals, and
  writing appear as though another wrote it" — is the obvious next hook, and
  this is what makes it possible. Nothing implements it yet.
- **No copying.** There is no way to duplicate a letter. Transcribing one is
  Write plus retyping, which seems right.
