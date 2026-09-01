# Desires

The tag-point earning half of the point economy. A Desire used to be
free-text on a 1–5 ladder; it is now a picked-from-catalog goal, drawn from
`docs/desires.yaml`, with its own gates, cooldowns and a per-tag-group
lock/unlock mechanism. Read `TAGS.md` §4 first for the point economy itself
and `REQUESTS.md` §5 for the request-level mechanics; this doc is the system
doc for the catalog, its gates, and the GM surface.

## 1. What a Desire is now

`DesireTemplate` is the catalog — one row per pickable goal, sourced from
`docs/desires.yaml`, upserted by `db:sync-desires`. `Desire` is a
character's attempt at one: a row per set/cancel/fulfil cycle, carrying
`slotIndex`, `status` (`ACTIVE`/`FULFILLED`/`CANCELLED`), `setTurnNumber`,
`endedTurnNumber`, and — for a catalog pick — `templateId` and the template's
`points` snapshotted at set time. A free-text Desire (still available, from a
GM only — see §6) carries `templateId: null` instead.

`GameConfig.desireSlots` (default 2) is how many Desires a character may
hold `ACTIVE` at once, one per slot. A slot is independent of every other
slot: setting, cancelling and fulfilling all take a `slotIndex`, and a
character with two slots can have one Desire cooking while another cools
down or sits idle.

**Tier doubles as the Tag Point award and the per-desire cooldown length.**
A tier-3 Desire is worth 3 points and, once fulfilled, can't be picked again
for 3 turns. The whitelist is `{1, 2, 3, 4, 5, 7}` — tier 6 is deliberately
absent, don't invent it (`db/lib/syncDesires.js#TIER_WHITELIST`).

## 2. The tier ladder + cooldowns

Two cooldowns exist, at different scopes, and neither of them is a turn
pass:

- **Per-desire cooldown** — once a *specific template* is fulfilled, that
  same template is unavailable again until
  `openTurnNumber >= endedTurnNumber + (cooldownTurns ?? tier)`. Exactly at
  the boundary turn it's available again, not still cooling. `cooldownTurns`
  is a per-entry override of the tier-length default — `sit-in-bliss` in
  `docs/desires.yaml` is the one user of it today.
- **Per-slot lock** — once *any* Desire in a slot ends (cancel or fulfil),
  that slot is locked until the next turn:
  `openTurnNumber <= max(endedTurnNumber over that slot's ended rows)`
  locks it, so it opens back up strictly the turn after. This stops a player
  from cancel-and-immediately-refill farming a slot within the same turn,
  independent of which template they're aiming at.
- **Tier 7 — ONCE EVER.** `db:sync-desires` defaults `oncePerLife: true` for
  every tier-7 entry automatically; it's never written by hand in the YAML
  for a tier-7 row. `oncePerLife` can also be set by hand at any other tier,
  for the handful of entries where repeating the thing is absurd on its face
  (a second first-ever coronation, learning to read twice) — and, as the one
  documented opt-out, `oncePerLife: false` on a tier-7 entry turns the
  default *off* for that entry.

**Why these are stateless turn-number comparisons, not a turn pass.** Every
gate above reads as `openTurnNumber` vs. a stamped `endedTurnNumber` (or
`setTurnNumber`), computed fresh on every read (`db/lib/desireGates.js`).
Nothing runs at turn-close to advance a Desire's cooldown counter — there is
no counter, only two absolute turn numbers and a comparison. This is
deliberate: it means a GM can rewind the open turn (superadmin-only, see
`ADJUDICATION.md`) and every cooldown recomputes correctly against the
rewound number with no separate fix-up pass, but it also means a turn
rewind genuinely does re-open or re-lock Desires as a side effect — the
same way it does everything else keyed off `Turn.number`.

## 3. `requires` semantics

`requires.anyTags` / `requires.anyRoles` / `requires.notTags` /
`requires.notRoles` combine as **AND across the four lists, OR within each
one**. `anyTags: [dancer]` + `anyRoles: [minstrel, diplomat]` reads "holds
Dancer, AND holds Minstrel or Diplomat" — not "Dancer or Minstrel or
Diplomat". Omit a sub-key entirely rather than writing an empty list; an
absent/empty list is no constraint at all (`db/lib/desireGates.js#evalRequires`).

`notTags`/`notRoles` are checked before `anyTags`/`anyRoles`, so a held
forbidden tag or role always wins the "locked" reason over an unmet `any`
gate — this only decides which reason string wins when more than one clause
fails; it changes nothing about whether the Desire is available.

### Lock-clause grammar and the union rule

Separately from `requires`, a **held tag** can lock parts of the catalog
shut via its own `desires: { locks: [...] }` block in `docs/tags.yaml`
(`db/lib/desireShapes.js`). Each clause is exactly one of:

```yaml
- all: true                       # locks everything
- families: [alcohol, drugs]      # locks any template sharing a family
- tiers: [1, 2, 3, 4]             # locks templates at these tiers
```

plus an optional `exceptFamilies: [...]`, meaningful only alongside `all` or
`tiers` (a `families` clause already *is* the family list, so excepting from
it would be self-contradictory — `desireShapes.js` throws on that
combination). Precedence when a template is checked against a tag's clauses:
`all` beats `families` beats `tiers`, so an `all` clause always wins even if
a `families` clause from a different held tag would otherwise have matched
first (`db/lib/desireGates.js#lockedReasonForTemplate`).

**Union rule**: when a character holds more than one tag with a
`desires.locks` block, every clause from every held tag applies —
locks only ever add, never subtract (`unionLockClauses` in
`desireGates.js`). There's no way for one held tag's lock to loosen
another's.

The grammar can't express every intent. Nobility's "closed to Desires below
tier 1" plus "cheap standard food doesn't count" collapses to `tiers: [1]`
in the YAML with the second half left as a GM-adjudicated prose line in the
tag's description (Ruling R4) — the grammar has no way to except one family
*and* keep an exception's own exception. Kleptomaniac's `families: [wealth]`
lock similarly took a one-line data fix on two unrelated desires
(`sell-stolen-jewelry`, `pocket-60`) to drop `wealth` from their own family
list, since a clause can't combine `families` and `exceptFamilies` in one
breath (Ruling R7).

## 4. Hidden templates and the identical-error oracle defense

A `requires.anyTags` gate whose gating tag is itself hidden (Demoness,
Bacchus — `TAGS.md` §3a) is a special case: failing it doesn't produce a
"locked" state at all. `evaluateDesireCatalog` **withholds the entry
entirely** from its `visible` array — it never reaches a picker, dimmed or
otherwise (`db/lib/desireGates.js` §evaluation order, step 1). Getting this
wrong leaks the existence of a hidden roster.

The matching defense sits in `evalRequires`: if a template's `anyTags` gate
fails and the gating tag is hidden, the function returns `{ hidden: true }`
rather than a `{ ok: false, reason }` — and the reason string for an
*ordinary* locked entry never names a hidden tag, on pain of becoming the
oracle the hidden rule exists to prevent. If a locked-reason string ever
told a non-cultist "Requires the Cultist of Bacchus tag," that sentence
alone would out the category — which is exactly why the code path is
"withhold the row," not "show a generic reason." The two failure modes
(gated-and-hidden vs. gated-and-visible-but-locked) must produce
indistinguishable UI for anyone who can't already see the hidden category:
nothing at all, vs. a reason that never names what's actually gating it.

## 5. The three tag groups and `conflictsWith`

Three `general` tag groups came out of this rework, replacing the old
scattered drawback/interest tags:

| Group | Shape | Price band |
|---|---|---|
| `general-addictions` | `exclusive: true`, `removable: false`, `consumable: false` drawbacks. Each locks most of the catalog shut except its own family (`Alcoholic` locks everything but `alcohol` at tiers 1–4; `Glutton` locks everything but `food`, at *every* tier). Purchasable after start — the point of an Addiction is that it's meant to be taken mid-game for the points. | −2…−7 |
| `general-restrictions` | `exclusive: true` drawbacks that close the catalog down without opening a compensating family (`Depressed` locks everything; `Nobility` locks tier-1 entirely). Not purchasable after start — no farmable-drawback carve-out here. | −1…−8 |
| `general-interests` | Non-exclusive, purchasable, purchasable after start. Interests don't lock anything — they *open* a Desire that would otherwise sit outside a character's normal wheelhouse (`Mad Doctor`, `Esoteric`, `Adventurer`, `Cruel`, `Charitable`, `Schemer`, and `Death Wish` — the Interest, not the old Bacchus tag, see §7). | +2 / +5 |

‡ The price bands follow an income-based rationale: an Addiction is priced
by how hard it constrains the catalog it opens (a Glutton, locked to food at
every tier, sits at the deep end; an Alcoholic, which still has tiers 5 and
7 open everywhere, costs less); a Restriction is priced purely by how much
it closes with nothing given back (Depressed, closing everything, is the
floor at −8); an Interest costs points because it's a pure upside — it never
locks anything, only widens what's pickable.

**`conflictsWith`** (`Tag.conflictsWith`, a self-referential m2m,
`SYNC.md` pass 6) is a named pairwise conflict, authored one-directional in
`docs/tags.yaml` and symmetrized by the sync — unlike `exclusive` (at most
one tag per character *per group*), a conflict isn't scoped to a group and
isn't carved out for a `requiredTag` pair. The one-per-group rule the three
new groups themselves enforce (at most one Addiction, at most one
Restriction) is plain `exclusive` — nothing new there. `conflictsWith` is
for a conflict that crosses groups: every Addiction and every Restriction
lists `conflictsWith: [depressed, ascetic, ...]` so a character can't stack,
say, Alcoholic with Depressed (a Restriction that already locks everything,
making an Addiction's own unlock moot and confusing) or with Ascetic (a
whole different philosophy of self-denial). `web/lib/characterCreation.js#conflictingTag`
is the enforcement predicate, same posture as `exclusiveConflict` — a GM
grant bypasses it, like every other creation-time gate.

## 6. The GM surface

`GoalsTab` (`web/app/(app)/gm/dev/characters/[characterId]/GoalsTab.js`) is
per-slot, mirroring the player-facing `DesirePanel`/`DesireCatalog`: each of
`GameConfig.desireSlots` slots shows its own occupant and, when empty, its
own "set a Desire" sub-form. This is a microaction rather than a staged
field — fulfilling a Desire moves `Character.tagPoints`, and staging a point
movement alongside a hand-edited `tagPoints` value on the Identity tab would
make the arithmetic ambiguous, so it commits on its own and the Identity
field always shows the result.

Two routes to set one, both **gates bypassed** (a GM grant is never
second-guessed, same rule as every other gate in the game):

- **Catalog** — pick any `DesireTemplate`, retired ones included and marked.
  No `requires`, no held-tag lock, no cooldown, no `onceEver` check.
- **Free text** — the kept fallback, 1..7 points (wider than the
  player-facing 1–5 ladder that used to be the whole system), `templateId`
  stays null.

Setting a new Desire in an already-occupied slot cancels that slot's current
`ACTIVE` row first, in the same transaction (`setDesireGmImpl`).

Fulfilling from the Dev Panel is a **re-score, not a cooldown reset**: it
awards `desire.points` and stamps `endedTurnNumber`, the same as the player
path, which means it *does* start the normal per-desire/per-slot cooldown
clock — there's no separate "GM fulfil, no cooldown" mode. What a GM grant
actually skips is the *gate* on setting a new one, not the bookkeeping once
one ends.

**Undo slot-collision rule**: because a GM's Fulfil/Cancel button
(`endDesireGm`) operates on a specific `desireId`, not "the slot's current
row," undoing an old Fulfil/Cancel through the Request system (`REQUESTS.md`
§2) after a *new* Desire has since been set in that same slot is safe — the
undo only ever touches the row it snapshotted, never whatever now occupies
the slot. The visible effect is that a slot can carry more than one
`FULFILLED`/`CANCELLED` row in its history, and only the single row with
`status: ACTIVE` (if any) is ever "the" occupant a picker or the cooldown
math cares about.

## 7. The clawback rule ‡

Curing an Addiction or Restriction (a Chaplain confessing someone free of
one, say) is a `HEAL_CHARACTER`-shaped GM adjudication, not a code-enforced
transaction — and when a GM does cure one, the rule is: **deduct the points
that Addiction/Restriction granted, even into negative.** A Cultist who took
Glutton for the −6 points and later gets cured of it loses those 6 points
back out of `Character.tagPoints`, even if that takes the balance below
zero. This closes the loop a curable, maximally valuable drawback would
otherwise be: buy a drawback for the points, get cured for free, keep the
points — a point farm with a Chaplain as the vending machine. There is no
code enforcement of this; it is GM-adjudicated the same way every other
Health-tag cure is (`TAGS.md` §5c), and it's written here because the
consequence (going negative) is the one a GM might otherwise hesitate over.

## 8. The anti-loop rule ‡

"**A Desire arranged solely to fulfil a Desire is not fulfilled.**" A
character can't stage a scene whose entire content is manufacturing the
conditions for a Desire and then claim it — e.g. asking someone for a hug
purely to fulfil `get-a-hug`. The rule exists specifically against a
tier-1, high-frequency Desire like that one turning into a repeatable income
tap with no roleplay cost. There is no code check for this (a Desire is
fulfilled by a GM review of a `FULFILL_DESIRE` request, same as any other
Request), so it's a written adjudication standard, not a gate — a GM reading
the reason field is the enforcement.

## 9. Config: `desiresEnabled` / `desireSlots` / `maxDrawbackTags`

Three `GameConfig` knobs govern this system, all live-editable from
`/gm/dev` and all reset by a Restart Game wipe:

- **`desiresEnabled`** (default `true`) — closes the faucet without
  freezing what's in flight. Off blocks `setDesire` server-side (not just
  hidden in the UI); an already-`ACTIVE` Desire can still be fulfilled or
  cancelled, and `setDesireGm`/`endDesireGm` on the Dev Panel are unaffected
  (host access, not game permission). `/character` greys the "set a new
  Desire" form and shows "Temporary disabled." in its place.
- **`desireSlots`** (default 2) — how many Desires a character may hold
  `ACTIVE` at once, one per slot. See §1.
- **`maxDrawbackTags`** (default 5) — **not** a Desires-system knob itself,
  but the field the three new groups' drawbacks (Addictions, Restrictions)
  count against at character creation. It caps the *count* of point-bought
  drawback tags, not their combined point value — see `TAGS.md` §4a for the
  full rule and why this replaced the old points-based `maxNegativeTags`.

## 10. YAML format, sync behavior, run order

`docs/desires.yaml` is the sole master for `DesireTemplate`, same posture as
`docs/tags.yaml`: hand-edited, upsert-by-slug. Two top-level keys:

```yaml
families:
  - key: alcohol
    name: Alcohol
    # comment describing what belongs here

desires:
  - slug: drink-alcohol
    name: Drink alcohol
    tier: 1
    families: [alcohol]
    requires:                    # optional
      anyTags: [dancer]
      anyRoles: [minstrel, diplomat]
      notTags: [...]
      notRoles: [...]
    cooldownTurns: 5              # optional, overrides tier as cooldown length
    oncePerLife: true             # optional; forced true at tier 7 unless set false
    description: "..."            # optional
```

`families:` is the fixed vocabulary every entry's `families` list draws
from — nothing writes to it dynamically, and referencing an undeclared key
throws at sync time. `{tag:slug}` references inside a Desire's `name` are
checked against `docs/tags.yaml` the same way any other `{tag:…}` reference
is.

**Sync behavior — soft-retire, not upsert-only.** `db:sync-desires`
(`db/lib/syncDesires.js`, run via `npm run db:sync-desires` or automatically
inside the Restart Game wipe) differs from `db:sync-tags` here: a slug
present in the DB but absent from the file gets `retired: true` (hidden from
every picker, existing `Desire` rows referencing it keep running normally),
and a slug that comes back has `retired` cleared. `DesireTemplate` is pure
catalog with a cheap hide, not held state like a `Tag`, so there's no
`db:prune-desires` counterpart — nothing to prune, since nothing is ever
deleted.

Four passes, no writes until pass 0 validates everything (every unknown
`{tag:…}`/role/family reference throws before pass 1 touches the DB):

0. Parse + validate.
1. Upsert scalars (name, tier, families, `onceEver`, `cooldownTurns`,
   `sortOrder`), diffing arrays via `JSON.stringify`.
2. Resolve `requiresAnyTags`/`requiresNotTags` (m2m `set:`) and
   `requiresAnyRoleSlugs`/`requiresNotRoleSlugs` (plain slug arrays, same
   posture as `Document.roleSlugs` — a Role FK would block `db:prune-tags`-
   style pruning that never actually happens to roles here, but the
   reasoning is inherited from that convention).
3. Soft retire: DB slug absent from the file → `retired: true`; present →
   cleared.

**Run order: zones → tags → roles → desires → documents.** Desires sync
after roles because `requires.anyRoles`/`notRoles` validate against the Role
catalog, and before documents for no particular dependency but to keep the
whole chain in one linear pass (`web/app/(app)/gm/dev/actions.js`'s Restart
Game step list; see `SYNC.md` §1 and §3).

## 11. File map

| File | Role |
|---|---|
| `docs/desires.yaml` | Sole master for the `DesireTemplate` catalog — families header + desire entries |
| `db/lib/syncDesires.js` | `docs/desires.yaml` → DB. Four-pass soft-retire sync, `npm run db:sync-desires` / `db/prisma/sync-desires.js` |
| `db/lib/desireFamilies.js` | Reads only the `families:` header, for `db/lib/syncTags.js` to validate a tag's `desires.locks` families against — tolerates a missing `desires.yaml` |
| `db/lib/desireShapes.js` | Normalizes/validates `Tag.desires.locks` (the clause grammar in §3) — shared by `syncTags.js` and, eventually, a GM tag-form editor |
| `db/lib/desireGates.js` | Pure gate evaluator, no DB. `evaluateDesireCatalog` (visible/hidden catalog per character) and `slotStates` (per-slot occupancy + lock) |
| `web/lib/desireProjection.js` | `projectDesireTemplateForGates` — the one path that resolves a `DesireTemplate`'s role-slug arrays into `{ slug, name }` for `desireGates.js`; every caller must go through it |
| `web/app/components/DesireCatalog.js` | Player-facing catalog picker modal — the family-grouped `<select>`, state pills, "Set desire" |
| `web/app/components/DesirePanel.js` | Player-facing panel chrome — per-slot rows, cancel/fulfil dialogs, opens `DesireCatalog` |
| `web/app/components/GoalsPanel.js` | Mounts `DesirePanel` on `/character` |
| `web/app/(app)/gm/dev/characters/[characterId]/GoalsTab.js` | GM Dev Panel surface — per-slot catalog/free-text set form, Fulfil/Cancel, cooldown + past-desire readouts |
| `web/app/(app)/gm/dev/characters/[characterId]/actions.js` | `setDesireGm`/`endDesireGm` — gates bypassed, same-transaction slot-cancel-then-create |
| `web/app/(app)/character/requestActions.js` | Player-facing `setDesire`/`cancelDesire`/`fulfillDesireRequest` — gates enforced via `evaluateDesireCatalog`/`slotStates`, in-tx re-validated |
| `db/prisma/backfill-desires.js` | One-off: moves live holdings off six retired-in-place drawback tags onto their catalog-era replacements; `npm run db:backfill-desires` |
