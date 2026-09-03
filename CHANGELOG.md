# Changelog

Every push, newest first, in plain language for the GM team. Written by
`npm run push` and mirrored to Discord — see CLAUDE.md.
`✚` new, `−` gone, `✎` changed.

Entries below predate this format and list files instead.

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
