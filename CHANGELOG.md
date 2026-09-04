# Changelog

Every push, newest first, in plain language for the GM team. Written by
`npm run push` and mirrored to Discord — see CLAUDE.md.
`✚` new, `−` gone, `✎` changed.

Entries below predate this format and list files instead.

## 2026-09-04 · The #info rebuild works again

✎ The command that rebuilds #info from its master file had been broken since the scripts were reorganised; it looked for a docs folder that isn't there, and then choked on the roles list. #info is rebuilt and carries the new turn cadence

## 2026-09-04 · Turns are a day long now

✎ A turn is a whole real day and ends at midnight CT, instead of the two 12-hour turns a day it used to be. Dawn and Dusk still alternate, so an in-game day is two turns and takes two real days  
✎ Everything measured in turns — hunger, the Catatonic clock, corpse rot, crafting, Depot fuel, Desire locks — now takes twice as long in real time  
✎ Moves are due at 9 PM CT, and the #turns message says so in everyone's own timezone  
− The ghost wind reaction. A dead player has no voice; their unburied body is what tells the room, and it now does so every 4-10 hours instead of every 2-5  
✎ The game runs 30 real days, reaching in-game Day 15

## 2026-09-04 · The Merchant's own till, and seven things the Depot got wrong

✚ A ⬢ counter at the Depot: Resources to obols and back at one flat rate with  
− The shuttle no longer converts loose ⬢ — one rate, one place  
✎ An unopened crate sent back up is worth what is inside it, instead of nothing  
✎ You can only order one of anything you can only carry one of, instead of  
✎ Opening a crate records what actually landed, not what the crate claimed  
✎ Undoing an order that already flew down is refused instead of refunding the  
✎ A shuttle called between turns no longer parks itself forever  
✎ The generator's death can actually be heard — the line was wired to the  
✎ The shuttle landing and departing are announced, which they never were  
✎ Arming the turret with no face on file is refused, not warned about: the cure  
✎ Undoing a refuel no longer mints back the fuel already burned  
✎ Tooltips and GM help text carry their ‡

## 2026-09-04 · The Merchant runs a station now, not a shop

✚ Obols (¢), a weightless coin worth 5 ⬢ at the Depot and nothing anywhere else  
✚ The account belongs to the station, not the Merchant — the licence carries it  
✚ Order into a manifest, call the shuttle, goods land as crates on a landing pad  
✚ Crates print their own manifest; dangerous wares ship SEALED behind a keycard  
✚ A generator that burns coal every turn and takes the Depot down when it empties  
✚ An indoor turret that reads faces, not papers — armour moves the whole table  
✚ A cockpit console with six tabs, a full price list, and a ledger  
✚ A Depot section on the Dev Panel for every number above  
− Character.depotDebt; the line lives on the station now

## 2026-09-04 · Mime's Vow, and a tag can be whitelisted to one seat

Vow of Silence is renamed Mime's Vow, and only a Minstrel can take it  
Tags can be whitelisted to a seat, not just blacklisted away from one, so a role-only tag no longer means listing the other 38 roles

## 2026-09-04 · The intercom is loud now, and it lands in the transcript

✎ The PA is no longer small grey subtext. Everything else the world says is scenery and sits under the conversation, but a loudspeaker is the opposite of scenery — and it pings everyone, so delivering it in the quietest text Discord renders was backwards  
✚ Announcements are recorded in the archive. They were the one kind of public talk missing from it  
✎ An announcement ending in ! or ? keeps its own punctuation instead of picking up a stray full stop

## 2026-09-04 · Vow of Silence is a Minstrel's, and nobody else's

Vow of Silence can only be taken by a Minstrel now  
Tags can be whitelisted to a seat, not just blacklisted away from one, so a role-only tag no longer means listing the other 38 roles

## 2026-09-04 · Nearsighted tells you to go and get spectacles

Nearsighted's description now points at Spectacles, since the tag is what unlocks Look at again

## 2026-09-03 · A body decides what it can carry, and bad eyes cannot look anyone over

Carry caps now ADD their bonuses instead of multiplying them, so a frail body costs everyone the same pounds whether or not they happen to be pulling a cart  
Giant, the priciest tag in the game, finally buys carry: +0.75, the biggest body bonus there is  
Frail, Old, Fat, Dwarf, the maimings and a dozen wounds all take a small bite out of what you can haul, floored at a quarter of the base so nobody is stuck permanently overburdened  
✚ Pack Mouse, the mirror of Pack Mule: narrow shoulders, -0.5, and 4 points back  
Strong now matches Pack Mule's carry instead of a fifth of it, having cost more and done less  
A crippled or missing leg costs you your free zone crossing, unless a horse is doing the walking. A peg leg still walks  
✚ Sun Sensitivity, a new drawback, and the first code Nearsighted and Spectacles have ever had: both now block Look at, and a greyed button says why on hover  
Twelve pairs of contradictory tags can no longer be bought together, Mute and Vow of Silence and Blind and Eagle Eyes among them

## 2026-09-03 · Drawbacks now run out two ways, not one

✚ A second limit at character creation: your drawbacks can claim back at most 12 points between them, on top of the cap on how many you may take  
✎ The cap on how many rises from 5 to 6. You stop at whichever limit you reach first  
✎ Before this, five drawbacks were five drawbacks whether they were worth 5 points or 43, so the only sensible play was to stack the worst afflictions in the book. A build could reach 55 points; it now tops out at 24  
✎ The creation screen grows a second budget bar showing what you have claimed back, with the tag count under it. Each goes red on its own, so you can see which limit stopped you  
✎ Both numbers are editable on the dev panel, and neither applies in the store — the limits belong to character creation and stop existing once play starts

## 2026-09-03 · Nobody can escalate the intercom to @everyone

✎ The PA's own @here still pings everyone in the zone. A typed @everyone, @here or role mention inside the announcement itself is now inert

## 2026-09-03 · The Baron can wave somebody into his office, and the intercom is a button again

✚ /add and /remove now work in a private room, not only in conversations — anyone already inside can let in somebody standing in the same place  
✎ A guest stays until they leave; walking out of the location shuts the door behind them, and coming back needs a fresh invite  
✎ A guest gets the whole room, not just the thread: the stash, the Transfer dialog, anything set up in there  
✎ /remove refuses somebody holding the room's key, and says to take the key instead  
✚ An Intercom button on the Council Room's table. It announces into every zone above ground except the Black Hills, and pings everyone there  
− The #intercom channel and the Intercom tag. Standing at that table is now the whole gate  
✎ Lines the world says — a gate crossing, the smell of death, whispering overheard, goods moved around a stash — are all small grey subtext now, so they stop competing with what players are writing

## 2026-09-03 · Mute and Stutter cannot be picked together, nor Dwarf and Giant

Mute now conflicts with Stutter, the way Deaf conflicts with Hard of Hearing  
Dwarf and Giant now block each other in the character creator

## 2026-09-03 · You can look someone over without saying a word to them

✚ A Look at button on the character sheet. Pick anybody standing where you are and see what a bystander could see: their face, their open injuries, whatever they are carrying openly  
✎ A concealed person stays concealed. You get the same impoverished read the magnifying-glass reaction gives, so a hood is still worth wearing  
✎ The magnifying-glass reaction only ever worked on somebody who had already spoken, which meant a guard could not size up a silent traveller without starting a conversation first. It still works, and both now show exactly the same thing  
✎ A medic still sees what their training lets them see, and a faction officer still sees a member's resources. Same rules as before, in one place now

## 2026-09-03 · A key weighs nothing: 0 becomes a real rung on the weight ladder

✎ Keys, letters, badges, spectacles and coins weigh nothing now instead of half a pound each — 0 is a real rung on the weight ladder

## 2026-09-03 · Devoted Follower needs somebody to follow

✚ Night Blind and Blind can no longer be taken together — curing Blind already leaves you Night Blind  
✚ Devoted Follower is closed to Migrants, Mercenaries, Bums, Outsiders and Pushers — nobody to be devoted to  
✎ Sewer Key weighs half a pound, like every other key

## 2026-09-03 · Hard of Hearing is worth less, and rules out Deaf

✎ Hard of Hearing gives 4 points instead of 5  
✚ Hard of Hearing and Deaf can no longer be taken together — one ear or none, not both

## 2026-09-03 · Tag stacking: set the count, and tag edits save on the spot

✎ The Dev Panel's Holds row now has a stepper showing how many they hold — type the number you want. Taking a stack of seven meals down to three is one gesture, not four clicks of Take one  
✎ Tag changes on a character's dev panel save the moment you make them, like Kill and Revive already did. No more staging a tag and hunting for Apply  
✚ Heal all, Feed and Inflict a wound now fire straight away and say what they did, instead of quietly staging  
✎ Removing a wound that leaves an aftermath behind still asks first, since putting the wound back will not clear it  
✎ One quantity control everywhere — craft, destroy, transfer, loot, the depot and both GM desks — with plus and minus buttons instead of nine slightly different boxes

## 2026-09-03 · Walking into an inn no longer empties your cart onto its floor

✎ Carrying is measured in pounds now, not item count. Every item has a weight; a horse, a cart, a house and anything grafted into you weigh nothing  
✚ Past 1.5× your cap goods simply can't be yours: a hand-over is refused, and a harvest or a cave haul that big drops around you  
✎ Overburdened no longer walls you in. It costs you your free zone moves, so you can still cross — you just spend your Move  
✚ Everyone gets one free zone crossing a turn; an equipped mount adds another, and it now works both halves of the day  
✎ Carts and horses must be equipped to do anything, and are left at the door of the Cathedral, Sanctuary, Inn, Keep, Undercroft and Factory  
✚ Workshop Equipment: a heavy craftable that smithing and building now require, held or set up where you stand. The old Workshop asset is gone  
✎ Surgical Equipment is +1 on any medical Gambit, and there is a real set in the Sanctuary's operating theatre  
✚ A medic can attempt any cure, including above their skill. It becomes a Gambit: it spends your Move and a bad roll can leave the patient worse  
✚ Routine treatment is rationed 2/3/4 a turn by medical tier. First aid is free and never counts  
✎ The Plow is an asset, so it stops weighing on a farmer's back

## 2026-09-03 · Every location can be examined, not just worked

✎ The Labor? button on every location channel is now Examine. It still says what the ground yields here, and now also what the place itself is and whether the ways out of it stand open or closed  
✚ Locations can carry attributes — facts about a place, written into zones.yaml, that Examine turns into a sentence. The Merchant's Depot is the first one to wear one

## 2026-09-03 · The changelog speaks plain language, and can be told to stay quiet

✎ Changelog entries now say what changed in the game instead of listing files  
✚ A --hidden switch on a push: nothing is written and nothing is posted  
✎ Lore and antagonist work is held back from the changelog by default

## 2026-09-03 · Weapons don't stack: you hunt with one bow, not the whole rack

```
✎ db/lib/autoLaborPass.js
✎ db/lib/laborAccess.js
✎ docs/handbook.md
✎ docs/systemdocs/LABORING.md
```

## 2026-09-03 · Changelog: every push leaves a line here and in Discord

```
+ CHANGELOG.md
+ scripts/changelog/log.js
✎ CLAUDE.md
✎ package.json
```
