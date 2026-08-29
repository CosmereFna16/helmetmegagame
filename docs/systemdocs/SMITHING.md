# Smithing

This is the canonical tier ladder for weapons and armor. Price a new combat
item off this table, not by feel. If you change a number here, also change
the price-scale comment at the top of the weapons block in `docs/tags.yaml`
and the mention in [`TAGS.md`](TAGS.md) §4a.

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

| Tier | pt | ⬢ | Turns | Skill gate | Combat gate | Purchasable at start |
|---|---|---|---|---|---|---|
| Dead Simple | 2 | 3 | 0 | `crafting` OR `smithing` | none | yes |
| Simple | 5 | 7 | 1 | `smithing` | `melee-basic` / `ranged-basic` | yes |
| Moderate | 7 | 17 | 1 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| High Quality | 9 | 23 | 1 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Exceptional | 14 | 32 | 2 | `smithing-skilled` | `melee-basic` / `ranged-basic` | yes |
| Gunpowder | 14 | 37 | 2 | `smithing-gunpowder` | `ranged-basic` | yes |

Bows use `crafting` in place of `smithing` at every tier. The Crossbow does
not — its steel prod and lock are `smithing-skilled` work.

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
| Knuckle Duster | Moderate | `visible: false`. Priced at 5 pt, not the tier's 7 — a pre-existing outlier, not introduced by the Combat Update. |
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
| Bore Pistol | Gunpowder | |
| Bomb | Gunpowder | `purchasable: false` (craft-only) |

Off the ladder — no recipe, no smithing gate:

| Weapon | pt | Notes |
|---|---|---|
| Sword Cane | 7 | Sold complete. `visible: false`. |
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
| Brigandine | High Quality | `visible: false` — concealed. |
| Breastplate | High Quality | |
| Plate Armor | Exceptional | |

Off the ladder:

| Armor | pt | Notes |
|---|---|---|
| Salvage Plate | 2 | No skill gate. |
| Energy Shield | 0 | GM-granted only. |
