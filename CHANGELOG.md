# Changelog

Every push, newest first, in plain language for the GM team. Written by
`npm run push` and mirrored to Discord — see CLAUDE.md.
`✚` new, `−` gone, `✎` changed.

Entries below predate this format and list files instead.

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
