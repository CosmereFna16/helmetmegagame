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
| Person → person (⬢ or a tag) | Same **Location** |
| Either end is a **Silo** | Same **Zone** as the faction's `zoneId`, **or** same Zone as one of its Leaders/Treasurers |

`Faction.zoneId` is the silo zone. It already existed for the role picker and
now carries game state too — see the comment in `schema.prisma`.

**Officers extend a Silo's reach, and that is the load-bearing part.** Pinning
a Silo to a *building* would let an occupying force paralyse a faction's
treasury with no counterplay. Pinning it to a zone with a mobile officer
extension means a besieged fortress makes the tax run dangerous, while an
officer who rides out to meet you makes it easier — leadership can always walk
toward the problem. It also means losing every officer doesn't freeze a Silo:
it only loses the extension, and the home zone still works.

Ancestors count, for the same reason `getSiloAccess` lets a parent's Leader
manage a subject's Silo — authority flows downward, so a parent's officer is a
legitimate mouth for a subject faction. Never the reverse.

**The party dropdowns are deliberately NOT filtered by reach.** A range-filtered
menu would be a free "who is standing in my zone" scouting tool, which is a
worse leak than the friction it saves. Every living player and every Silo stays
listed and the gate fires on submit. The residual leak — a *success* tells you
some officer is in your zone — is a binary, not a roster, and is the mechanic
working.

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

Two neighbouring inspect fields follow the same posture but are gated on the
**inspector's own tags** rather than the subject's Silo: Seductive reveals the
subject's active Desire, Torturer their Fear, resolved by
`db/lib/inspectVision.js` (which also accepts each tag's discounted Demoness
twin). That's bot-only — the web has no other-player character sheet.

## 5. Moving Resources out of a Silo

**There is no direct transfer UI.** `/faction` had a "Transfer from Silo" panel
and it was removed: it was a direct mutation with an optional note and no
`Request` row, so a GM could neither review nor undo it.

The one way out is the `TRANSFER_RESOURCES` request on `/character`
(`TransferResourcesButton`), which demands a reason, appears in the Requests
tab, and is undoable. See `REQUESTS.md`.

It is also gated on **reach** (§3b): the acting character has to be in the
Silo's zone or standing with one of its officers. `HEAL_CHARACTER`'s Silo payer
is gated the same way — it used to pay from anywhere, which became a laundering
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
