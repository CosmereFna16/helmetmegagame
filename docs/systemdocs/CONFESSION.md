# Confession

The Confess button on `/character`, the `psychological` flag it reads, and the
turn pass that decides whether the thing lets go. Read
[`LESSONS.md`](LESSONS.md) first — this is that handshake with one side's menu
deliberately removed, and everything below is written as a delta from it.

## 1. The rules

- A **penitent** picks a chaplain standing where they stand and one of their
  own `psychological` tags, and presses **Confess**. That is their **Gambit**
  for the turn.
- The chaplain gets a DM with Accept / Decline. Accepting spends the
  chaplain's **Routine**. There is no Lecturing rung: one confession is one
  whole day, and a queue outside the box is the intended texture.
- At turn end the penitent's d6 plus the ordinary Gambit modifier (Hunger,
  Disappointed — `db/lib/gambitModifier.js`) is checked against **5**. On a
  pass the tag comes off. On a fail it stays and the Move is spent.
- Both sides must be at the same Location and unconcealed
  (`db/lib/presence.js`), both alive, and neither may already have a Move.
- You cannot confess to yourself.

Constants: `CHAPLAIN_SLUG`, `CONFESSION_THRESHOLD` in `db/lib/constants.js`.

## 2. The asymmetry, which is the whole design

**There is no "Hear Confession" menu, and there never will be.** A chaplain
who could browse would be reading the addictions off everyone standing near
them before agreeing to hear a word — the sheet would hand them the sin for
free, and the sacrament would be worth nothing.

So the tag is kept from the chaplain at every surface:

| Surface | What the chaplain sees |
|---|---|
| The offer DM | "*Ada* wants to confess to you. Accept?" — no tag |
| Their own Routine (`Action.description`) | "Hearing Ada's confession." — no tag |
| `pendingOffers` on their sheet | `tagName` is nulled for a CONFESSION they are the responder on (`character/page.js`) |
| The turn-end DM | "Ada left lighter than they came." — no tag |

The GM sees all of it. The audit rows (`request_confession_offer`,
`confession_accepted`) name the tag, and so does the penitent's own Gambit in
`/gm/turns`. The chaplain is kept in the dark; the host is not.

## 3. `Tag.psychological`

A classification, not a capability flag — it fills the penitent's dropdown and
nothing else. Set in `docs/tags.yaml`, mapped in `db/lib/syncTags.js`.

Sixteen tags carry it: the five addictions (`alcoholic`, `drug-habit`,
`gambler`, `glutton`, `vain`), six compulsions and dispositions (`depressed`,
`craven`, `devoted-follower`, `prudish`, `nobility`, `kleptomaniac`),
`insomniac` and `heavy-sleeper`, `green`, and `stutter` and `shell-shocked`
out of `health-mind`.

**`health-mind` could not stand in for the flag**, which is why the flag
exists. Half that group is `blind`, `mute`, `night-blind`, `paralyzed` —
sensory affliction, not sin, and no amount of confession restores an eye.
`pacifist` is left off as a conviction rather than an affliction, and `stupid`,
`amnesiac`, `hallucinating` and `concussed` as permanent or already a doctor's
job.

Adding one is a line in `docs/tags.yaml` and a `db:sync-tags`. Nothing else
reads the column.

## 4. Who can hear one

Anyone holding the `chaplain` tag. **The gate is the tag and never the role** —
the Bishop holds the tag and is not the Chaplain role, and a Bishop who could
not hear a confession would be absurd. The `hear-a-confession` Desire was
repointed onto the tag for the same reason.

## 5. Where the code lives

| Thing | File |
|---|---|
| Eligibility, offer, accept | `db/lib/confession.js` |
| Turn pass | `db/lib/confessionPass.js` (`"confessions"` in `db/index.js`) |
| Button row + prefixes | `db/lib/offerRow.js` (shared with Lessons and Bind) |
| Bot click handler | `bot/src/lib/offers.js` (`acceptConfession` in the kind switch) |
| Decline | `db/lib/lessons.js#declineOffer` — kind-agnostic, shared |
| Web action | `web/app/(app)/character/requestActions.js` (`confessRequest`) |
| Menus and gating | `character/page.js`, `RequestActionsProvider.js`, `actionRegistry.js` |
| Catalog | `docs/tags.yaml` (`chaplain`, and `psychological:` on the sixteen) |

**Reused rather than rebuilt.** The `Offer` model carries the handshake
unchanged: `kind: CONFESSION`, the chaplain in `teacherId`, the penitent in
`learnerId`, the tag in `tagId`. Sitting them in the Lesson columns is
deliberate — the shared GM-reject hook (`cancelOffersForAction`) then needs no
special case, and the Routine/Gambit columns line up.

**Two things live in the lesson pass, not this one.**
`db/lib/lessonPass.js` expires every PENDING offer on the closing turn
whatever its kind, so `confessionPass.js` deliberately expires nothing —
two passes racing the same rows would buy nothing. Its expiry DM has a
CONFESSION branch, which also names no tag. And `cancelOffersForAction` in
`lessons.js` is shared, so its GM-reject DM says "confession" and "chaplain"
when the offer is one.

## 6. Edges

- **A GM who writes a result before the push wins.** An Action already
  `SOLVED` resolves the offer with `outcome.gmDecided` and lifts nothing.
- **A GM Reject** of either Move cancels the confession; rejecting the
  chaplain's Routine deletes the penitent's stranded Gambit and DMs them that
  their Move is free again.
- **Death** voids a PENDING offer only. An ACCEPTED confession still resolves
  — but a penitent who is not `ALIVE` at turn end fails it regardless of the
  die.
- **The tag going some other way** before turn end is harmless:
  `dropCharacterTag` is a no-op on a row that is already gone.
- The real gate on a second Move is `Action`'s `@@unique([characterId,
  turnId])`. A P2002 is a refusal, not a crash.
