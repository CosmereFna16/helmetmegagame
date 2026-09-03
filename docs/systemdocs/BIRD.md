# The Bird: a letter to one person in one place

One narrow, expensive crossing of the game's zone isolation, and the first
mechanical job the Literate tag has ever had. Companion to `REQUESTS.md` (the
surface it files through), `TAGS.md` (the two tags that gate it) and
`TURN-ENGINE.md` (the pass that delivers its bad news).

## 1. The shape of it

Ravenheart has no way to talk to someone who isn't standing next to you. That
is deliberate — zone isolation is most of what makes the game a game — and the
only crossings are travel and a GM. The Bird adds one more, and prices it:

1. A character holding both **Bird** and **Literate** presses the bird on the
   Actions grid.
2. They pick a person, **guess which zone that person is standing in**, and
   write a letter.
3. If the guess is right and the recipient is alive, the letter is DMed to them
   **immediately**, with a Reply button — unless they can't read, in which case
   see §5.
4. If the guess is wrong, or the recipient is dead, nothing happens — and the
   sender is told **at the next turn close**: *"The message wasn't delivered."*

One letter per in-game day. A day is two turns, so that is one letter every two
turns.

## 2. Why the failure is delayed

This is the single most important decision in the feature, and the easiest one
to "fix" into uselessness.

An immediate "not delivered" would turn the Bird into a **once-a-day oracle**:
name a person, name a zone, and get a certain yes-or-no about whether they are
alive and standing there. That is worth vastly more than a letter, and it would
be the only thing anyone ever used it for. Delaying the answer by a turn makes
it stale on arrival — which is also exactly what a bird flying home overnight
should feel like.

The same reasoning fixes the wording. **A wrong guess and a dead recipient
produce the identical sentence.** Two different messages would be two different
questions, and one of them would be a reliable death detector. The one string
lives in `db/lib/bird.js#NOT_DELIVERED_DM` so it cannot drift into two.

Three more disclosures are closed off the same way:

- **The recipient dropdown lists every character, alive or dead.** A list of
  the living updates itself into a casualty report that anyone can read twice a
  week by opening a dialog. This is the same rule `REQUESTS.md` §3 gives for
  leaving the transfer dropdowns unfiltered. There is a search box over it,
  because a hundred-odd names in one `<select>` is unusable — but it narrows on
  the text the player typed, never on liveness, so it discloses nothing they did
  not already have to guess.
- **The sender gets a receipt either way**, saying what they wrote and where
  they sent it — never whether it landed.
- **The failure is reported even to a sender who has since died.** Skipping
  them would make silence itself informative.

## 3. Where a bird will not go

Only the five above-ground zones are addressable: **Town, Fortress, Forest,
East Forests, Marshes**. Caves and Depths are out, and so is the Underground
group zone, which nobody stands in anyway (`MAP.md` §1).

**Both directions.** You cannot send a letter underground, and you cannot send
one out. One-way would make the Depths a hiding place with a mail service.

`db/lib/bird.js#birdZones` is the only place that rule lives; the picker and
the server action's re-check both read it.

## 4. The reply

The letter's DM carries a **Reply** button. It is live during the turn the
letter arrived in **and the turn after** — `BirdMessage.replyDeadlineTurn`
holds the last turn that accepts one. Past that the button answers *"It's too
late. The bird flew away."*

The window is two turns rather than one for a plain fairness reason: a letter
sent five minutes before a turn closes would otherwise be unanswerable in
practice, and a rule that fires on when the *sender* clicked reads as a bug.

The window is checked twice — when the button is pressed **and** when the modal
is submitted. A player can leave a modal open across a turn boundary, and the
submit is the check that cannot be outrun.

One reply, never a chain. It costs the replier nothing, needs no bird of their
own, and does not reveal where they are.

`bot/src/lib/birdReply.js` runs entirely in a DM, so `interaction.guild` and
`interaction.member` are null. It never touches either: every party is
snapshotted onto the `BirdMessage` row, so answering a letter needs no lookup
against live state at all.

## 5. Illiteracy, and the Read button

A recipient without **Literate** still gets the letter. They just can't read
it: the body arrives enciphered, under a `-#` line telling them to show it to
someone who can. They get no Reply button — answering a letter is writing one,
and that is the same gate the sender had to pass.

The missing button is only the hint. The lock is in `windowState()`
(`bot/src/lib/birdReply.js`), which re-reads the replier's tags alongside the
reply window, so a GM stripping **Literate** between the letter landing and the
answer going out is caught on both the button and the modal submit.

That is the point. Illiteracy becomes something a player *plays through* —
find a reader, decide whether to trust them with your mail — rather than a wall
that eats the message.

The decoder is the second Actions-grid button, **Read**, visible to any
Literate character. Paste the runes, get the words.

**Read is the only entry on that grid that files no Request.** No server
action, no cooldown, nothing written anywhere. The letter has already been
delivered; decoding it is a thing a character can do, not a thing that happens
to the world. There is nothing to review and nothing to undo. Don't go looking
for the missing action (`web/app/components/ReadDialog.js`).

### 5a. The cipher

`db/lib/gribble.js`, and it is meant to be reused by every Literate feature
that comes after this one — that is why it lives on its own rather than beside
the Bird.

```
plaintext -> UTF-8 bytes -> append a 2-byte checksum
          -> XOR against a keystream seeded from a fixed key plus a 2-byte nonce
          -> pack 3 bytes into 4 six-bit symbols -> 65 Runic codepoints
```

The obvious design — map each letter to a rune, keep the spaces — is the wrong
one. Word lengths survive, letter frequencies survive, and a paragraph falls to
a pencil in about ten minutes. So the output here is flat instead:

- **No word shapes and no spaces.** The whole letter is one unbroken block.
- **The nonce means the same sentence never ciphers the same way twice**, so
  nobody learns anything from recognising a repeated block.
- **The checksum** is what lets `decodeGribble` return `null` on anything that
  isn't one of ours, so the Read box can say *"This isn't written in any script
  you know"* instead of printing mojibake.
- **Runic is in the BMP**, so one rune is one Discord character. 900 characters
  of letter become 1208 runes, which keeps the DM under Discord's 2000-char
  ceiling with the `»` and the footer on top. An astral script like Deseret
  would double every length.

**This is obfuscation, not cryptography, and the module says so at the top.**
The key is in the repo. It is built to defeat pen-and-paper analysis and a
Google search of rune charts — that is the actual threat, a player without the
tag reading their own DMs — and nothing more.

`decodeGribble` drops anything outside the alphabet before decoding, so a
player can paste the whole DM (the `»`, the footer, stray newlines) and it
still works.

## 6. Once a day

`Character.birdTurnId`, and it holds the in-game **DAY**, not a turn id —
for the reason the retired `fastTravelTurnId` beside it once did. A day is
two turns, so keying it on the turn would quietly hand out two letters a day
instead of the one the feature promises.

The claim is a conditional `updateMany` **whose WHERE is the check**, taken
before anything else in the transaction. Read the column in one statement and
write it in another and two tabs both pass; a loser aborts before a letter has
been written or a request filed.

## 7. What a GM sees

A `BIRD_MESSAGE` Request, carrying the **plaintext**. Without it the feature
would be a private channel between two players that nobody can review, which is
not a thing this game has. The ciphering happens when the DM is composed, never
on the way into the database.

For the same reason, a ciphered DM carries its own plaintext in
`DirectMessage.meta` — otherwise a GM reading an illiterate player's
conversation on `/gm/messages` sees only runes.

**Bird is the one Request with no reason box.** `RequestDialog` takes
`reasonRequired={false}` for it, and the server action fills the `Request` and
`AuditLog` reason columns with the letter itself, clipped to
`MAX_REASON_LENGTH`. The letter *is* the record: the plaintext is already filed
on the row, so a separate one-line justification asked the same question twice
and made sending mail feel like filing a form. Every other Request still
requires one — see `REQUESTS.md` §1.

**Undo is the one place this type is unlike every other.** A sent DM cannot be
recalled. Undo hands back the day and closes the reply window, and its note says
plainly that a letter which landed stayed landed.

## 8. Anything else worth knowing

- **The letter is signed.** Every other DM fired by `notifyCharacter` is
  deliberately unattributed (`REQUESTS.md` §3), because those describe things
  done *to* a helpless person and the identity is what's being withheld. A
  letter nobody can attribute is not a letter — choosing to tell someone who
  you are is the whole act.
- **A player with DMs closed silently loses the letter.** `notifyCharacter`
  swallows send failures by design, so the sender's day is burnt and nobody is
  told. This matches every other notifier in the app rather than being special.
- **Catatonic, Bound, Dying and buried recipients all receive normally** — they
  are `ALIVE`. A catatonic recipient is an AFK player, so the letter vanishes
  into a mailbox nobody opens, and it costs the sender their day. That is the
  correct fiction.
- **The Meister starts with a Bird** (`docs/roles.yaml`), because the role's own
  description has always said it uses the Keep's messenger ravens. Only the
  mechanical tag was missing.
