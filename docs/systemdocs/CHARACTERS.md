# Characters: creation, roles, and death

How a player gets a character, what the point-buy economy is, and what
happens when that character dies. Companion to `TAGS.md` (the tag catalog)
and `CHANNELS.md` (the Discord channel/permission layout).

## 1. The shape of it

A player signs in and lands on `/character`. If they have no `ALIVE`
character — brand new to the server, or their last one died — that page
renders the **creation wizard** instead of a character sheet. There's no
separate `/character/new` route; one URL, no redirect bounce.

The wizard has four steps:

1. **Identity** — character name, and an optional preferred nickname (the
   `{base} | {character}` Discord nickname convention).
2. **Role** — the role list, grouped Zone → Faction → Role, with live seat
   counts.
3. **Tags** — the point-buy menu.
4. **Confirm** — a summary, then `createCharacter`.

## 2. Roles

`docs/roles.yaml` is the master. `db/lib/syncRoles.js#syncRolesFromYaml`
(`npm run db:sync-roles`) reads its `zones[].factions[].roles[]` nesting into
the `Zone`/`Faction`/`Role` tables, matched by `slug`.

**`zones[].threats[]` is never synced.** Sympathizer, Succubus, the Cult of
Bacchus, the Judge, the NPC monsters — those seats are assigned by hand by a
GM and must never appear in the player-facing picker.

It replaced the old `db/lib/factionSync.js`, which read the same file but
only ever used faction `name`/`parent`/`starting_resources`.

### Seat caps

`db/lib/roleCapacity.js#roleCapacity(role, playerCount)` is the single source
of the cap, shared by the picker, the server action, and the GM panel:

| YAML | Column | Cap |
|---|---|---|
| `multiple: false` | `isUnique` | exactly 1, at any game size |
| `weight: unlimited` | `unlimited` | uncapped (`Infinity`) |
| `weight: N` | `weight` | `max(1, round(N * playerCount / 100))` |

`weight` reads as *seats per 100 players*, so `GameConfig.playerCount` is the
live dial: set it to 120 on `/gm/dev` and every weighted role widens by 1.2×.
`multiple: false` is deliberately **not** "1 per 100" — the Baron stays one
Baron in a 300-player game.

A role at capacity renders disabled. That's advisory only: `createCharacter`
re-counts **inside the transaction that creates the character**, so when two
players sit on the last Baron seat and both hit Confirm, the second one gets
told to pick again.

### The starting package

Picking a role decides almost everything:

- `factionId` — from the role's faction.
- `locationId` + `zoneId` — from `starting_location` (a Location **slug**).
  This is what gives the character their Discord channel access; see §5.
- `resources` — `starting_resources`.
- `isLeader` / `isTreasurer` — from `leader: true` / `treasurer: true`.
  These were once entries in `starting_tags`; they're booleans on
  `Character`, not Tags (`TAGS.md` §6).
- `starting_tags` — granted free, as `CharacterTag` rows with source
  `GM_GRANT`, on top of anything bought.

The sync **throws** on a `starting_tags` name that isn't in the catalog or a
`starting_location` slug that isn't a Location, rather than half-applying. A
typo can't ship characters missing part of their package.

## 3. The point economy

```
budget = GameConfig.startingTagPoints      (default 12, live on /gm/dev)
       + role.extra_starting_points        (Peasant +2, Outsider +3)
       - 3 if the player is Cursed
```

`web/lib/characterCreation.js` holds this arithmetic, and is imported by the
wizard, the server action, and the GM panel so the number a player is shown
and the number the server enforces cannot drift apart.

`Tag.pointCost` is **signed**. Positive costs points; negative *grants* them
(the drawbacks, Frail at `-2` and Old at `-1`). Summing signed costs means
both directions fall out of one subtraction, and `remaining >= 0` is the only
completion rule. Every negative-cost tag is `purchasableAfterStart: false` —
a drawback you could buy mid-game would be a point farm.

Leftover points are kept, not lost: they land on `Character.tagPoints`.

### Two menus, one component

`web/app/components/PointBuy.js` takes an `afterStartOnly` flag:

- **Creation** passes `false` — every `purchasable` tag is on offer, so a
  launch-only pick like "Secretly an Android" is available exactly once.
- **The mid-game store** passes `true` — only `purchasableAfterStart` tags.
  The component is built and shared; the mid-game route itself isn't wired up
  yet.

Tags sort by cost then name, so point-granting drawbacks lead each category.
Cost renders `+N` in `var(--accent)` (red, it costs you) and `-N` in
`var(--positive)` (green, it pays you) — `costColor()` in
`characterCreation.js`, shared with `TagChip.js`.

## 4. Cursed

`Cursed` is on the **Discord account** (`Player.cursed`), not the character,
so it outlives the character that earned it. It is set automatically when a
character dies.

While cursed, a player may still roll a new character — but only as a
**Migrant** or a **Bum**, and with **3 fewer points**. A GM clears the flag
from `/gm/dev/characters/[characterId]` once the body is buried and the rites
are read, which restores normal creation.

(`CharacterStatus.CURSED` still exists in the enum and is unrelated — it's an
unused leftover, kept only because dropping a Postgres enum value is a risky
migration.)

## 5. Death

Setting a character to `DEAD` used to write a column and nothing else — it
even left `ensureCharacterRole` renaming and recoloring the dead character's
Discord role afterward. `web/lib/discordGuild.js#killCharacter`, called from
`updateCharacterRaw` on the transition **to** `DEAD`, now does the cleanup:

1. Deletes the personal Discord role. This does most of the work: Discord
   drops every permission overwrite tied to a role the moment the role goes,
   so Location access disappears with it and no categories need walking.
2. Nulls `discordRoleId` — it's `@unique`, and a dangling id would have
   `ensureCharacterRole` PATCHing a deleted role forever.
3. Strips every special-channel gate role (§6) — those aren't tied to the
   personal role, so they need removing separately.
4. Clears the Discord nickname.
5. Sets `Player.cursed = true`.

`updateCharacterRaw` skips the role/location sync entirely for a non-`ALIVE`
character.

## 6. Tag-gated channels

Location access is *place*-based: one `ViewChannel` overwrite per resident
character on the Location category, swapped on travel. That works because a
character stands in exactly one place at a time.

A **tag** doesn't work that way — everyone can hold one at once, and Discord
caps a channel at ~100 permission overwrites. So `SpecialChannel` gates go
through a plain guild role instead: each gate has its own role, the channel
carries at most three overwrites total, and what changes is *membership*.

`docs/channels.yaml` is the master
(`db/lib/syncSpecialChannels.js`, `npm run db:sync-channels`). Each entry
declares up to two gates:

| Gate | `@everyone` | Gate role |
|---|---|---|
| `viewTag` | denied `ViewChannel` | allowed `ViewChannel` |
| `sendTag` | denied `SendMessages` | allowed `ViewChannel`+`SendMessages` |

So `#radio` (`viewTag: radio`) is invisible without the tag, and `#intercom`
(`sendTag: intercom`) is readable by everyone but speakable only by holders.
Adding a third channel is a YAML entry plus a re-sync.

`web/lib/discordGuild.js#syncCharacterSpecialAccess` reconciles a member's
gate roles against the tags they actually hold. It's a reconcile, not an
add-only pass, so revoking a tag really does remove access. Call sites:
character creation, the GM's `grantTag`/`revokeTag`, and death.
`npm run db:backfill-special-access` is the catch-up for anything that
bypassed those.

## 7. Sync order

The four YAML masters have dependencies, so order is load-bearing — this is
the order `wipeGameData`'s "Restart Game" runs them in:

```
locations  ->  tags  ->  roles  ->  channels
```

Roles resolve a starting Location *and* validate `starting_tags`; channel
gates resolve Tags. Their delete contracts differ and are worth knowing:
locations is **fully destructive** (a dropped Location loses its Discord
category and its row), roles prunes only rows nothing references, and
tags/channels are pure upserts that never delete.

## 8. Where the code lives

| Concern | File |
|---|---|
| Masters | `docs/roles.yaml`, `docs/tags.yaml`, `docs/locations.yaml`, `docs/channels.yaml` |
| Role sync | `db/lib/syncRoles.js`, `db/prisma/sync-roles.js` |
| Channel sync | `db/lib/syncSpecialChannels.js`, `db/prisma/sync-channels.js` |
| Seat math | `db/lib/roleCapacity.js` |
| Budget/eligibility rules | `web/lib/characterCreation.js` |
| Wizard | `web/app/(app)/character/CreateCharacterWizard.js` |
| Point-buy menu | `web/app/components/PointBuy.js` |
| Creation action | `web/app/(app)/character/createActions.js` |
| Discord access + death | `web/lib/discordGuild.js` |
