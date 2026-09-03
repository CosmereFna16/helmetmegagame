# Factions

Who belongs to what, and who can see what a member is holding.

Silos were removed in 9/2026. Leader/Treasurer now only gate seeing a
member's ⬢ (§4a and below) — there is no faction treasury, no reach gate, and
no quiet-adjustment machinery left to document.

## 1. Faction is game state, not a Discord role

`Faction` has **no Discord role backing it at all**. It's a pure Bascinet
concept, master-sourced from `docs/roles.yaml` (see `SYNC.md`) and editable by
GMs on `/faction` and `/gm/dev/factions`. Discord's own roles — used for
faction pings and the like — are independent and unmanaged by Bascinet.

Factions nest: `Faction.parentFactionId` forms a hierarchy.

The nesting is **authored, then live**. `roles.yaml`'s `parent:` seeds it when
a faction row is first created; after that it belongs to the game, and a GM
re-parents or detaches a faction on `/gm/dev/factions` (cycle-guarded there).
Re-running `db:sync-roles` does **not** undo that edit — see `SYNC.md`
"Create-only fields". Detaching a subject is how a clan rebels: the subject
drops off the GM overview's indentation, and nothing else about the members
changes.

## 2. Leader and Treasurer are booleans, not tags

`Character.isLeader` and `Character.isTreasurer`. They were tags once; they
aren't now, and nothing should reintroduce them as tags.

Assignment happens on `/faction`
(`web/app/(app)/faction/actions.js#setFactionLeader` / `#setTreasurer`):

- **Leader** is set by a GM.
- **Treasurer** is set by a GM *or* by the faction's current Leader.

A role can also grant either at creation, via `leader:`/`treasurer:` booleans
in `docs/roles.yaml`.

## 4a. Role is same-faction knowledge, not officer authority

Role (`Character.roleTitle`) is visible on both faces of the game, gated on
**sharing a faction** — deliberately not on Leader/Treasurer status.

- `/faction`'s roster carries an unconditional Role column, on both the
  player and GM branches.
- The bot's 🔍 inspect embed adds a `Role` field only when the viewer's own
  ALIVE character shares `factionId` with the subject (and neither is
  Unaffiliated). Absent, never masked. A `/conceal`ed message never reaches
  this branch at all.
- The **Who's here?** button (`zone:who:{zoneId}`, `db/lib/zoneAnchorRow.js`,
  `CHANNELS.md` §4) on each zone's Create-a-Topic anchor runs the same test:
  it lists every name in the zone, appending `, {roleTitle}` only for a
  character sharing the viewer's `factionId` (neither Unaffiliated).

Resources works the same way but narrower: a faction's own Leader or
Treasurer (`getMyFactionRole(prisma, discordUserId, factionId).isOfficer`,
`db/lib/factionPermissions.js`) sees what each member is holding — on
`/faction`'s roster and on the bot's 🔍 inspect embed
(`bot/src/events/messageReactionAdd.js`). Absent, never masked, same posture
as Role. `getMyFactionRole` only ever answers for the viewer's own faction —
there is no ancestor walk any more.

One more thing the player roster shows that fate never is: a **Catatonic**
chip next to an AFK member's name. Death stays hidden there on purpose (the
comment in `faction/page.js` explains the no-fate rule), but Catatonic is a
visible tag whose entire job is telling the faction a player is away
(`TAGS.md` §7), so the chip renders for ordinary members too. Since the
guild-leave rework the chip can also mean the player has **left the server**
and their character is on the death countdown (`CHARACTERS.md` §5) — the
roster deliberately doesn't distinguish the two.

## 7. Where the code lives

| File | Role |
|---|---|
| `db/lib/factionPermissions.js` | `getMyFactionRole`, `getFactionAncestorIds` |
| `web/lib/factionPermissions.js` | Thin prisma-binding shim |
| `web/app/(app)/faction/page.js` | The panel — roster, leadership |
| `web/app/(app)/faction/actions.js` | `setFactionLeader`, `setTreasurer` |
| `web/app/(app)/gm/dev/factions/` | GM raw faction editing |
| `docs/roles.yaml` | The master (`SYNC.md`) |
