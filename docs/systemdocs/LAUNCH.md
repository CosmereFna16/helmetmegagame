# Opening a game: the launch runbook

What to do, in what order, to take the app from "deployed" to "players can
make characters". Written for a Restart Game wipe, which is how a playtest or
a new season starts.

Every step here exists because skipping it breaks something quietly. Nothing
in this list throws a visible error — you find out when a player says the
button isn't there.

Companion to [`SYNC.md`](SYNC.md) §3 (what the wipe re-syncs),
[`DEV-PANEL.md`](DEV-PANEL.md) (the panel itself) and
[`GAMEMASTERS.md`](GAMEMASTERS.md) (zone seats).

## 1. The three that bite

Read these before touching anything, because two of them are invisible until
someone complains and the third is irreversible in the wrong order.

**The wipe closes the doors behind you.** `wipeGameData` writes
`DEFAULT_GAME_CONFIG` (`web/app/(app)/gm/dev/actions.js`) over the config row,
and that constant sets `openToPlayers: false` and `leaderWhitelistEnabled:
true`. So the natural opening move — wipe to a clean slate — leaves a game
nobody can join, with the Leader roles re-locked. It also resets **every
balance knob**: `playerCount`, `startingTagPoints`, `equipSlots`,
`maxDrawbackTags`, `desireSlots`, `productionCoefficient`, and the feature switches
(`playtestModeEnabled`, `nicknameSyncEnabled`, `archiveVisible`,
`avatarUploadsEnabled`, `portraitMakerEnabled`, `messageWipeEnabled`,
`autoReconcileEnabled`).
**Screenshot the Game Config form before you wipe.** The row is updated, not
recreated, so anything absent from `DEFAULT_GAME_CONFIG` survives — including
the special-channel and `#turns` channel pointers.

Note what the last three mean in practice: after a wipe, player topics **never
expire** and the doctor **never runs post-turn**, until you re-tick them.

**The wipe resets the playtest lock, and the `#turns` repost is best-effort.**
`playtestModeEnabled` — the switch that holds back
`PLAYTEST_LOCKED_ROLE_SLUGS` and `PLAYTEST_LOCKED_ZONE_NAMES`, both empty
since the Bascinet 2 rebuild — is reset to `false` by the wipe
like everything else, so a playtest that wants those locked has to re-tick it
afterwards. Separately, `finishGameWipe` reposts the `#turns` console for the
fresh Turn 1 itself, so the channel is no longer left empty on Day 1 — but that
step is retried once and then recorded as a failure, not retried forever. If it
fails, the stale message pointer is the safety net: the bot reposts on its next
`ready`. Check the channel; restart the bot if it's bare.

**A zone seat costs a GM the threat briefs.** The polarity is inverted from
intuition: a *master GM* is one with **no** zone assignment, and secret
documents are visible only to master GMs (`web/app/(app)/documents/page.js`,
[`DOCUMENTS.md`](DOCUMENTS.md)). Seating a GM in a zone **removes** their
access to every threat brief. There is no way to be seated and see secrets. A
seat decides which zone their tables open on and hides nothing else, so leave
a GM unseated unless you specifically want the default.

## 2. What the wipe actually runs

`wipeGameData` does the database half synchronously — every player- and
turn-scoped row deleted in one transaction (in FK-dependency order),
`GameConfig` reset, and a fresh Turn 1/DAWN opened. It writes a
`SystemReport` row (`kind: WIPE`) **before** the Discord half starts, then hands
that half to `after()` and returns.

`finishGameWipe` is a **step runner**: each step is retried once, every failure
is collected, and the run lands on that report row. The panel no longer claims
a success it can't know about — and if the container dies partway, the report
is left unfinished (`finishedAt` null), which is itself the signal.

The order, and why:

| # | Step | Why here |
|---|---|---|
| 1 | **Access sweep** (`revokeAccessForCharacters`) | First, while nothing has re-provisioned: strips every character's zone role and every stray member overwrite, channel-major |
| 2 | **Per character**: delete the personal role, clear the nickname, drop turn-ping | Discord role state the DB transaction never touched. Sequential — 240+ simultaneous requests against two per-guild buckets is its own incident. Each character is its own step, so a failure names them |
| 3 | **Cursed roles** removed from everyone who held one | A restart should not leave anyone cursed from the last game |
| 4 | **Full channel wipe** (`runFullChannelWipe`) | Spares nothing — `#turns`, `#archive`-named channels, every zone's `#summary`, every Location channel and every thread under it, Rooms and anchors included. It then **nulls the recorded thread/anchor ids and hashes** so the re-sync rebuilds them instead of hash-matching something that no longer exists |
| 5 | **`#turns` console repost** | After the wipe, never before: step 4 bulk-deletes every message in `#turns`, including this one if it were posted first. Turn 1 is opened by a plain `turn.create`, so `runSideEffects()` never fires and the announcement that normally rides it never went out |
| 6 | **Zone sync** (`syncZonesFromYaml`) | Regenerates every category, `#summary`, Location channel, zone and location role, Room thread and anchor from `docs/zones.yaml` |
| 7 | **Special channels sync** | Right after zones, because a registry entry's `roleViewZones` grants name zone roles step 6 may have just recreated |
| 8 | **Tag sync** → 9. **Role sync** → 10. **Desire sync** → 11. **Document sync** | Dependency order: roles resolve a `starting_zone` and validate `starting_tags`; desires validate `requires.anyRoles`/`notRoles` against roles and `requires.anyTags`/`notTags` against tags (`SYNC.md` §1, `DESIRES.md` §10); documents validate against tags, roles and factions |
| 12 | **Channel doctor** (cheap, apply) | The structural backstop: whatever a retry above still missed, the doctor finds by diffing Discord against the now-empty roster and repairs. Not a bigger retry count — a different mechanism |

## 3. The runbook

**Before the wipe**

1. Screenshot `/gm/dev` → Game Config (§1).
2. `./migrate.sh`, or `npm run db:migrate:deploy`. A wipe against an
   unmigrated database throws mid-transaction and wipes nothing. See
   "Deploy workflow" in `CLAUDE.md` for why this is not automatic.
3. Confirm each GM holds the Discord GM role and has signed into the web app
   with that same Discord account.

**The wipe**

4. `/gm/dev` → Restart Game → type `WIPE`, all caps. Superadmin only.
5. **Watch the System Reports section on `/gm/dev`**, not the server logs. The
   action returns in about a second; the Discord half runs in `after()` for
   minutes and reports itself. Refresh until the `WIPE` report shows a finish
   time. `clean` means every step landed; `issues` lists exactly which steps
   failed and why; `unfinished` after several minutes means the container died
   mid-pass — re-run the failed piece by hand, or press **Repair** to let the
   doctor sort out what it can.

**After the wipe**

6. `npm run db:sync-narrowcast-channels`, then delete the old `#radio` channel
   by hand if it is still there. The wipe *does* run the special-channels sync
   (step 7 above), so this is only needed when the ids are NULL — a fresh
   database, or right after the `watch_radio_channels` migration. It is safe to
   re-run either way: channel identity is one-time and everything else
   reconciles.
7. `npm run db:rebuild-info-channel`. `#info` is never rebuilt automatically
   and still carries the previous game's roles intro.
8. `npm run db:prune-orphan-roles` — dry run. Add `-- --apply` only if it
   lists leaks. The guild cap is 250 roles; past it, `ensureCharacterRole`
   silently stops creating them and new characters are unmentionable. (The
   doctor's cheap scope now reports orphan character roles too, and repairs
   them on apply — this script is the terminal path to the same check.)
9. **Do not run `db:prune-tags` here.** A wipe clears every `CharacterTag`
   first, so a prune would find every GM-created tag unheld and delete the
   lot ([`SYNC.md`](SYNC.md) §3b).
10. Check `#turns` shows the Turn 1 announcement and its button row. The
    wipe reposts it, but the step is best-effort — restart the bot if the
    channel is empty (§1).
11. Re-enter Game Config from the screenshot, including **Playtest mode** if
    you have named something for it to hold back, and the three passes that
    default to off: message wipe, thread expiry, auto-reconcile.
12. **Tick "Open to players" last.** A player also needs the player role —
    the two together are "the doors are open" and "you are on the list".

## 4. What the wipe does not clear

Worth knowing, because none of it is obvious from the confirm dialog.

| Survives | Consequence |
|---|---|
| `#cerberon`, `#info` messages | `runFullChannelWipe` touches `#turns`, `#archive`-named channels and zone channels only. Last game's radio traffic stays readable — clear it by hand if that matters. |
| The `radio` category and its channel ids | Deliberate: provisioning is one-time, so the pointers persist. |
| The `#turns` console pointer | Deliberate, and the safety net for step 5 above: a stale id makes the bot repost on its next `ready`. |
| `GmAssignment` zone seats | GMs keep their seats across a restart — which also means they keep *losing* the Secret tab (§1). |
| `SystemReport` rows | The operational history is kept on purpose; the panel shows the latest per kind. |
| `Zone`, `Location`, `Room`, `Faction`, `Tag`, `Role`, `Document` | Re-synced from YAML rather than deleted. |

Everything zone-side in Discord — categories, channels, zone and location
roles, anchors, Room threads — is **destroyed and regenerated**. Zone,
Location and Room rows keep their ids; their Discord objects do not.

## 5. If you are not wiping

Run the masters yourself, in dependency order — roles resolve a
`starting_zone` and validate `starting_tags`, so the order is load-bearing:

```
npm run db:sync-zones                # destructive both ways
npm run db:sync-narrowcast-channels  # after zones: its grants name the zone roles
npm run db:sync-tags                 # upsert-only, never deletes
npm run db:sync-roles                # prunes unreferenced
npm run db:sync-documents            # destructive; last
npm run db:doctor                    # dry run; -- --full --apply to repair
```

Then steps 7–8 above, which the wipe would not have covered either.

## 6. Who can do what

The Discord GM role and superadmin are independent. Superadmin is a hardcoded
list of Discord user IDs in `web/lib/superadmin.js` — adding one is a code
edit and a redeploy, not something you can do from a browser on the day.

A GM-role holder can run the whole game: Moves, Requests, kills, revives,
tags, DMs, the per-character dev panel, and the bot's `/gm` `/dm` `/heal`
(from a guild channel — none of them work in the bot's DMs).

A GM-role holder **cannot**: end a turn early, wipe or restart, edit Game
Config, set next turn's weather or note, edit factions, run the channel doctor
or a Bulk Move, delete a character or a custom tag, or open `/gm/audit` and
`/gm/gamemasters`. All of those are superadmin.

The practical one is **ending a turn**. `forceAdvanceTurn` checks only
`isSuperadmin` and never consults the GM role, so if the superadmin is away,
turns roll on the bot's cron alone — 04:00 and 16:00 America/Chicago. Plan
around that or add a second superadmin before the game opens.

## 7. Pre-flight check

- [ ] `#turns` exists, is named exactly `turns`, and shows the console message
      with its button row. Both the announcement and the console find it by
      exact name; a rename loses all three player entry points.
- [ ] Every zone has its category and `#summary`, every Location has its own
      channel, and each Location channel shows its pinned anchor with a
      working **Who's here? / Secret rooms? / Converse** button row
- [ ] Every Location's Rooms exist as threads, public ones visible and
      private ones invisible to a keyless test account
- [ ] `/character` renders the creation wizard, not `CreationClosed`, for a
      test account holding the player role
- [ ] The role tree on step 2 is populated — empty means the role sync failed
- [ ] The point-buy menu on step 3 has tags
- [ ] `/documents` is populated
- [ ] `#cerberon` exists under a `radio` category, and the old `#radio` and
      `#intercom` are gone
- [ ] The Council Room's starter post carries an **Intercom** button, and
      pressing it reaches every `#summary` but the Black Hills'
- [ ] `npm run db:doctor -- --full` comes back with nothing (or nothing you
      didn't expect)
- [ ] Make one throwaway character end to end, then check it can see exactly
      one Location, travel once, and open a Conversation
- [ ] End one turn and confirm the announcement posts
