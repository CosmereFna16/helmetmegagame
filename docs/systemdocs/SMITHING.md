# Smithing

This is the canonical tier ladder for weapons and armor. Price a new combat
item off this table, not by feel. If you change a number here, also change
the price-scale comment at the top of the weapons block in `docs/tags.yaml`
and the mention in [`TAGS.md`](TAGS.md) §4a.

Changing `Turns` here also changes what a merchant pays for the finished item —
[`DEPOT.md`](DEPOT.md) §4 derives the Merchant's sell price from this table's
`⬢` and `Turns` columns plus the skill gate, not by feel either.

## 1. Skills

| Slug | Name | pt | Gate |
|---|---|---|---|
| `crafting` | Crafting | 5 | none |
| `smithing` | Smithing | 5 | none |
| `smithing-skilled` | Smithing (Skilled) | 5 | `parentTag: smithing` (cumulative, total 10) |
| `smithing-gunpowder` | Smithing (Gunpowder) | 9 | `requiredTag: smithing-skilled` |

A full gunsmith is `smithing` + `smithing-skilled` + `smithing-gunpowder` =
5 + 5 + 9 = **19 pt**.

## 2. Tiers

Materials cost (the ⬢ column) was cut ~15% across the ladder as a rebalance
pass. Dead Simple's 3 ⬢ is unchanged — 15% off 3 rounds back to 3 — every
other rung actually moved. `pt`, `Turns`, and every gate are untouched.

| Tier | pt | ⬢ | Turns | Skill gate | Combat gate | Purchasable at start |
|---|---|---|---|---|---|---|
| Dead Simple | 2 | 3 | 0 | `crafting` OR `smithing` | none | yes |
| Simple | 5 | 6 | 1 | `smithing` | `melee-basic` / `ranged-basic` | yes |
| Moderate | 7 | 14 | 1 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| High Quality | 9 | 26 | 2 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Exceptional | 14 | 34 | 3 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Gunpowder | 14 | 31 | 2 | `smithing-gunpowder` | `ranged-basic` | yes |

Bows use `crafting` in place of `smithing` at every tier. The Crossbow does
not — its steel prod and lock are `smithing-skilled` work.

**The two gate columns mean different things and are enforced on different
surfaces.** The Skill gate is what it takes to *make* the item; the Combat
gate is what it takes to *use* it. Character creation and `/store` enforce
the Combat gate (`requiredTag`) — you can't buy a Crossbow at creation
without Ranged (Basic). The **Craft menu enforces the Skill gate, not the
Combat gate** (`db/lib/medicalVision.js#satisfiedSkillIds`,
[`CRAFTING.md`](CRAFTING.md) §2, [`TAGS.md`](TAGS.md) §3b): the picker's "To
make: …" line shows the Skill gate as a requirement, checked server-side, not
just guidance. Nothing checks the Combat gate at craft time, so a smith with
`Smithing (Skilled)` and no `Melee (Basic)` can still forge a sword they
can't swing; a fighter pulling a sword from their clan's armoury still files
the same request with the fiction as their justification — that half of the
honor system stands, it's just the Skill half that's now enforced.

## 2a. Workshop Equipment

**Smithing and building need a forge, where smith's work is unavoidable.** A
recipe requires **Workshop Equipment** in reach — held, sitting in a Room
stash you can get into at your Location, or served by a **COMPLETE** structure
whose `placement.provides` lists `workshop-equipment` (`db/lib/equipmentReach.js`,
the same predicate the private-room threads are synced with) — held kit, room
stash, or standing forge are the three reaches, and a Forge serves everyone
standing at its Location permanently, no hauling and no door. A `DAMAGED`
forge serves nobody — the same `COMPLETE`-only reading `structureTools` uses
for laboring tools (`LABORING.md` §5). All of this applies when the recipe
names a `smithing-*` or `builder-*` skill **and does not offer `crafting`**. A
recipe whose type carries `placement.fieldwork: true` — a light field
structure — skips the workshop rule entirely.

That second half matters. Every Dead Simple recipe lists
`skills: [crafting, smithing]`, and the `crafting` half is what says a work
knife or a sling is something you can whittle. So the whole Dead Simple rung
stays anvil-free, and what is gated is the real forge work: 32 recipes today —
every Simple rung and up, plus the Cart and the Plow.

The rule is read off the recipe's own skills rather than a per-tag flag, so a
new sword is gated the moment it names a smithing skill and nobody has to
remember a second field. `needsWorkshop()` in `web/lib/tagRequests.js` is the
one copy, shared by the Craft dialog and `craftRequestImpl`.

`workshop-equipment` is itself a **High Quality** craftable — 9 pt, 26 ⬢, 2
turns, `smithing-skilled` — and **Immense (100 lb)**, so it is a real decision
to move one. It is the one recipe **exempt from its own gate**, and has to be:
gating it would mean nobody could ever build the first forge. You raise that
one in the open, and it is what lets you do the finer work after.

It replaced the old `workshop` **Asset**, which was 2 pt, creation-only, and
gated nothing — its own description admitted "You don't need this to craft".

Crafting is always filed as a Routine now, never a Gambit — the Craft button
(the old Add Tag) enforces a recipe's skills server-side, and Dead Simple
recipes still need no Move at all, just the per-turn unit cap below
(`CRAFTING.md`).

A recipe may also set **`requirement.perTurn`**, its own ration, counted per
recipe rather than against the shared Dead Simple pool below. Only meaningful
at `turnsCost: 0` — anything costing a Move is already rationed to one by the
turn's single Action.

**Dead Simple is capped at 4 items per character per turn.** It is the only
rung that costs 0 turns, so nothing else rations it. The cap counts *units*,
not requests — these tags are stackable and one Add Tag request can carry any
quantity — and it is summed across every Add Tag request filed in the open
turn. Enforced in `addTagRequestImpl`; the constant is
`DEAD_SIMPLE_PER_TURN` in `web/lib/requests.js`, which also holds
`isDeadSimple()` — the tier has no column of its own, so it is recognised as
"0 turns of work plus a smithing or crafting skill gate".

The Skill gate itself (a recipe's `requirementSkills`) is an **AND list and is
enforced** — see [`TAGS.md`](TAGS.md) §3b. The rung splits by material:
`crafting` for the wood-and-cord items, `smithing` for the metal ones, which
puts the metal half behind a forge.

Every combat item is `purchasable: true, purchasableAfterStart: false` — buy
at creation or have someone craft one in play. Found-only items
(`purchasable: false`) sit outside the ladder — a craftable gated behind a
hidden-category skill (§3a of `TAGS.md`, or a future one like it) works the
same way: it's priced on its own terms, not a rung of this table. The Cult
of Bacchus's `smithing-bacchus` craftables (Nailgun, Armor Robes, Nails of
Life) used to be the example; they're archived in
`docs/archive/bacchus.yaml`.

## 3. Weapons

| Weapon | Tier | Notes |
|---|---|---|
| Cudgel | Dead Simple | `smithing` |
| Work Knife | Dead Simple | `smithing` |
| Hatchet | Dead Simple | `smithing` |
| Truncheon | — | Not craftable at all, by design. Cerberi and Order issue. |
| Sling | Dead Simple | `crafting` |
| Quarterstaff | Dead Simple | `crafting` |
| Pitchfork | Dead Simple | `smithing`. Carries the farming `laborBonus`, moved off the Hatchet. |
| Shortbow | Dead Simple | `crafting` |
| Spear | Simple | |
| Dagger | Simple | |
| Silver Knife | Simple | |
| Gladius | Simple | |
| Phrygian Spear | Simple | |
| Longbow | Simple | `crafting` |
| Mace | Simple | |
| Battle Axe | Simple | |
| Knuckle Duster | Moderate | `visible: worn` — pocketable. Priced at 5 pt, not the tier's 7 — a pre-existing outlier, not introduced by the Combat Update. |
| Halberd | Moderate | Renamed from Bardiche in the Combat Update; the slug moved with it. |
| Broadsword | Moderate | |
| War Hammer | Moderate | |
| Bastard Sword | High Quality | |
| Rapier | High Quality | |
| Sabre | High Quality | |
| Katana | High Quality | |
| Silver Spear | High Quality | |
| Lucerne | High Quality | |
| Zweihander | High Quality | |
| Crossbow | High Quality | |
| Musketoon | Gunpowder | Priced at 18 pt, not the tier's 14 — a pre-existing outlier, not introduced by the Combat Update. |
| Bore Pistol | Gunpowder | Materials cost 20 ⬢, not the tier's 31 — a pre-existing outlier, not introduced by the Combat Update. Priced accordingly in `DEPOT.md` §4. |
| Bomb | Gunpowder | `purchasable: false` (craft-only) |

Off the ladder — no recipe, no smithing gate:

| Weapon | pt | Notes |
|---|---|---|
| Sword Cane | 7 | Sold complete. `visible: worn` — it reads as a cane until it's drawn. |
| Neoclassic R&W10 | 14 | Bought at creation only — not craftable. Requires `ranged-basic`. |
| Cracked Bone Club | 0 | Found only. |
| Neoclassic Duelista | 0 | Found only. |
| Disabler | 0 | Cerberon-issued. |

### The Plow

Not a weapon, but it is smith work: `plow`, 5 points, `turnsCost: 1`,
`resourceCost: 10`, `skills: [smithing]`. It is an **Asset**, not an Item, so
it never weighs on your back — it lives in your shed and the horse does the
hauling. It is the one Laboring tool that needs no equipping and the only one
gated on holding something else — without a `horse` it does nothing at all. Worth +4 ⬢ to Farming, the largest single tool
bonus in the game, because two tags and a smith stand behind it
(`LABORING.md` §5).

## 4. Armor

| Armor | Tier | Notes |
|---|---|---|
| Padded Armor | Dead Simple | `crafting` |
| Padded Cap | Dead Simple | `crafting` |
| Buckler | Dead Simple | |
| Simple Helm | Simple | |
| Mail Coif | Simple | |
| Shield | Simple | `crafting` |
| Pavise | Simple | `crafting` |
| Mail Shirt | Moderate | |
| Gladiator Helmet | Moderate | Also on the Merchant's shelf at 45 ⬢ (`DEPOT.md`). Optional conceal. |
| Knight's Helmet | High Quality | Force conceal — a closed helm is not a face (`PROXYING.md` §5). |
| Censor's Helmet | High Quality | Force conceal |
| Brigandine | High Quality | `visible: worn` — plates inside a coat, so it shows only while worn. |
| Breastplate | High Quality | |
| Plate Armor | Exceptional | |

Off the ladder:

| Armor | pt | Notes |
|---|---|---|
| Salvage Plate | 2 | No skill gate. |
| Energy Shield | 0 | GM-granted only. |
