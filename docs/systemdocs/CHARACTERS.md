# Characters: creation, roles, and death

How a player gets a character, what the point-buy economy is, and what
happens when that character dies — plus the four-field name and the two locks
on creation. Companion to `TAGS.md` (the tag catalog), `CHANNELS.md` (the
Discord channel/permission layout) and `PROXYING.md` (nicknames and personal
roles).

## 1. The shape of it

A player signs in and lands on `/character`. If they have no `ALIVE`
character — brand new to the server, or their last one died — that page
renders the **creation wizard** instead of a character sheet. There's no
separate `/character/new` route; one URL, no redirect bounce.

The wizard has five steps:

1. **Role** — the role list, in seven social buckets with live seat counts.
   See §1e.
2. **Tags** — the point-buy menu.
3. **Identity** — a title (only what the build has *earned* — see §1c), a
   required first name and an optional last name.

   **Identity comes third, after Role and Tags, and has to.** A title is
   earned from the role taken and the tags held, so there is nothing to offer
   until both are picked. It also fixes the dynasty surname, which is locked
   by the role: while Identity ran first, `lastNameLocked` was read before the
   role that sets it existed, so the input could not be locked in time.

   Age is optional here (18–90). Left blank, it stays editable on `/character`
   until the player saves a number, and locks at that point — a GM can still
   correct it afterwards. It feeds the Young/Old half of a concealed alias
   (`db/lib/concealedIdentity.js`).

   A displayed name is four fields joined by
   `db/lib/characterName.js#formatCharacterName` as
   `Sir Jorren "the Blind" Vask`. The fourth, `title`, renders in quotes
   between the names and is **GM-only** — it has no input in the wizard, and
   the character sheet shows it disabled with a "make your case to a GM"
   tooltip. `Character.name` remains as a denormalized mirror of the join.
   See §1b.
4. **Antagonists** — eleven checkboxes, all off, naming the antagonist seats a
   GM hands out in secret (the Demoness, the Judge…). Pure consent data:
   nothing in the game grants from `Character.antagonistOptIns` or gates on it
   — it exists so a GM choosing who receives one can tell who is willing. Also
   **optional** — ticking nothing is a real answer, so `canAdvance` is
   unconditionally true here too.

   **Most of these are decoys.** Only two of the eleven are real seats today,
   and a GM may hand one to somebody who ticked nothing at all. That is the
   design: the list tells a player nothing about which threats exist. See
   `THREATS.md` §1.

   Opt-in rather than opt-out deliberately: a player who clicks through without
   reading has consented to nothing. It is **creation-only** — the list is set
   here and `updateCharacterProfile` never reads the key, the same lock `title`
   uses. A GM reads it on `/gm/dev?s=assignments`, which is the only surface
   that shows it. The catalog is `db/lib/threats.js` (alphabetized, so catalog
   order *is* display order — which is also what hides the real seats among the
   decoys), and `normalizeAntagonistSlugs` is the server-side allowlist —
   a server action is a public endpoint, so the checkboxes are UX and that
   function is the boundary. It drops a slug the catalog no longer carries,
   which is why renaming one needs no data migration.
5. **Confirm** — a summary, then `createCharacter`.

## 1b. Names

A displayed name is **four fields**, joined by
`db/lib/characterName.js#formatCharacterName`:

```
Sir Jorren "the Blind" Vask
 |    |         |        |
 |    |         |        `-- lastName   String?  optional, player-editable
 |    |         `----------- title      String?  GM-ONLY, renders in quotes
 |    `--------------------- firstName  String   required, player-editable
 `-------------------------- honorific  String?  a title the character EARNED
```

`honorific` is **earned, not chosen** — see §1c.

`title` is the opposite: set **only** from `/gm/dev/characters/[characterId]`.
The character sheet shows it as a `disabled` input with a "make your case to a
GM" tooltip — but the greying is not the lock. A disabled input submits nothing,
and `updateCharacterProfile` never reads the key. It does have to feed the row's
*existing* `title` back into `formatCharacterName`, or a player saving their bio
would silently strip a title a GM had granted.

### `Character.name` is a denormalized mirror

Same posture as `Character.zoneId` (`ARCHITECTURE.md` §6). It's what ~60 readers
want — `orderBy`, `select: { name: true }`, the `/gm/audit` `contains` search,
the proxy webhook username — and Prisma cannot concatenate columns in
`orderBy`/`contains`, so dropping it would force search and sort into
`OR`-over-three-columns for correctness nobody can see.

Keeping it also means the never-backfilled name snapshots
(`Note.characterName`,
`ArchiveEntry.characterName`, `AuditLog.details`) capture the titled form with
no code change — correct, since those record who did something *as they were
known then*.

**Exactly four writers** keep it honest, and every one goes through the
formatter:

| Writer | When | Title gate |
|---|---|---|
| `character/createActions.js` | Creation | `normalizeEarnedHonorific` |
| `web/lib/characterWrite.js` | GM raw edit, from the dev panel | `normalizeHonorific` (ungated) |
| `web/lib/dynasty.js#propagateDynastyLastName` | The Baron renaming his house | **none — see §1c** |
| `character/requestActions.js#changeNameRequestImpl` | The "Change name" request | `normalizeEarnedHonorific` |

A fifth must do the same.

### A name is immutable — except through the "Change name" request

There is **no direct player-facing rename.** A name is chosen once, in the
creation wizard, and after that `character/actions.js#updateCharacterProfile`
ignores `honorific`, `firstName` and `lastName` outright — the three inputs on
`/character` render `disabled`, but as always the disabled input is the hint
and the server action is the lock. The rest of the Bio form (appearance,
avatar, opt-ins) is untouched.

The one way through is the **`CHANGE_NAME` request** (`REQUESTS.md` §3),
reached from the "Change name" button next to those disabled fields: the
player picks a new honorific/first/last name and gives a reason, it applies
immediately, and a GM can Undo it from `/gm/turns` like any other request. It
requires nothing beyond that reason — it used to also spend a Mulligan
Potion (`docs/tags.yaml`), but that gate has been removed; the tag survives
as a flavor collectible only. It re-validates the same allowlist/cap/dynasty-
lock rules every other writer of `Character.name` enforces, and runs the same
lightweight Discord fan-out `updateCharacterProfile` used to
(`ensureCharacterRole`, `syncCharacterNickname`, and
`propagateDynastyLastName` if the renamer is the Baron) right after the
transaction commits — best-effort and outside it, same posture as every other
request that touches Discord. `REQUESTS.md` §3 has the one gap worth knowing:
Undo reverts the database but not Discord, which catches up on the player's
next Bio save.

### `NAME_LIMITS` (10/24/20/20)

Not cosmetic. Discord caps a webhook username at 80 characters and the proxy
sends `name` as-is, so the **inputs** are capped instead and the composed name
is ≤79 by construction. Both form-fed writers — creation and the GM dev panel
— apply the caps and the title allowlist server-side; both of those forms are
public endpoints. The longest title is 9 characters (Professor, Constable), so
the 10-char cap holds with the catalog as it stands.

## 1c. Titles are earned, and gender picks the form

`db/lib/titles.js` is the catalog. An entry is one **title**, not one word:
`words` is either a plain string, or a map keyed by gender.

| Title | Earned from | MAN / WOMAN / NEUTRAL |
|---|---|---|
| Sergeant | tag `sergeant` | one word |
| Constable | tag `cerberon` | one word |
| Censor | role `censor` | one word |
| Knighthood | tag `knighted` | Sir / Dame / Ser |
| Nobility | tag `nobility` | Lord / Lady / Noble |
| The Baron's seat | roles `baron` `baroness` | Baron / Baroness / Baron |
| Ordination | tag `chaplain` | Father / Mother / Reverend |
| The Mortii | tag `mortus` | Brother / Sister / Sibling |
| Bishop | role `bishop` | one word |
| Doctor | tag `medical-skilled`, roles `esculap` `serpent` | one word |
| Professor | role `scholastic` | one word |
| Master | roles `metalsmith` `innkeeper` `headman` | one word |

**A player never picks between Lord, Lady and Noble.** Their gender decides
that; the dropdown picks between Lord and Sir. So `earnedTitles()` returns one
word per earned title, never three.

Only five titles are gendered at all. Rank and profession say nothing about
their wearer, which is why Censor, Doctor and Master sit on the flat side —
and every gendered set carries a neutral third, so nobody has to pick a side
to be styled.

Overlap is deliberate: the `bishop` role grants the `chaplain` tag, so a Bishop
may style themselves Father, Mother or Reverend instead. Same for Censor
(grants `cerberon`) and the Baron's family (grant `nobility`). **Most of
Ravenheart is untitled** — a Commoner earns nothing, and the picker says so
rather than showing an empty control.

Three titles hang off *purchasable* tags (`sergeant`, `knighted`,
`medical-skilled`), so they can be bought with points — but each sits behind a
membership gate already (`general-cerberon` needs `cerberon`, `general-court`
needs `courtier`), so nobody buys a title cold.

### Gender

`Character.gender` is `MAN | WOMAN | NEUTRAL`, non-null and defaulted. It is
chosen on the **last step of creation** — it has to be, because it and the
tags together decide what the title picker can offer — and never changes
afterwards.

The lock is `character/actions.js#updateCharacterProfile` **not reading the
key**, the same silence that keeps a name immutable. It deliberately does not
copy `age`'s null-until-set conditional: there is no unset state to leave open.
A GM can correct one from `/gm/dev/characters/[characterId]`, which is the only
writer after creation.

Gender does two jobs, and both used to be inferred from whichever title a
character happened to wear:

- **Which form of a title they get** — the table above.
- **The Man/Woman/Person half of a concealed alias**
  (`db/lib/concealedIdentity.js`) and the name pool Randomize draws from
  (`db/lib/nameCorpus.js#poolsFor`).

The second is a behaviour change worth knowing: an untitled woman now conceals
as "a young woman" rather than "a young person". Concealing hides the name, the
face and the faction — it was never meant to hide how someone presents, and the
alias comment always said as much. `ArchiveEntry.concealedAlias` is frozen at
send time, so a later correction never rewrites history.

### Four seats fix it

`baron` and `heir` are MAN; `baroness` and `successor` are WOMAN. Declared as
`gender:` in `docs/roles.yaml` and carried on `Role.lockedGender`, so a future
gendered seat needs no code — same posture as the `leader:` / `treasurer:`
booleans beside them.

These are **the same four roles that hand down the dynasty surname**, so both
locks land on the same wizard step: the picker renders disabled with a
tooltip, and `createCharacter` stamps the seat's value over whatever was
posted, exactly as it does the surname. The GM panel does not enforce it — a
deliberate exception is a GM's to make.

### The guard that finally works

`assertTitlesResolve(prisma)` runs at the end of `db:sync-roles` (after tags,
per `SYNC.md`) and fails on an unknown tag or role slug, or a gendered entry
missing a form. It replaced `assertHonorificsCovered()`, whose condition was
`!MAN.includes(h) && !WOMAN.includes(h) && genderWord(h) !== "Person"` —
unsatisfiable, since `genderWord` returned `"Person"` exactly when the first
two held, so it never fired once.

### Losing the tag does not strip the title

A knight who is stripped of `knighted` **keeps wearing "Sir"**. The picker
stops offering the word, so changing away is a one-way door, and only a GM can
put it back or take it off from `/gm/dev/characters/[characterId]`.

That rule is why **only three call sites may normalize a title**, and each
uses the right one:

- `normalizeEarnedHonorific(value, { tagSlugs, roleSlug })` — the two paths
  where the player is *choosing* a title: creation and the Change-name request.
- `normalizeHonorific(value)` — membership in the catalog only, no earning
  check. The GM dev panel, matching `TAGS.md` §3's rule that a GM grant is
  never second-guessed. It is also the escape hatch for a title nobody can
  re-select.

Anything else that happens to touch the name must **not** revalidate.
`web/lib/dynasty.js#propagateDynastyLastName` composes straight through
`formatCharacterName` for exactly this reason: if it normalized, every time
the Baron renamed his house it would silently strip the honorific of any
family member who had since lost their granting tag.

Retired with this change: Mr., Mrs., Ms. (a courtesy register that said
nothing about a character) and Marshal (a rank with no seat behind it).
**Master survives**, repurposed from a courtesy word into the craft-master's
title and re-read as neutral.

### Age

`Character.age` (18–90, nullable) follows the same shown-but-locked posture as
`title`, from the other direction: it is the player's to set, **but only once**.
While null the `/character` input is live; the moment a number is saved it
renders `disabled` with an `InfoIcon`, and `updateCharacterProfile` refuses to
overwrite a non-null age however the form is posted. The disabled input is the
hint, not the lock. The wizard takes it optionally, and a GM can always correct
it. Read by `db/lib/concealedIdentity.js` for the Young/Old half of a concealed
alias (`PROXYING.md` §5).

### The dynasty last name

`lastName` is the player's own **except for the Baron's house**. The four Court
seats — `baron`, `baroness`, `heir`, `successor` — are one family, so the Baron
chooses the dynasty name and the other three inherit it: their last name is
never read from a form they posted.

- `db/lib/dynasty.js` (pure, in the barrel) — the slug list and two predicates.
- `web/lib/dynasty.js` — the prisma/Discord half. `dynastyLastName()` reads the
  living Baron (the seat is `multiple: false`, so `findFirst` is exact);
  `propagateDynastyLastName()` restamps the family.

The lock lives in both remaining form-fed writers, GM raw edit included, keyed
on **the role being saved** — so moving someone into a family seat renames them
in the same write. The greyed-out inputs are the hint, not the lock. (Since the
self-service edit no longer writes names at all, a player's own form cannot
reach `lastName` by any route.)

Two consequences worth keeping: a family member created before any Baron exists
simply has no last name until he rolls up; and propagation runs only after a
Baron *write*, never on his death, so a widowed house keeps the name it was
given until a new Baron overwrites it.

`propagateDynastyLastName` fires `ensureCharacterRole` + `syncCharacterNickname`
per renamed character, since the bare name feeds both. **No `AuditLog` row** —
the rename is a consequence of the Baron's own edit, which is already logged.

### Bare names, and sorting

Two surfaces deliberately use the **bare** name (`formatBareName`, first +
last): the personal Discord role's name and colour seed, and the Discord
nickname (`PROXYING.md` §8). The role is an `@`-mentionable access-control
primitive rather than an RP surface, and seeding the colour off the bare name
means granting or changing a title never renames or recolours anyone.

`orderBy: { name: "asc" }` on a Character would file `Sir Jorren` under S, so
the seven Character-model sites use
`[{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }]`. Most
`orderBy: { name }` in the codebase is on Faction/Zone/Tag and is
untouched — **check the model before changing one.** The client-side
`characterName` sort in the GM tables still sorts the titled string, which is
fine: those tables are searched far more than sorted, and the search matches
the same string.


### 1e. The seven buckets

The picker groups roles into **Court, Clergy, Cerberon, Saviors, Business, Soil
and Outsiders**, and each card prints the faction it belongs to.

It used to nest **Zone → Faction → Role**, which is the shape the database
stores, the shape `docs/roles.yaml` is written in, and the shape `#info`'s
roles-intro thread still uses. On the picker it read as a map, and a map is not
the question being asked — what a player chooses between is a social position,
and those cut across the geography. The Church and the Order of the Silver
Cross are both in Town and are both clergy; the Company sits in the Caves and
the Factory in the Marshes and both are business.

`db/lib/roleGroups.js` is the only place the mapping lives. It is by faction
**slug**, and it is in code rather than in the YAML master for the same reason
`roleCapacity.js#PERMANENT_SEAT_ROLE_SLUGS` is: the sync has no business
reading it, and a typo here must not be able to throw `db:sync-roles` mid-pass
with the factions already written.

**A faction in no bucket falls into a trailing "Elsewhere" rather than
vanishing.** A silently dropped bucket would be a seat nobody could take,
discovered by a player rather than by us.

Nothing about `Faction.zoneId` changed. The faction page still chips its zone,
`#info` still groups by it, and each role card still names the zone its holder
starts in — only the picker's headings moved.
## 2. Roles

`docs/roles.yaml` is the master. `db/lib/syncRoles.js#syncRolesFromYaml`
(`npm run db:sync-roles`) reads its `zones[].factions[].roles[]` nesting into
the `Zone`/`Faction`/`Role` tables, matched by `slug`.

**A role's two prose fields go to different places.** `intro` is the one-line
pitch in the creation picker. `description` is a `String[]` of plain sentences
that a player reads as their **role charter**, pinned first in `/documents`'s
Assigned tab (`DOCUMENTS.md` §2) — joined into a Markdown bullet list there,
one bullet per YAML line. It is plain prose: no Markdown, no `{tag:…}` tokens
in any of the 49 today, and the charter renderer does not promise either.

Worth knowing because it was written and synced for every role and **rendered
nowhere at all** until that card existed — an edit to `description` used to
reach no one.

**Threats are not in `roles.yaml`.** Sympathizer, the Demoness, the Judge,
the NPC monsters, the Brigands — those seats are assigned
by hand by a GM and must never appear in the player-facing picker, so they are
prose in `db/lib/threats.js` rather than role data (`THREATS.md`). They used to sit in
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

**Who occupies a seat** is `roleCapacity.js#seatHolderStatuses(role)`: a
living character, normally — the holder dies and the role is offered again,
which is right for a Bum or a Cerberus. The roles in
`PERMANENT_SEAT_ROLE_SLUGS` — Gunboat's list: Baron, Baroness, Heir,
Successor, Hand, Meister, Arbiter, Censor, Incarn, Bishop, Esculap,
Inquisitor, Headman, Sheriff, Innkeeper and both Brigand roles — count DEAD
holders too, so once taken they stay taken for the run. It is neither "the unique roles" (Sheriff is weighted; Pusher and
Merchant are unique and deliberately absent) nor a faction — read the
constant, not a rule. A single-seat role on the list (Sheriff,
Ranger, Master of Parties at 100 players) is one-and-done for the run. "Taken"
means "a Character row still points at this Role": a GM deleting the dead
row from the dev panel, or moving the dead holder to another role, frees the
seat. The GM panel never checks capacity at all, so a GM can always seat
someone by hand. A slug list rather than a `roles.yaml` key for the same
reason the playtest lock below is: a static rule over a fixed roster, with
no column to migrate.

A role at capacity renders disabled. That's advisory only: `createCharacter`
re-counts inside the transaction that creates the character. A bare count
there is **not** enough by itself — Prisma runs at READ COMMITTED, so two
concurrent transactions can both read the same pre-insert count and both
commit, seating two Barons. What actually closes it is a `SELECT ... FOR
UPDATE` row lock taken on the Role first, the same pattern
`equipActions.js`'s equip-slot check uses, so the second attempt reads the
first's committed count. When two players sit on the last Baron seat and
both hit Confirm, the second one gets told to pick again.

### Seat reservations

A five-step wizard between "pick a role" and "the seat is actually yours" is
a long window for a capacity-1 role to vanish out from under a player mid-tag-menu.
`RoleReservation` (`db/lib/roleReservation.js`) holds a seat for **30
minutes**, refreshed on every Next after the Role step — so a careful tag
menu never costs it, but an abandoned tab frees a unique seat the same
session. `discordUserId` is `@unique`: a player can hold exactly one seat,
and reserving a different role releases the first as part of the same
upsert. Expiry is swept lazily wherever a taken count is read; there is no
cron job. The picker (`/character`) counts seated characters (per
`seatHolderStatuses`) plus everyone else's live hold, excluding the viewer's
own — so a held role reads as taken
to other players and available to its holder.

### The Leader Whitelist

A role with `leader: true` needs the **Leader Whitelist** Discord role
(`LEADER_WHITELIST_ROLE_ID` in `db/lib/roleIds.js`, checked by
`web/lib/discordGuild.js#isLeaderWhitelisted`). Without it the card renders
disabled, exactly like a role at capacity, and with no explanation — the
reservation is explained once in `#info`, not repeated on every card.

Same shape as every other gate here: the disabled card is presentation, and
`createCharacter` re-checks before it writes. Superadmins bypass.

The requirement can also be turned off for the whole game:
`GameConfig.leaderWhitelistEnabled` is a Dev Panel switch, **on** by default.
Off, every player may take a Leader seat and the Discord role stops mattering —
both the card and `createCharacter` read the same flag, so a hand-posted request
gets in too. It is on by default because the gate fails closed; a missing config
row still enforces it.

### Playtest mode

`GameConfig.playtestModeEnabled` is a second Dev Panel switch, **off** by
default, that can hold part of the roster back for a short test: any role
matched by slug, plus any role standing in a named zone. Its card still
renders, just disabled, carrying a "closed for this playtest" chip — a
locked role is still worth reading. Nothing is removed from
`docs/roles.yaml`, so flipping the switch off restores the roster with no
sync.

Which roles it covers lives in `web/lib/characterCreation.js`
(`PLAYTEST_LOCKED_ROLE_SLUGS`, `PLAYTEST_LOCKED_ZONE_NAMES`), not in the
database — a role is matched by `Role.slug`, a zone by **zone name**,
because nothing marks a role as belonging to a zone — `Role` and `Faction`
carry no availability column. `Zone` has no slug, so renaming the zone in
`roles.yaml` means moving the list with it. Both lists are `[]` today. The
mechanism is live, it just has no target until somebody names one.

Same presentation/enforcement split as everything else here: the card is a
hint, `createCharacter` re-checks. One difference — **a superadmin does not
bypass this one.** The other gates are reservations, so the host walks through
them to roll a test character; this one hides an unfinished role, and bypassing
it would only let the host roll the broken thing.

The GM surfaces are untouched: `/gm/dev/characters/[characterId]` will still
assign a locked role by hand.

### The starting package

Picking a role decides almost everything:

- `factionId` — from the role's faction.
- `zoneId` — from `starting_zone` (a Zone **slug** from `docs/zones.yaml`).
  `createCharacter` then calls `syncCharacterZoneRole(uid, null, zoneId)`, and
  **that role is the character's whole Discord channel access** — there are no
  per-Location channels and no per-member overwrites to grant any more
  (`CHANNELS.md` §3). A `starting_zone` must be a *presence* zone: the Caves
  group is a container, not a place, and the role sync refuses it.
- `resources` — `starting_resources`.
- `isLeader` / `isTreasurer` — from `leader: true` / `treasurer: true`.
  These were once entries in `starting_tags`; they're booleans on
  `Character`, not Tags (`TAGS.md` §6).
- `starting_tags` — granted free, as `CharacterTag` rows with source
  `GM_GRANT`, on top of anything bought.

The sync **throws** on a `starting_tags` name that isn't in the catalog or a
`starting_zone` slug that isn't a standable zone, rather than half-applying. A
typo can't ship characters missing part of their package.

## 3. The point economy

```
budget = GameConfig.startingTagPoints      (default 12, live on /gm/dev)
       + role.extra_starting_points        (Outsider +4; no other role sets it)
       - 6 if the player is Cursed
```

`web/lib/characterCreation.js` holds this arithmetic, and is imported by the
wizard, the server action, and the GM panel so the number a player is shown
and the number the server enforces cannot drift apart.

`Tag.pointCost` is **signed**. Positive costs points; negative *grants* them
(the drawbacks, Old and Frail at `-5` each). Summing signed costs means
both directions fall out of one subtraction, and `remaining >= 0` is the only
completion rule. Every negative-cost tag is `purchasableAfterStart: false` —
a drawback you could buy mid-game would be a point farm.

Drawbacks face **two** ceilings, and a build stops at whichever it reaches
first: at most `GameConfig.maxDrawbackTags` of them may be bought (**5** by
default), claiming back at most `GameConfig.maxDrawbackPoints` points in total
(**12** by default, matching `startingTagPoints` — you can never claim back
more than you started with). Both are live on `/gm/dev`. Either alone leaves a
hole: a count cap spends the same slot on a −1 as on a −11, and a point cap
alone never stops a pile of small ones. The role's own starting tags land as
`GM_GRANT` and never pass through the purchase path, so the Meister's free
Frail and the Headman's Old count against neither. `TAGS.md` §4a is the full
rule.

Leftover points are kept, not lost: they land on `Character.tagPoints`.

Fulfilling a Desire is the only way points are *earned* in play. A
character may hold up to `GameConfig.desireSlots` Desires `ACTIVE` at once
(default 2), one per slot, each independently set/cancelled/fulfilled
(`DESIRES.md`, `REQUESTS.md` §5).
Spending happens through the `/store`'s point-buy purchases (`BUY_TAGS`),
which check the balance up front and refuse a cart that would take it below
0 — so unlike `Character.tagPoints` at creation, the in-play balance never
goes negative.

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
**Migrant** or a **Bum**, and with **6 fewer points**
(`web/lib/characterCreation.js`'s `CURSED_ROLE_SLUGS`/`CURSED_POINT_PENALTY`,
enforced by `isRoleSelectable`/`computeBudget`, unchanged by this — only
where the `cursed` boolean they're fed comes from changed).

**Players lift it themselves, by burying the body — or, failing that, by
carving a stone.** Two requests now do it (`REQUESTS.md` §5d,
[`CORPSES.md`](CORPSES.md)). `BURY_CHARACTER` needs the dead character's actual
**corpse tag**, held or lying in a room the filer can reach, and spends their
Move; `ENGRAVE_HEADSTONE` is the answer to a body nobody can find, costing 4 ⬢
and a Move and matching a **typed** first name game-wide. Either one removes the
role from the dead player's Discord account after its transaction commits. That
is the fiction the setting has always carried — `docs/documents.yaml`'s
Respawning entry says to wait until your body is buried, and the Mortus role
exists to do the burying — finally wired to something.

**Butchering a corpse does not lift the curse.** Destroying a body is not
burying it, and that is exactly why Engrave exists: somebody whose corpse was
cut up and scattered has no body left to bury, and a stone is the only way out. A GM can still do it by hand from
Discord's member panel; `/gm/dev/characters/[characterId]` shows a read-only
Cursed status line, with no checkbox to toggle it from the app.

(`CharacterStatus.CURSED` still exists in the enum and is unrelated — it's an
unused leftover, kept only because dropping a Postgres enum value is a risky
migration.)

## 4b. Launch gating

Character creation is behind **two independent locks**, both of which must be
open:

1. `GameConfig.openToPlayers` — a Dev Panel toggle, off by default. "The doors
   are open."
2. The hardcoded `PLAYER_ROLE_ID` (`db/lib/roleIds.js`). "You are on the list."

The enforcement boundary is `createCharacter`
(`web/app/(app)/character/createActions.js`), checked **before** any point-buy
validation. `/character` additionally renders `CreationClosed.js` instead of the
wizard, so the reason is legible up front rather than arriving as an error after
four steps.

A **superadmin bypasses both** (`web/lib/superadmin.js#isSuperadmin`, checked in
`createCharacter` and mirrored in `/character`'s render so the host sees the
wizard). That's host/developer access, not a game permission — it exists so the
host can roll a test character without flipping the live toggle for everyone.
Enforcement still lives in the server action; the page-level check is
presentation.

**The gate covers character creation only.** Everything else — `/documents`
especially — stays readable. That's the point: the site goes up before the game
opens so players can read the rules.

## 5. Death

Setting a character to `DEAD` used to write a column and nothing else — it
even left `ensureCharacterRole` renaming and recoloring the dead character's
Discord role afterward. `web/lib/discordGuild.js#killCharacter`, called from
`updateCharacterRaw` on the transition **to** `DEAD`, now does the cleanup:

1. **Explicitly revokes every viewing grant** (`revokeAllCharacterAccess`),
   before the role is deleted — it needs both the role id and the Discord user
   id. It strips **every** zone role (removing one they don't hold is a no-op,
   so all six cost less than trusting possibly-stale state about which they
   held) and sweeps their member overwrites off every zone channel and the
   special channels, under either key.

   This used to be a free side effect of step 2: Discord drops every overwrite
   tied to a role the moment the role goes. That holds only while access is
   keyed on the *personal* role — a zone role outlives the character, and a
   member overwrite is not tied to the personal role either, so a dead
   character's player would keep seeing the room they died in. It sweeps
   blindly rather than trusting `Character.zoneId`, since a half-failed role
   swap leaves a grant on the zone they left and death is the wrong moment to
   trust that invariant.
2. Deletes the personal Discord role.
3. Nulls `discordRoleId` — it's `@unique`, and a dangling id would have
   `ensureCharacterRole` PATCHing a deleted role forever.
4. Clears the Discord nickname. Unconditional — note the asymmetry:
   *setting* a nickname is gated behind `GameConfig.nicknameSyncEnabled`
   (off by default), but clearing a dead character's is not.
5. Grants the Cursed role (§4).
6. Writes a `DEATH` row to the transcript (`ARCHIVE.md`).
7. Clears `CharacterTag.equipped` on every held tag. A corpse doesn't wield
   things, and a Revive later shouldn't walk back in with gear locked to
   slots that may have moved. It also keeps the loot panel (below) from
   rendering an item as if it's still worn.

`updateCharacterRaw` skips the role/zone sync entirely for a non-`ALIVE`
character.

### The corpse is lootable, the row survives

A dead character is not deleted, and their `CharacterTag` and `⬢` stay on the
row — until somebody buries them. `Character.buriedAt`, set by a
`BURY_CHARACTER` (or `ENGRAVE_HEADSTONE`) request, takes the body out of the
world: it stops being
lootable, draggable and bindable, and it drops out of every zone target menu.
Revive clears it, so a revived character is never a live person marked buried. Anyone standing in the zone the character died in can `TRANSFER_TAG`
or `TRANSFER_RESOURCES` **in the `LOOT` direction** to lift `tradeable` tags or ⬢
off the corpse — see `REQUESTS.md` §5. The `/character` page shows a "Bodies
here" panel to any living character in a zone that has a corpse; that
panel is the **only** player-facing surface that spells out that someone
died. Every other list (faction roster, transfer target picker) renders a
DEAD character as a normal row with no status pill, and every GM surface
still shows the raw `status`.

### Guild-leave is no longer a death — it's a countdown

A player leaving the guild no longer kills their character on the spot.
`guildMemberRemove.js` calls `db/lib/playerDeparture.js#markPlayerDeparted`:
the character goes **Catatonic** immediately (the same tag the AFK pass
grants), `Character.leftGuildAt` and `catatonicSinceTurn` are stamped, the
personal role is renamed grey (`<name> • Catatonic`) but **kept** — it's held
by nobody, so it leaks nothing, and `@`-mentions keep resolving while the
body still stands — and the alert posts to `#leave`. Then the clock runs:
after `GameConfig.catatonicDeathTurns` turns (default 4) the Catatonic death
pass (`TURN-ENGINE.md` §2 7b) kills them at close with the full §5 cleanup.
The Cursed grant is **conditional** there, not skipped-by-rule: granted if
the player is somehow back in the guild, silently skipped if not.

Rejoining in time is a real rescue: `guildMemberAdd.js` clears
`leftGuildAt`, re-grants the Player and zone roles and the narrowcast
overwrites (Discord stripped everything with the membership), and posts a
rejoin note to `#leave` — but the character stays Catatonic until they
**act or speak in character**, at which point the flagging pass's clear
branch wakes them and nulls the countdown.

Leaves the bot sleeps through are caught at the next startup by
`bot/src/lib/leaveReconcile.js`, which diffs the living roster against
actual guild membership and runs the same departure path (alerts prefixed
`[caught at startup]`). It carries a hard rail — an empty or suspiciously
thin member fetch aborts loudly rather than flagging the roster.

Until the countdown runs out, a departed player's character is **ALIVE
everywhere**: rosters, transfer pickers, their zone. They're incapacitated
(no auto-labor) and lootable-while-alive like any Catatonic character.

## 5b. Killing and reviving from the GM panel

The Dev Character Panel (`DEV-PANEL.md`) is where a GM does this by hand, and
both directions are **microactions with a confirm**, not a `status` dropdown.

That is deliberate. Death has side effects — the whole §5 list — and a staged
form field would have to replay them at save time, which is how the old editor
ended up able to set a corpse back to `ALIVE` while leaving it with no personal
role, no channel access, and the Cursed role still on the account. Removing
`status` from the form means the panel's Apply never has to reason about a
status transition at all: it reads the live value from the database.

**Revive** is the inverse §5 never had: `removeCursedRole`, then
`ensureCharacterRole`, then the nickname, then
`syncCharacterZoneRole(uid, null, zoneId)` — the old zone is `null` because
`killCharacter` already stripped every zone role, so this is a pure re-grant
with nothing to move away from — then `syncCharacterNarrowcastAccess`.

**Deleting** a character is a separate, superadmin-only action, and is not the
same thing as killing them. It removes the row and everything pointing at it
through `db/lib/deleteCharacter.js`. (The `guildMemberRemove` handler used
to share it, then soft-killed instead, and now doesn't touch the row's
existence at all — leaving is a Catatonic countdown, §5.) Two
dependents are detached rather than deleted: `AuditLog.targetCharacterId` and
`Note.characterId` are nulled, because the audit trail must outlive its subject
and `Note.characterName` is already a snapshot.

## 6. Special channels (`#cerberon`)

These are the **only** per-member overwrites left in the game: zone access
rides a role now, but a special channel's grant is still keyed on
`Character.discordUserId`, reconciled after every zone change, every tag
change and on character creation. The rules themselves (who holds which radio
tag) live in one place: **`CHANNELS.md` §7**. They were duplicated here and
drifted; don't re-add them. `#intercom` is gone — the PA is a button on the
Council Room now (`CHANNELS.md` §7a) and grants nothing to anybody.

## 7. Sync order

The three YAML masters have dependencies, so order is load-bearing — this is
the order `wipeGameData`'s "Restart Game" runs them in:

```
zones  ->  tags  ->  roles
```

Roles resolve a `starting_zone` *and* validate `starting_tags`. Their delete
contracts differ and are worth knowing: zones is **fully destructive** (a
dropped Zone loses its Discord category, channels, access role and its row),
roles prunes only rows nothing references, and tags is a pure upsert that
never deletes. See `SYNC.md`.

## 8. Where the code lives

| Concern | File |
|---|---|
| Masters | `docs/roles.yaml`, `docs/tags.yaml`, `docs/zones.yaml` |
| Role sync | `db/lib/syncRoles.js`, `db/scripts/sync/sync-roles.js` |
| Special channels | `db/lib/specialChannels.js`, `db/lib/syncSpecialChannels.js`, `db/scripts/sync/sync-narrowcast-channels.js` |
| Seat math | `db/lib/roleCapacity.js` |
| Budget/eligibility rules | `web/lib/characterCreation.js` |
| Wizard | `web/app/(app)/character/CreateCharacterWizard.js` |
| Point-buy menu | `web/app/components/PointBuy.js` |
| Creation action | `web/app/(app)/character/createActions.js` |
| Discord access + death | `web/lib/discordGuild.js` |
| Name formatting | `db/lib/characterName.js` |
| Dynasty | `db/lib/dynasty.js`, `web/lib/dynasty.js` |
| Threat catalog | `db/lib/threats.js` (see `THREATS.md`) |
| Launch gating | `db/lib/roleIds.js`, `web/lib/superadmin.js` |

## Starting obols

A few seats begin the game with coin in their pocket, so the Merchant has
somebody to trade with on turn one: Baron 25 ¢, Hand 10 ¢, Esculap 10 ¢, and
Baroness, Heir and Meister 5 ¢ each. The Merchant starts with 20 ¢ and a Depot
Keycard; every Docker starts with a Keycard. An obol is one ⬢, so those are
also the ⬢ figures.

These are authored in `docs/roles.yaml` with a **count suffix** —
`- Obol x25` — parsed by `db/lib/startingTags.js`. A bare name still means one,
which is every other entry in every other role. Repeating the name five times
could not work: `createCharacter` resolves the list with `name: { in: [...] }`,
a set lookup that collapses duplicates.

See `docs/systemdocs/DEPOT.md` §0g.
