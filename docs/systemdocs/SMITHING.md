# Smithing

This is the canonical tier ladder for weapons and armor. Price a new combat
item off this table, not by feel. If you change a number here, also change
the price-scale comment at the top of the weapons block in `docs/tags.yaml`
and the mention in [`TAGS.md`](TAGS.md) §4a.

## 1. Skills

| Slug | Name | pt | Gate |
|---|---|---|---|
| `crafting` | Crafting | 2 | none |
| `smithing` | Smithing | 2 | none |
| `smithing-skilled` | Smithing (Skilled) | 2 | `parentTag: smithing` (cumulative, total 4) |
| `smithing-gunpowder` | Smithing (Gunpowder) | 4 | `requiredTag: smithing-skilled` |

A full gunsmith is `smithing` + `smithing-skilled` + `smithing-gunpowder` =
2 + 2 + 4 = **8 pt**.

## 2. Tiers

| Tier | pt | ⬢ | Turns | Skill gate | Fighting gate | Purchasable at start |
|---|---|---|---|---|---|---|
| Dead Simple | 1 | 3 | 0 | `crafting` OR `smithing` | none | yes |
| Simple | 2 | 8 | 1 | `smithing` | `fighting-basic` | yes |
| Moderate | 3 | 18 | 1 | `smithing-skilled` | `fighting-basic` | yes |
| High Quality | 4 | 25 | 1 | `smithing-skilled` | `fighting-basic` | yes |
| Exceptional | 6 | 35 | 2 | `smithing-skilled` | `fighting-basic` | yes |
| Gunpowder | 6 | 40 | 2 | `smithing-gunpowder` | `fighting-basic` | yes |

Bows and crossbows use `crafting` in place of `smithing` at every tier.

Every combat item is `purchasable: true, purchasableAfterStart: false` — buy
at creation or have someone craft one in play. Found-only items
(`purchasable: false`) sit outside the ladder.

## 3. Weapons

| Weapon | Tier | Notes |
|---|---|---|
| Knuckle Duster | Dead Simple | `visible: false` |
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
| Crossbow | High Quality | `crafting` |
| Musketoon | Gunpowder | |
| Bore Pistol | Gunpowder | |
| Bomb | Gunpowder | `purchasable: false` (craft-only) |
| Neoclassic R&W10 (slug `old-45-revolver`) | Gunpowder | |

Off the ladder — no recipe, no smithing gate:

| Weapon | pt | Notes |
|---|---|---|
| Sword Cane | 3 | Sold complete. `visible: false`. |
| Cracked Bone Club | 0 | Found only. |
| Neoclassic Duelista | 0 | Found only. |
| Disabler | 0 | Watch-issued. |

## 4. Armor

| Armor | Tier | Notes |
|---|---|---|
| Padded Armor | Dead Simple | `crafting` |
| Simple Helm | Dead Simple | |
| Mail Coif | Dead Simple | |
| Buckler | Dead Simple | |
| Shield | Simple | `crafting` |
| Pavise | Simple | `crafting` |
| Mail Shirt | Moderate | |
| Knight's Helmet | Moderate | |
| Brigandine | High Quality | `visible: false` — concealed. |
| Breastplate | High Quality | |
| Plate Armor | Exceptional | |

Off the ladder:

| Armor | pt | Notes |
|---|---|---|
| Salvage Plate | 1 | No skill gate. |
| Energy Shield | 0 | GM-granted only. |
