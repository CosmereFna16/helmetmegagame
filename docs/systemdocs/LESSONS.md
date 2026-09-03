# Lessons and consent handshakes

Learn Skill and Teach Skill on `/character`, the Teaching tag tree, the
`Offer` model both of them and Bind run on, and the turn pass that resolves a
lesson. This is the game's first code-adjudicated Gambit.

## 1. The rules

- **Teaching** (5 pt, `general-traits`): you can train someone in a skill you
  have. Teaching is your **Routine** for the turn; learning is the student's
  **Gambit**. They succeed on a **5 or 6** — the die after its modifier
  (Hunger, Disappointed; `db/lib/gambitModifier.js`).
- **Teaching (Lecturing)** (5 pt, upgrade of Teaching): up to **three**
  students on the one Routine.
- **Teaching (Drill Instructor)** (3 pt, `general-watch`, so Watchman-only;
  requires Teaching): a student learning a **fighting skill** (group
  `skills-fighting`) succeeds on a **4, 5 or 6**. Stacks with Lecturing. It
  replaced the old Drillmaster tag.
- Thresholds are fixed. There is no "each attempt lowers the difficulty".
- Both sides have to be standing at the same Location and unconcealed
  (`db/lib/presence.js`), and neither may already have locked in a Move for
  the turn — except a Lecturer whose Move is already a lesson Routine with
  room left.

Constants: `db/lib/constants.js` (`TEACHING_SLUG`, `LECTURING_SLUG`,
`DRILL_INSTRUCTOR_SLUG`, `FIGHTING_GROUP_SLUG`, `LECTURE_CAPACITY`,
`LESSON_THRESHOLD`, `DRILL_THRESHOLD`).

## 2. What can be taught

A tag is a **skill** for this purpose when `Tag.teachable` is true — a flag in
`docs/tags.yaml`, set on every entry in the `skills` category, not a category
heuristic (TAGS.md §5). `db/lib/lessons.js#teachableSkills(teacher, learner,
catalog)` is the one rule, used by the page to build the menus and by the
offer and accept paths to re-check them:

- the teacher holds the skill **or a higher tier of it** (`parentTagId` chain
  — a Melee (Expert) can teach Melee (Basic));
- the learner holds neither it nor a higher tier;
- the learner holds its `parentTagId` when it has one, and its `requiredTagId`
  / group gate — a lesson can't skip a prerequisite the store won't.

On success the skill lands with `TagSource.LESSON` and the tiers below it come
off (`db/lib/tagWrites.js#replaceLowerTiers`), same as buying the upgrade.

## 3. The Offer

```
Offer { kind LESSON|BIND, status PENDING|ACCEPTED|DECLINED|CANCELLED|EXPIRED|RESOLVED,
        turnId, initiatorId, responderId,
        teacherId?, learnerId?, tagId?, threshold?, learnerActionId?, teacherActionId?,
        outcome?, reason? }
```

A handshake between two characters, alive for one turn. The **initiator**
pressed the button on the web; the **responder** gets a DM with two buttons
(`db/lib/offerRow.js`: `offer:accept:<id>` / `offer:decline:<id>`), answered
by `bot/src/lib/offers.js`. The click's acknowledgement is
`interaction.update()`: the buttons come off the message and the outcome is
written under it, so nothing can be clicked twice and no message id has to be
stored. A stale button just says the offer's gone.

Character ends are snapshot ids without FKs — the log-table convention. A
dead character's offers stay readable.

### 3a. Lesson: offer → accept → resolve

1. **Offer** (`lessons.js#createLessonOffer`, from `learnRequest` /
   `teachRequest` in `character/requestActions.js`). Validates both sides and
   the **initiator's** Move slot, refuses a duplicate PENDING offer for the
   same pair and skill, writes the row, returns the DM. The learner-initiated
   DM is Bascinet's line: "*X* wants to try and learn *Y* from you. Accept?"
2. **Accept** (`lessons.js#acceptLesson`). Re-validates everything for
   **both** sides — same open turn, `moveWindow` not locked, both alive and
   here, teacher still teaches, skill still teachable, learner has no Action,
   teacher has none or a lesson Routine with capacity — then in one
   transaction: claim PENDING→ACCEPTED (`updateMany`, count 0 = someone
   answered first); create the learner's Action (`GAMBIT`, `CONFIRMED`,
   `moveReviewStatus OPEN`, die rolled and modifier stored now like any
   Gambit, `gmNotes: "auto:lesson"`); create the teacher's Routine
   (`CONFIRMED`, `PASSED`, `appliedEffects: {}`, `auto:lesson`) or widen a
   Lecturer's existing one; stamp `threshold` and both action ids. Any refusal
   after the claim leaves the offer **CANCELLED**, never PENDING, and DMs the
   initiator why. `@@unique([characterId, turnId])` is the real gate; a P2002
   is a refusal, not a crash.
3. **Resolve** (`db/lib/lessonPass.js`, the `"lessons"` pass — between
   `defaultMoves` and `stagedPush` in `TURN_PASSES`). For each ACCEPTED lesson
   on the closing turn: learner Action gone → CANCELLED (a GM rejected it);
   Action already `SOLVED` → RESOLVED with `outcome.gmDecided`, no grant (the
   GM's word stands); otherwise `total = diceRoll + diceModifier`,
   `succeeded = total >= threshold`, grant on success, set the Action `SOLVED`
   with a `resultMessage`. Both sides are DM'd the die and the result in one
   line, so `stagedPush.js` skips its own 🎲 DM for `auto:lesson` Gambits.
   Every PENDING offer on the turn expires with a DM to the initiator.

A lesson resolves where it was accepted: moving away or a teacher dying
before turn end changes nothing. Death voids **PENDING** offers only
(`characterDeath.js`). A GM **Reject** of either Move
(`web/lib/moveEconomy.js#deleteActionRestoringTurn` →
`lessons.js#cancelOffersForAction`) cancels the lesson; rejecting the
teacher's Routine deletes the stranded learners' Gambits too and DMs them that
their Move is free again.

### 3b. Bind: consent unless helpless

`bindCharacterRequest` (`db/lib/bind.js`): a target who is DEAD or holds an
`INCAPACITATING_SLUGS` tag is bound on the spot, as before. Anyone else gets
an Offer of kind BIND and the DM "*X* wants to bind you. Accept?" Accept
re-checks co-presence, alive, not already bound, same open turn, then
`applyBind` — the one function that grants `bound`, writes the
`BIND_CHARACTER` Request (`effect.offerId`, `effect.consented`) and the audit
row, used by both doors. Consent DMs **name the actor**; the old rule that a
victim's DM never does still holds for Loot and Harm.

## 4. The web

- `character/page.js` builds `teachers` (everyone here who can teach, each
  with the skills they could teach **me**) and, when I hold Teaching,
  `learners`. Only skills I could learn cross the wire — never another
  sheet. `pendingOffers` is every PENDING offer I'm part of this turn;
  `StatusPanel.js` shows it under "This turn" ("Waiting for Ada to accept…").
- `actionRegistry.js`: `learn` greys on `canLearn` (nobody here offers me
  anything) and `teach` on `canTeach` (I don't hold Teaching) — both facts
  about my own sheet or a list the server already filtered, so greying is
  allowed.
- `/gm/turns` shows a lesson as an ordinary Gambit whose description starts
  "Learning …" with `auto:lesson` in the notes. A GM who writes a result
  before the push wins; a GM who Rejects cancels the lesson.

## 5. Where the code lives

| Thing | File |
|---|---|
| Eligibility, offer, accept, decline, cancel hooks | `db/lib/lessons.js` |
| Turn pass | `db/lib/lessonPass.js` (`"lessons"` in `db/index.js`) |
| Bind, both doors | `db/lib/bind.js` |
| Button row + prefixes | `db/lib/offerRow.js` |
| Bot click handlers | `bot/src/lib/offers.js`, routed in `bot/src/events/interactionCreate.js` |
| Co-presence rule | `db/lib/presence.js` (web: `web/lib/peopleHere.js`) |
| Web actions | `web/app/(app)/character/requestActions.js` (`learnRequest`, `teachRequest`, `bindCharacterRequest`) |
| Menus and status line | `character/page.js`, `RequestActionsProvider.js`, `StatusPanel.js` |
| Catalog | `docs/tags.yaml` (`teaching`, `teaching-lecturing`, `teaching-drill-instructor`; `teachable:` on skills) |
| Player text | `docs/documents.yaml` `teachingskills`, `docs/handbook.md` "Teaching" |
