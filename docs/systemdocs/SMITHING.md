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
without Ranged (Basic). The **Add Tag menu enforces neither** — it's the
honor-system door (`addRequirementSatisfied()`, `web/lib/tagRequests.js`,
[`TAGS.md`](TAGS.md) §3b): the picker's "To make: …" line shows the Skill
gate as guidance, and the GM reviewing the pushed request holds players to
it. A smith with `Smithing (Skilled)` and no `Melee (Basic)` can forge a
sword they can't swing; a fighter pulling a sword from their clan's armoury
files the same request with the fiction as their justification.

**Dead Simple is capped at 4 items per character per turn.** It is the only
rung that costs 0 turns, so nothing else rations it. The cap counts *units*,
not requests — these tags are stackable and one Add Tag request can carry any
quantity — and it is summed across every Add Tag request filed in the open
turn. Enforced in `addTagRequestImpl`; the constant is
`DEAD_SIMPLE_PER_TURN` in `web/lib/requests.js`, which also holds
`isDeadSimple()` — the tier has no column of its own, so it is recognised as
"0 turns of work plus a smithing or crafting skill gate". The Skill gate
itself (a recipe's `requirementSkills`) is an **OR list** — `crafting` OR
`smithing` on Dead Simple items — shown to the player, not enforced
([`TAGS.md`](TAGS.md) §3b).

Every combat item is `purchasable: true, purchasableAfterStart: false` — buy
at creation or have someone craft one in play. Found-only items
(`purchasable: false`) sit outside the ladder — as do the Bacchus craftables
(Nailgun, Armor Robes, Nails of Life), gated by the cult's own
`smithing-bacchus` skill rather than `smithing`/`smithing-skilled`, priced on
their own terms rather than a rung of this table.

## 3. Weapons

| Weapon | Tier | Notes |
|---|---|---|
| Cudgel | Dead Simple | |
| Work Knife | Dead Simple | |
| Hatchet | Dead Simple | |
| Sling | Dead Simple | |
| Quarterstaff | Dead Simple | |
| Pitchfork | Dead Simple | |
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
| Halberd (slug `bardiche`) | Moderate | Renamed in the Combat Update; slug frozen for sync. |
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
| Neoclassic R&W10 (slug `old-45-revolver`) | 14 | Bought at creation only — not craftable. Requires `ranged-basic`. |
| Cracked Bone Club | 0 | Found only. |
| Neoclassic Duelista | 0 | Found only. |
| Disabler | 0 | Watch-issued. |

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
| Knight's Helmet | High Quality | |
| Brigandine | High Quality | `visible: worn` — plates inside a coat, so it shows only while worn. |
| Breastplate | High Quality | |
| Plate Armor | Exceptional | |

Off the ladder:

| Armor | pt | Notes |
|---|---|---|
| Salvage Plate | 2 | No skill gate. |
| Energy Shield | 0 | GM-granted only. |
