# Factions and the Silo

Who belongs to what, who can spend the faction's Resources, and who can see
that they exist.

## 1. Faction is game state, not a Discord role

`Faction` has **no Discord role backing it at all**. It's a pure Bascinet
concept, master-sourced from `docs/roles.yaml` (see `SYNC.md`) and editable by
GMs on `/faction` and `/gm/dev/factions`. Discord's own roles — used for
faction pings and the like — are independent and unmanaged by Bascinet.

Factions nest: `Faction.parentFactionId` forms a hierarchy, and a parent's
leadership reaches down into its subjects.

A Silo's **opening balance is computed, not authored**: the sum of the
faction's role weights (`unlimited` counts 5, a single-seat role counts 1),
scaled by `GameConfig.playerCount` and floored at 10 ⬢ —
`db/lib/factionSilo.js`. Seeded at faction creation and by the Restart Game
wipe (`SYNC.md` "Create-only fields"). Unaffiliated is excluded and holds no
Silo.

## 2. Leader and Treasurer are booleans, not tags

`Character.isLeader` and `Character.isTreasurer`. They were tags once; they
aren't now, and nothing should reintroduce them as tags.

Assignment happens on `/faction`
(`web/app/(app)/faction/actions.js#setFactionLeader` / `#setTreasurer`):

- **Leader** is set by a GM.
- **Treasurer** is set by a GM *or* by the faction's current Leader.

A role can also grant either at creation, via `leader:`/`treasurer:` booleans
in `docs/roles.yaml`.

## 3. Silo authority

`db/lib/factionPermissions.js` answers the whole question. It lives in
`db/lib` — taking `prisma` as its first parameter, the same convention as
`db/lib/dm.js`, and deliberately **not** spread into the `@lifeweb/db` barrel —
because both faces of the game ask it. `web/lib/factionPermissions.js` is a
thin shim binding the singleton `prisma` so web call sites keep the shorter
signature.

Three functions:

| Function | Answers |
|---|---|
| `getMyFactionRole(prisma, discordUserId, factionId)` | Am I Leader or Treasurer *of this faction*? Returns `canManageSilo`. |
| `getFactionAncestorIds(prisma, factionId)` | The chain up to the root. **Cycle-guarded** with a `seen` set — a malformed parent chain must not hang the request. |
| `getSiloAccess(prisma, discordUserId, targetFactionId)` | The real gate: own-faction authority, **or** authority at any ancestor. |

Authority flows **downward only**. A parent faction's Leader or Treasurer can
manage a subject faction's Silo; a subject's Leader has no reach upward.

## 3b. Silo reach — a separate gate from authority

Authority answers *may I*. **Reach** answers *can I get there*, and they are
independent: a Leader has authority over their Silo from anywhere on the map,
and that is not the same as being able to put anything into it.

`web/lib/transferReach.js` owns reach. Two grains:

| Moving | Gate |
|---|---|
| Person → person (⬢ or a tag) | Same **Zone** — since the zone rework a zone *is* the room, so this and the Silo gate are now the same grain |
| Either end is a **Silo** | The actor's **seat** zone equals the faction's `zoneId`. Full stop. |

`Faction.zoneId` is the silo zone, and it is a **seat** zone: presence is six
zones, seats are four, and the whole cave system belongs to the Caves row
(`GAMEMASTERS.md` §2a). That is why `canReachSilo` maps the actor's presence
zone through `seatZoneIdFor` before comparing. So a Silo seated in the Caves
is reachable from any cave level, which is the intent.

**The officer extension has been removed.** A Silo's reach used to also
include any zone one of its Leaders or Treasurers happened to be standing in
— the idea being that leadership could always walk toward the problem during
a siege. In practice that ran backwards: it let an officer ride out to meet a
payer and keep a besieged faction's treasury payable from outside its own
walls, which is exactly the counterplay a siege is supposed to deny the
defender. Treasury access is now tied to physically holding the seat zone,
with no mobile extension of it — losing the seat zone freezes the Silo, full
stop.

**The party dropdowns are deliberately NOT filtered by reach.** A range-filtered
menu would be a free "who is standing in my zone" scouting tool, which is a
worse leak than the friction it saves. Every living player and every Silo stays
listed and the gate fires on submit, with a clear rejection message instead of
a hidden option.

Same-Zone travel is free and creates no `Action` (`MAP.md` §3), so this costs a
real Move only when the parties are genuinely far apart, and nothing at all in
the ordinary in-town case.

## 4. What Silo authority gates

Not just spending — **seeing**. Three surfaces, all with the same
absent-not-masked posture: if you don't have access, the field simply isn't
there. A placeholder would advertise that there's something to go after.

1. The Resources column on `/faction`'s roster, including the subject-faction
   view a parent's Leader or Treasurer can open.
2. The Resources field on the bot's 🔍 inspect embed
   (`bot/src/events/messageReactionAdd.js`).
3. The subject-faction view itself.

A neighbouring inspect field follows the same posture but is gated on the
**inspector's own tags** rather than the subject's Silo: Seductive reveals the
subject's active Desire, resolved by `db/lib/inspectVision.js` (which also
accepts the tag's discounted Demoness twin). That's bot-only — the web has no
other-player character sheet.

## 4a. Role is same-faction knowledge, not Silo authority

Role (`Character.roleTitle`) is visible on both faces of the game, gated on
**sharing a faction** — deliberately not on Silo authority, and not on the
ancestor walk `getSiloAccess` does. A parent faction's Leader or Treasurer can
manage a subject faction's Silo without knowing its org chart; only actually
being a member of that faction does.

- `/faction`'s roster carries an unconditional Role column, on both the
  player and GM branches, and on the subject-faction view a parent's Leader
  or Treasurer opens — that view already exposes Resources, so Role is not a
  widening of what a parent can see there.
- The bot's 🔍 inspect embed adds a `Role` field only when the viewer's own
  ALIVE character shares `factionId` with the subject (and neither is
  Unaffiliated). Absent, never masked, same posture as Resources above. A
  `/conceal`ed message never reaches this branch at all.

## 5. Moving Resources out of a Silo

**There is no direct transfer UI.** `/faction` had a "Transfer from Silo" panel
and it was removed: it was a direct mutation with an optional note and no
`Request` row, so a GM could neither review nor undo it.

The one way out is the `TRANSFER_RESOURCES` request on `/character` (the ⬢
button in the Actions grid, `RequestActionsProvider.js`), which demands a reason, appears in the Requests
tab, and is undoable. See `REQUESTS.md`.

It is also gated on **reach** (§3b): the acting character has to be
physically standing in the Silo's seat zone. `HEAL_CHARACTER`'s Silo payer is
gated the same way — it used to pay from anywhere, which became a laundering
hole the moment transfers grew a reach gate.

`SiloTransaction` rows are still written on **both** directions of that
transfer, so `/faction`'s Silo history is unchanged.

## 6. `SiloTransaction` is a ledger, not a relation

One row per change to a Silo — deposits, Dev Panel corrections, and
Leader/Treasurer transfers to a member — so the faction panel can show
"who took what, when, how much, to whom" rather than just a current total.

`amount` is **signed**: positive grows the silo, negative shrinks it.

**No foreign keys.** `factionId`, `actorCharacterId` and `toCharacterId` are
plain indexed columns, with `actorName`/`toName` snapshots alongside. Log rows
have to survive a character or faction being deleted — the same reasoning as
`AuditLog` and `ArchiveEntry` — and the snapshot is the more correct record
anyway: who someone was known as *then*.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/factionPermissions.js` | The three authority functions |
| `web/lib/transferReach.js` | Silo/person **reach** — the separate gate (§3b) |
| `web/lib/factionPermissions.js` | Thin prisma-binding shim |
| `web/app/(app)/faction/page.js` | The panel — roster, silo history, leadership |
| `web/app/(app)/faction/actions.js` | `setFactionLeader`, `setTreasurer` |
| `web/app/(app)/gm/dev/factions/` | GM raw faction editing |
| `docs/roles.yaml` | The master (`SYNC.md`) |
