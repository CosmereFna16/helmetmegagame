# Playtest feedback — organised

## Context

Raw feedback from the playtest, sorted into categories. **Nothing has been
dropped, merged, or reworded** — every line from the original appears exactly
once below, verbatim. Where a line was ambiguous I put it in **Other** rather
than guess at a home for it.

`[*]` marks items I could take on myself right now: I can locate the code, and
the change doesn't need a design decision from you first. Items without it need
your call on a number, a rule, or wording — or I couldn't localise them.

`[x]` marks items that are **fixed and on `master`**, with the commit noted.

I verified the code behind several of these before tagging (notes inline).

---

## Bugs

- [*] I had it happen earlier by accident and just reproduced it, where if you swap locations at speed on the site you can be in two locations at once, (rn I'm in both the cathedral and town square)
- [*] wapping sub locations rapidly
- [x] Typing result in adjudication  GLITCHES and brings up edit magdalene in dev panel
- [x] Any interaction with adj panel brings up there
- [x] GM specific bug, if you try to type in GM notes on a request, it takes you out of the text box and hovers the "Edit character in the Dev Panel" button. This occurs after typing a single character
- [*] Radio system completely broken, no watch channel
- [*] Many commands appear twice
- [*] Baron dynasty name glitched
- [*] Ravenhearter tag not visible
- [*] Diguise kit visibility
- [*] Web hook displays letter instead of appearance
- Neither :x: nor :pencil or examine work in private thread
- Edit only work if its the only emoji
- [x] Examination text got publicly put in square channel?
- [x] Also audit log truncated wtf
- [x] **move messages cut off by character limit
- [*] Search conversation searches recent text, not the whole text
- [*] Search in tag add and store work across categories
- Skills concealed
- [x] Torturer didn't yield info
- Error console
- Error log, why error for keni_player no submit move?
- Guy changes location but guy already rolled and made a move saying where he was going to be ]'
- "i just finished making my char and someone took my role " lock roles, ghold
- Guise [DRAW], OP
- isnt working for me anywhere

> **Note on the focus-stealing bug.** Root cause found, and it's one line.
> `Modal.js`'s focus effect lists `onClose` in its deps, and both adjudication
> panels pass a fresh arrow function each render — so every keystroke re-runs the
> effect and focuses the panel's first focusable element, which is the
> "Edit … in the Dev panel" link in the header. Its `onFocus` opens the hover
> card. That's why *any* field in the panel does it. Fixing the dep array fixes
> every modal in the app at once.

> **Note on the public examine leak — FIXED.** `messageReactionAdd.js` sent the
> inspect embed as a DM, but on any DM failure fell back to posting it in the
> channel the reaction happened in — name, appearance, tags, Desire and Fear,
> into the room. It looked random because it depended on the *reactor's* DM
> settings, not on the message. The dossier handler already refused to do this
> and said why in a comment; the inspect path just never got the same treatment.
> Both fallbacks (the concealed and the normal branch) now log and drop instead.
> A bounced DM means the inspect goes nowhere, which is the only safe outcome —
> a reaction has no ephemeral reply to fall back to.

> **Note on Torturer/Seductive yielding nothing — FIXED.** Two separate causes.
> First, a real bug: the `mindreading` tag (granted by the Succubus Draught,
> and advertised to players in `docs/documents.yaml`) promised the same sight
> as Seductive/Torturer but was never wired into `db/lib/inspectVision.js`'s
> slug lists — so drinking it bought nothing. Fixed by adding it to both
> lists. Second, not a bug: `Character.fear` and an ACTIVE `Desire` are both
> set through player requests, not at creation, so in a fresh playtest almost
> nobody has either — the field was correctly absent, but absent looked
> identical to broken. Fixed by giving a *holder* of the sight an explicit
> "Nothing you can read." when the target has nothing set, while leaving the
> field fully absent for anyone without the tag (so the no-advertising rule
> for non-holders is untouched).

> **Note on auto-dismissing "Sent." confirmations — DONE, partially.** Added a
> `fleeting` option to `bot/src/lib/respond.js` that self-deletes an ephemeral
> reply after two minutes. Applied it only to bare acknowledgements that carry
> no information worth keeping — `/gm`, `/dm`, `/add`, `/remove` — and
> deliberately did NOT wire it into `respond()` globally or onto the Move/labor
> dice-roll confirmations, the Speak jump link, or any failure message: those
> are the only record of something, or tell the player their work didn't
> happen, and auto-deleting them would reintroduce exactly the silent-failure
> problem `respond.js` exists to prevent. `/heal`'s "Cleared…" confirmation
> uses a different, multi-step select-menu flow and was left alone rather than
> risk deleting the wrong message out of that chain.

> **Note on hunger escalation — DONE** (not from the raw feedback below; a
> direct ask). Hunger used to be a flat −1 to Gambits for exactly one turn.
> Added `Character.hungerStreak`, written only by `db/lib/hungerPass.js`:
> increments each turn a character closes hungry, resets to 0 the moment
> they're fed (paid, ate a meal, or hold Hungerless). The Gambit penalty now
> scales with it, floored at −6, via `db/lib/gambitModifier.js`. At the −6
> cap the pass grants `dying` — permanently, same as every other terminal tag
> chain — and a GM confirms the death by hand from there; nothing in the turn
> engine kills anyone outright. Needs `npm run db:migrate:deploy` before the
> next deploy — see the migration under `db/prisma/migrations/`.

> **Note on the two-locations bug.** The database is fine — `locationId` is a
> single column and travel is transactional. What duplicates is *Discord channel
> access*: the sync revokes the old location's overwrites and grants the new
> one's as a delta, so two fast hops interleave and leave you holding both. Free
> same-zone hops write no Action row, so nothing serialises them — which is
> exactly why it reproduces "at speed". The fix is to reconcile absolutely
> against the current location rather than swapping differentially, so it's a
> moderate change rather than a one-liner.

> **Note on the audit log.** Rows aren't missing — the query pages properly at 50.
> It's the Details column, which is CSS-truncated to one line.

> **Note on the dev panel tags.** Three separate causes: the "group" sort mode
> sorts by tier chain rather than `TagGroup` (so it degrades to alphabetical),
> only one category is ever rendered at a time with no group headers, and each
> tag is a full card. `PointBuy.js` already has a `sections` memo that buckets by
> group with names and colours — lifting that out is the fix for all three.

> **Note on the letter plaques.** Probably not a code bug: the avatar route only
> falls back to a letter when `avatarData` is null, and an upload is silently
> discarded when `GameConfig.avatarUploadsEnabled` is off. Check that switch
> before treating it as code.

> **Note on the private-thread reactions.** I couldn't find a cause. There's no
> channel-type filter and no reaction-count check anywhere in the handler, so
> neither half of the report matches the code as written. It needs runtime
> logging before anyone can fix it — which is why it's untagged.

> **Note on duplicate commands.** The bot registers commands exactly once, and
> globally (`client.application.commands.set`, `bot/src/lib/commands.js:126`) —
> there's no second guild-scoped registration in the code. So the duplicates are
> almost certainly stale guild commands left over from an earlier deploy, sitting
> alongside the global ones. Clearing them once with `guild.commands.set([])`
> should do it.

> **Note.** Both `Ravenhearter` and `Disguise Kit` already carry `visible: true`
> in `docs/tags.yaml`, which the sync maps to `Tag.visibleOnInspect`
> (`db/lib/syncTags.js:226`). So the catalog is right and the bug is downstream —
> either the tag sync hasn't run against that database, or the inspect renderer
> filters further.

---

## GM tooling — Adjudication panel

- [*] Color open as orange in arbitration panel
- [*] Move status in table all the way to the left, adj/request
- [*] Always show status (like unsolved) in filter dropdown even if there's no unsolved, for clarity
- [*] Adj table compress show role
- [*] Compress GM notes and request
- Adjudicate screen should make clear things between turns, like a new panel or something, because right now you still see old ones. Or maybe color coding old turns as different
- Adjudication panel  needs to let you message multiple people\
- Adjudicate panel needs to integrate with dev tab so I can add tag right there and then
- Redo result, make it a public thing, idk, GM notes?
- Cancel move?
- Overall minimize GM load to just adjudicating, and make that process as simple as possible

---

## GM tooling — Dev panel

- [*] Dev panel so bad doesn't show tags, sorted alphabetically instead of groups, tags too big
- [*] Sort dev panel health hates by group, universalize
- [*] Change order within group to cost, not Alph
- [*] Dev panel show character's face
- [*] Jump to messages from dev panel and player panel
- Dev panel teleport player to location
- Set location button
- Dev panel mass assign tags weapons etc not just health
- Tag to apply dropdwon in player bad system needs redo

---

## GM tooling — Messages

- Message panel redo I wanna type innkeeper and have him pop up
- Remove message panel, just unify with players
- What about a responsive message interface, open and see while also having others to the left, scroll, like discord
- [*] Embeds in message, seems kinda weird. Don't show last message from ME—show last message form PLAYER
- Message pings

---

## Player-facing UI — character panel & profile

- [*] Need to see your moves on the character panel, currently invisible
- [*] I think we should be able to add some more into our description when folks look at us. 100 characters is kinda short..
- [*] Bigger, more centered avatars
- [*] Laborer farming and specialist tags should show the amount, linking it, in the tooltip
- [*] Tags should not show their resource cost on examine
- Identify other character's roles—set a public role.
- Mortii garb to identify (is that a good system for seeing what role is what role)
- See fellows roles on faction screen
- Leaders see role of followers, everyone in faction
- is there a way to see who is in the room?
- forum post needs to automatically update.

> **Note.** The description cap is `APPEARANCE_MAX_LENGTH = 100` in
> `web/lib/constants.js` — a one-line change once you pick a new number.

---

## Character creation

- [*] Two Lorenzo Ferraris, need a lot more random names
- [*] Limit first and last name to one word
- Name AFTER point buy
- Titles limited, mortis should not be a constable, do tags after, select gender
- Disable titles like lord, require lord tag
- Forced people to select mr or ms
- Player ta add discord username
- also roles that do start with gear should be communicated to the player during gear selection ^
- communicate starting tag in store

> **Note.** The random-name pool is `db/lib/nameCorpus.js` — plain JS arrays
> grouped by register, so widening it is purely additive.

---

## Tags — balance and fixes to existing

- [*] Knuckle duster 2 pt
- [*] Nerf in debt to 7 or so
- [*] Clarify ni debt tag: YOU SELECT SOMEONE
- [*] Mulligan potion require bandit
- [*] Mute disadvantage tag, requirement sign language
- [*] Typo serpent desc
- [*] One follower only clarify
- [*] Clarify follower
- [*] Clarify follower kind of subsumed into your move
- Make jester tag cheaper
- Up pretty cost,
- Beautiful upgrade
- Split windlander tag, wnidland immigrant, combine with sign language
- Doctor tag limited
- May remove follower tags
- Remove followers
- Remove laborer option from follower
- Loloks tags
- Cap bum force peasant

---

## Tags — new ones requested

- Ugly tag
- Add glasses tag
- Mime's vow tag
- Blunt force trauma tag
- daggers

> **Note.** None of these exist in `docs/tags.yaml` yet. `pretty`, `beautiful`,
> `mute`, `in-debt`, `knuckle-duster`, `jester-outfit`, `mulligan-potion`,
> `disguise-kit` and `sign-language` all do, so the balance items above are
> edits rather than additions.

---

## Roles and starting gear

- Starting tag watchman cudgel disabler
- Radio bracelet start
- Trim roles, assume less players
- Disabel role location
- Need a lot more tasks
- Intercom baron
- The following loadout list:
  - Ravenhearter
  - Watchman
  - Fighting (Trained)
  - Dog
  - Disabler
  - Radio System
  - Radio Bracelet
  - Alcoholic
  - Broadsword
  - Simple Helm
  - Buckler
  - Mail Coif
  - Mail Shirt

> **Note.** The Watchman's `starting_tags` in `docs/roles.yaml` are currently
> Ravenhearter, Watchman, Fighting (Basic), Disabler, Radio Bracelet. The list
> above is longer and upgrades Fighting to Trained — I don't know which role
> it's meant for, so I've left it untagged.

---

## Discord, channels and proxying

- [*] Make turn channel wipe on new turn, other messages too
- [x] Auto dismiss hidden messages like sent etc
- Pretty up pin channel post
- Explain channels / summary etc better
- GM can see all Chanels, QOL, no idea where my location is

---

## Documentation and player onboarding

- Biggg tutorial—how to resources etc
- COMMUNICATION DOC: explain how to ping other characters
- Adda How To Talk thing to the forum pinned post, saying how to use private thread
- Document full list of health tags for doctors
- Make a list of commands
- Resources - mercenary - document doesn't explain
- Clarify requests— don't need to edit
- Remove open requests from the description
- From the sounds of it perhaps there should be added a document to generally tutorialize users on the functions of the websites and where all the buttons are and different functions
- I know that I'm not supposed to associate my discord name with my character, but I'm unsure how I'd do that - do I just type in the chats of the area I'm in? Is there a way to handle talking to players privately? Adding a document about that for people who aren't familiar with systems like these would be nice. Communication doc
- [*] About halfway through, it says "It is protected by the Baren." not the Baron

---

## Player questions needing an answer

- Should an action be a small paragraph, or are there commands to use (for example examining another character's profile ?) ; if it's the latter, can a list of commands be provided somewhere ? I may have just missed it, in which case I'm sorry.
- Might be a bit much to open feedback for this, but I think it could help with some clarification. To spend resources, a -X (where X is the number of resources) needs to be added to the message. What happens if not enough / too many resources are used for an action ? To gather resources, you can use a fixed amount or a range. What prevents a player from always picking the highest possible amount of resources gatherable in their range ? I am also unclear whether actions that do not use resources should have -1 by default, since it costs 1 resource to survive a turn, or if that part's handled automatically. Finally, why is the player the one who chooses whether an action is simple of a gambit ? It feels like the GM should be the one to decide instead, no ?

---

## Game design and systems trimming

- Trim systems, reduce fat
- Streamlien resource gathering , just one way to do it
- Hungry 2 turn 3 turn 6 turn death

---

## Other

Fragments I couldn't confidently place, kept verbatim.

- Ask for web dev help
- Install supernatural meta project for claude c
- Feedback
- Disable
- Faction s
- (four blank numbered entries in the player's list: 4, 6, 11, and the trailing blanks)
