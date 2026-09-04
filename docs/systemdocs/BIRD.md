# The Bird: a letter to one person in one place

One narrow, expensive crossing of the game's zone isolation. Companion to
`PAPERWORK.md` (what a letter actually *is*), `REQUESTS.md` (the surface it
files through), `TAGS.md` (the two tags that gate it) and `TURN-ENGINE.md`
(the pass that delivers its bad news).

## 1. The shape of it

Ravenheart has no way to talk to someone who isn't standing next to you. That
is deliberate — zone isolation is most of what makes the game a game — and the
only crossings are travel and a GM. The Bird adds one more, and prices it:

1. A character holding both **Bird** and **Literate** presses the bird on the
   Actions grid.
2. They pick a person, **guess which zone that person is standing in**, and
   pick a **letter they are already holding** — written or sealed
   (`PAPERWORK.md`). There is no text box; you write with the Write button.
3. If the guess is right and the recipient is alive, the paper **leaves the
   sender's sheet and lands on theirs**, immediately, with a DM saying so and a
   Reply button.
4. If the guess is wrong, or the recipient is dead, nothing happens — the
   letter stays in the sender's hands — and they are told **at the next turn
   close**: *"The message wasn't delivered."*

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
Black Hills, Marshes**. Caves and Depths are out, and so is the Underground
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

The window is checked twice — when the button is pressed **and** when the
letter is picked. A player can leave the picker open across a turn boundary,
and the pick is the check that cannot be outrun.

**Replying is a picker, not a modal.** It lists the letters the replier is
holding, because a reply is a piece of paper like any other: you write it on
your sheet, where there is a real text box and no three-second clock, and post
it here. That also means a reply can go out **sealed**, which a modal could
never have expressed.

One reply, never a chain. It costs the replier nothing, needs no bird of their
own, and does not reveal where they are.

`bot/src/lib/birdReply.js` runs entirely in a DM, so `interaction.guild` and
`interaction.member` are null. It never touches either: every party is
snapshotted onto the `BirdMessage` row, so answering a letter needs no lookup
against live state at all.

## 5. Illiteracy

A recipient without **Literate** still gets the letter. It lands on their sheet
like anybody else's — a real object, with real weight, that they can carry,
hand over, sell or burn. What they cannot do is read it: the tag chip says
*"You can't read this."*, and so does a noticeboard, and so does every other
surface, because they all ask one predicate (`db/lib/reading.js`).

That is the point. Illiteracy is something a player *plays through* — find a
reader, decide whether to trust them with your mail — rather than a wall that
eats the message. And an illiterate courier is now a genuinely useful thing to
be, which is new.

They get no Reply button: working the bird is writing, and that is the same
gate the sender had to pass. The missing button is only the hint. The lock is
in `windowState()` (`bot/src/lib/birdReply.js`), which re-reads the replier's
tags alongside the reply window, so a GM stripping **Literate** between the
letter landing and the answer going out is caught on both the button and the
pick.

### 5a. The cipher is gone

There used to be one — `db/lib/gribble.js`, which turned a letter into a block
of Runic so an illiterate recipient held something real but unreadable, plus a
**Read** button on the Actions grid that decoded it. Both are deleted, along
with `web/app/components/ReadDialog.js`.

Paper replaced it and does the job better. The cipher was a way of making a DM
behave like an object; a tag *is* an object, so it gets carry weight, Transfer,
Loot, room stashes and noticeboards for free, and nobody has to copy a wall of
runes into a box. See `PAPERWORK.md`.

`db/lib/babble.js` — the speech mangler for the `stupid` tag — is a separate
system and stays. It was never a cipher: there is nothing to decode there.

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

A `BIRD_MESSAGE` Request naming the letter that went and carrying a
**snapshot of what it said**, taken at send time. Without it the feature would
be a private channel between two players that nobody can review, which is not a
thing this game has — and the paper itself can be resealed, handed on or torn
up before a GM ever looks.

**The snapshot is null on a sealed letter.** The bird did not open it either,
and the desk is a record of what happened rather than an X-ray. A GM who needs
to know can read the paper itself, wherever it ended up.

**Bird is the one Request with no reason box.** `RequestDialog` takes
`reasonRequired={false}` for it, and the server action fills the `Request` and
`AuditLog` reason columns with the letter itself, clipped to
`MAX_REASON_LENGTH`. The letter *is* the record, so a separate one-line
justification asked the same question twice and made sending mail feel like
filing a form. Every other Request still requires one — see `REQUESTS.md` §1.
Write and Seal file no Request at all (`PAPERWORK.md` §4).

**Undo half-works, and says so.** It hands back the day, closes the reply
window, and **takes the paper back off the recipient** — but only if they are
still holding it. They may have handed it on, pinned it up or been looted of
it, and an undo that minted a second copy of a unique letter would be worse
than one that failed to recover it. The note says which happened. What nothing
can undo is that they read it.

## 8. Anything else worth knowing

- **The letter is signed.** Every other DM fired by `notifyCharacter` is
  deliberately unattributed (`REQUESTS.md` §3), because those describe things
  done *to* a helpless person and the identity is what's being withheld. A
  letter nobody can attribute is not a letter — choosing to tell someone who
  you are is the whole act.
- **A player with DMs closed silently loses the NOTICE, not the letter.**
  `notifyCharacter` swallows send failures by design, so the sender's day is
  burnt and nobody is told — but since the rework the paper is on the
  recipient's sheet whether or not the DM landed, so the letter itself survives
  a closed inbox. That is strictly better than it used to be.
- **Catatonic, Bound, Dying and buried recipients all receive normally** — they
  are `ALIVE`. A catatonic recipient is an AFK player, so the letter vanishes
  into a mailbox nobody opens, and it costs the sender their day. That is the
  correct fiction.
- **The Meister starts with a Bird** (`docs/roles.yaml`), because the role's own
  description has always said it uses the Keep's messenger ravens. Only the
  mechanical tag was missing.

## 9. A letter from the GM

`/gm/dev?s=letters`. A GM types a name, picks a living character, writes, and
optionally seals it with a mark they invent on the spot. The letter arrives
exactly like a bird's, and the answer comes back on that player's conversation
at `/gm/players`.

It **rides `BirdMessage`** rather than getting a table of its own, which buys
the reply window, the one-reply claim, the Reply button and the whole picker in
`birdReply.js` for free. Three columns loosened to allow it (the `gm_letters`
migration): `senderId` is nullable, `guessedZoneId`/`guessedZoneName` are
nullable, and `gmSenderDiscordUserId` records which GM wrote it.

Three things branch, and only three:

- **The paper is minted, not moved.** A player's bird takes a sheet out of the
  sender's hands. A God-King has no hands, so
  `paperMint.js#mintLetterFor` writes a fresh runtime row straight onto the
  recipient — the same `PAPER_SHAPE` as any written sheet, so it has weight,
  can be handed on, pinned up, stolen, and is swept by a Restart Game.
- **The seal is typed, not stamped.** `paperMint.js#sealWithMark` takes the
  label and the mark directly instead of deriving them from a wax-stamp `Tag`.
  Everything downstream is unchanged: `paperDescription` renders "…bears a
  seal: {mark}" to every viewer, and breaking it is the same Consume.
- **The reply is a row, not a sheet.** The replier's paper leaves their hands
  and goes nowhere — the bird carried it off — and its words are written as an
  **INBOUND `DirectMessage`** on that player's thread, `source:
  "gm_letter_reply"`. The outbound half is the delivery notice, `source:
  "gm_letter"`, with the letter itself in `meta`.

Both rows are keyed on the **player's** `discordUserId`, never the GM's: the
desk keys a conversation on the player, so a row under a GM's own id would open
a thread with themselves that nothing ever shows. `DmThread.js#LetterBody`
draws them as paper rather than as chat.

**A sealed reply's words ARE shown to the GM.** Everywhere else in this file a
seal is opaque to the system, because there the bird is a third party carrying
somebody else's mail. Here the GM is the addressee, and you open a letter
addressed to you.

### What it deliberately does not do

- **No day claim.** `birdTurnId` is the price of a *player's* crossing.
- **No zone rule.** A GM already knows where everyone is standing, so there is
  no guess to record — and a GM letter reaches the Depths, which §3 closes to
  every bird.
- **No `Request`.** A Request is a player's act filed for adjudication. This is
  a GM's, so it writes an `AuditLog` row and the conversation is the record.
- **It refuses between turns.** `replyDeadlineTurn` is the arrival turn plus
  one, so a letter sent with no turn open would land already unanswerable.
- **It refuses a dead recipient**, unlike the send picker, which lists the dead
  for the reason §2 gives. A GM already knows who is alive; minting paper onto
  a sheet nobody reads is just litter.
