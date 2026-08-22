# Characters: creation, roles, and death

How a player gets a character, what the point-buy economy is, and what
happens when that character dies. Companion to `TAGS.md` (the tag catalog)
and `CHANNELS.md` (the Discord channel/permission layout).

## 1. The shape of it

A player signs in and lands on `/character`. If they have no `ALIVE`
character — brand new to the server, or their last one died — that page
renders the **creation wizard** instead of a character sheet. There's no
separate `/character/new` route; one URL, no redirect bounce.

The wizard has six steps:

1. **Identity** — an honorific (a free pick from the fixed `HONORIFICS`
   dropdown), a required first name and an optional last name, plus an
   optional preferred nickname (the `{base} | {character}` Discord nickname
   convention, which uses the **bare** first + last).

   Age is optional here (18–90). Left blank, it stays editable on `/character`
   until the player saves a number, and locks at that point — a GM can still
   correct it afterwards. It feeds the Young/Old half of a concealed alias
   (`db/lib/concealedIdentity.js`).

   A displayed name is four fields joined by
   `db/lib/characterName.js#formatCharacterName` as
   `Sir Jorren "the Blind" Vask`. The fourth, `title`, renders in quotes
   between the names and is **GM-only** — it has no input in the wizard, and
   the character sheet shows it disabled with a "make your case to a GM"
   tooltip. `Character.name` remains as a denormalized mirror of the join,
   kept in sync by exactly three writers; see "Character names" in
   `CLAUDE.md` for why it survives and what `NAME_LIMITS` is protecting.
2. **Role** — the role list, grouped Zone → Faction → Role, with live seat
   counts.
3. **Tags** — the point-buy menu.
4. **Fear** — the character's Worst Fear. **Optional**: `canAdvance` is
   unconditionally true on this step, so a player may walk straight past it and
   name one later from `/character`. See `REQUESTS.md` §5b.
5. **Antagonists** — eleven checkboxes, all off, naming the antagonist seats a
   GM hands out in secret (Succubus, Cultist, the Judge…). Pure consent data:
   nothing in the game reads `Character.antagonistOptIns`, grants from it or
   gates on it — it exists so a GM choosing who receives one can tell who is
   willing. Also **optional** — ticking nothing is a real answer, so
   `canAdvance` is unconditionally true here too.

   Opt-in rather than opt-out deliberately: a player who clicks through without
   reading has consented to nothing. It is **creation-only** — the list is set
   here and `updateCharacterProfile` never reads the key, the same lock `title`
   uses. There is no GM read/edit surface yet; the values just land on the row.
   The catalog is `db/lib/antagonists.js` (alphabetized, so catalog order *is*
   display order), and `normalizeAntagonistSlugs` is the server-side allowlist —
   a server action is a public endpoint, so the checkboxes are UX and that
   function is the boundary.
6. **Confirm** — a summary, then `createCharacter`.

## 2. Roles

`docs/roles.yaml` is the master. `db/lib/syncRoles.js#syncRolesFromYaml`
(`npm run db:sync-roles`) reads its `zones[].factions[].roles[]` nesting into
the `Zone`/`Faction`/`Role` tables, matched by `slug`.

**Threats are not in `roles.yaml`.** Sympathizer, the Demoness, the Cult of
Bacchus, the Judge, the NPC monsters, the Brigands — those seats are assigned
by hand by a GM and must never appear in the player-facing picker, so they are
prose in `docs/threats.md` rather than data. They used to sit in
`zones[].threats[]`, carrying a full role's worth of fields that no sync ever
read.

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
(the drawbacks, Old at `-2` and Frail at `-3`). Summing signed costs means
both directions fall out of one subtraction, and `remaining >= 0` is the only
completion rule. Every negative-cost tag is `purchasableAfterStart: false` —
a drawback you could buy mid-game would be a point farm.

Leftover points are kept, not lost: they land on `Character.tagPoints`.

Fulfilling a Desire is the only way points are *earned* in play, and a Worst
Fear coming true is the only way they are *spent* — the first and so far only
sink (`REQUESTS.md` §5b). The balance is allowed to go **negative**: clamping it
at 0 would let a broke player take the −3 for free, which is the mechanic.

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

`Cursed` is a live Discord role (`DISCORD_CURSED_ROLE_ID`), not a DB field —
it's on the Discord account rather than the `Character` row, so it outlives
the character that earned it. `web/lib/discordGuild.js#isCursed(member)`
reads it off a guild member's current roles, fed by `getGuildMember`
(`isGm`'s exact pattern, just a different role id).

It's granted automatically by `killCharacter` when a character dies, and
removed automatically by `createCharacter` the moment the cursed player
successfully rolls a new one — the curse doesn't outlast the Bum/Migrant it
forced. A GM can also curse someone by hand (narrative punishment) simply by
adding the role in Discord — there's no code path needed for that.

While cursed, a player may still roll a new character — but only as a
**Migrant** or a **Bum**, and with **3 fewer points**
(`web/lib/characterCreation.js`'s `CURSED_ROLE_SLUGS`/`CURSED_POINT_PENALTY`,
enforced by `isRoleSelectable`/`computeBudget`, unchanged by this — only
where the `cursed` boolean they're fed comes from changed). A GM clears the
curse early (body buried / rites read) by removing the role directly in
Discord's member panel — `/gm/dev/characters/[characterId]` only shows a
read-only Cursed status line now, there's no checkbox to toggle it from the
app.

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
   so Location access *and* narrowcast-channel access (§6) disappear with it
   and nothing needs walking individually.
2. Nulls `discordRoleId` — it's `@unique`, and a dangling id would have
   `ensureCharacterRole` PATCHing a deleted role forever.
3. Clears the Discord nickname.
4. Grants the Cursed role (§4).

`updateCharacterRaw` skips the role/location sync entirely for a non-`ALIVE`
character.

## 6. Narrowcast channels (`#radio`, `#intercom`)

Location access is *place*-based: one `ViewChannel` overwrite per resident
character on the Location category, swapped on travel. `#radio` and
`#intercom` sit outside that category structure, but use the exact same
primitive — a permission overwrite on the character's own personal Discord
role — rather than a separate gate role, because each channel's condition is
bespoke and depends on the character's current Zone/Location as well as tags,
not a simple "hold a tag" gate:

- **`#radio`** — viewable/speakable by anyone holding the Radio tag, unless
  they're currently on any level of the **Depths** (Caverns, Railroad,
  Aberrant Pits — `DEPTHS_SLUGS` in `db/lib/travelCost.js`).
- **`#intercom`** — viewable by anyone in the **Fortress** or **Town** Zone;
  speakable only by an Intercom-tagged character standing in the **Keep**.

Rules live in `db/lib/narrowcastAccess.js#NARROWCAST_RULES`, hardcoded rather
than YAML-authored since neither condition is a generic gate. Reconciled by
`bot/src/lib/location.js#syncCharacterNarrowcastAccess` (gateway, called from
`performMove` after every Move) and `web/lib/discordGuild.js`'s function of
the same name (REST, called from character creation, GM raw location edits,
and `grantTag`/`revokeTag` — tag changes only ever happen through the web
app). `@everyone` is denied `ViewChannel`+`SendMessages` on both channels by
default; a qualifying character's personal role gets the matching `allow`
overwrite, or has it removed if they qualify for neither.

Channel provisioning (`GameConfig.radioChannelId`/`intercomChannelId`) is a
one-off script, `db/lib/syncNarrowcastChannels.js`
(`npm run db:sync-narrowcast-channels`) — not part of `wipeGameData`, the ids
persist across a restart.

## 7. Sync order

The three YAML masters have dependencies, so order is load-bearing — this is
the order `wipeGameData`'s "Restart Game" runs them in:

```
locations  ->  tags  ->  roles
```

Roles resolve a starting Location *and* validate `starting_tags`. Their
delete contracts differ and are worth knowing: locations is **fully
destructive** (a dropped Location loses its Discord category and its row),
roles prunes only rows nothing references, and tags is a pure upsert that
never deletes.

## 8. Where the code lives

| Concern | File |
|---|---|
| Masters | `docs/roles.yaml`, `docs/tags.yaml`, `docs/locations.yaml` |
| Role sync | `db/lib/syncRoles.js`, `db/prisma/sync-roles.js` |
| Narrowcast channels | `db/lib/narrowcastAccess.js`, `db/lib/syncNarrowcastChannels.js`, `db/prisma/sync-narrowcast-channels.js` |
| Seat math | `db/lib/roleCapacity.js` |
| Budget/eligibility rules | `web/lib/characterCreation.js` |
| Wizard | `web/app/(app)/character/CreateCharacterWizard.js` |
| Point-buy menu | `web/app/components/PointBuy.js` |
| Creation action | `web/app/(app)/character/createActions.js` |
| Discord access + death | `web/lib/discordGuild.js` |
