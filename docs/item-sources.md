# Item sources

Mined item lists from the SS13 codebases Bascinet descends from, plus a few
tabletop tables, kept as raw material for new tags. Nothing here is a rule —
it is a shopping list. Pricing and format for anything you build from it live
in [`tag-design.md`](tag-design.md) and
[`systemdocs/TAGS.md`](systemdocs/TAGS.md) §4a.

Everything below is transcribed from source, verbatim.

## Why this file exists

The item catalog is lopsided. Of 357 tags in `docs/tags.yaml`:

| Group | Count | State |
|---|---|---|
| `items-weapons` | 35 | full — `SMITHING.md` §3 is canonical |
| `items-drink` | 30 | full — `BREWING.md` §2/§3 |
| `items-armor` | 13 | full — `SMITHING.md` §4 |
| `items-special` | 13 | exotic shelf, room to grow |
| `items-gear` | 14 | **thin** |
| `assets-property` | 5 | **thin** |
| `assets-companions` | 4 | **thin** |
| `items-food` | 2 | **near-empty** |

Nothing covers: light sources, rope and climbing kit, containers, writing and
forgery kit, instruments, books, religious and occult objects, medical bags,
navigation, mining and fishing tools, foul-weather gear, prosthetics.

There is also a live hole this feeds. The **Merchant** role
(`docs/roles.yaml:1318`) exists to buy and sell tags out of a Supply Depot in
Customs, and his document (`docs/documents.yaml:374`) is an empty stub —
`description: ""`, `tags: []`.

## The lineage

**Lifeweb SS13's source was never public.** No repo survives; the community
record describes it as closed-source and invite-only. What carries its design
forward is the descendant line:

> Lifeweb → RogueTown → Vanderlin / Azure Peak / Ratwood

But Lifeweb's **wiki** survives, and it has the merchant stock list.

| Source | State | Value |
|---|---|---|
| [lif3web.fandom.com](https://lif3web.fandom.com/wiki/Obol) | live (402s on direct fetch; readable via `r.jina.ai` proxy) | **the actual Lifeweb merchant stock, with prices**, plus the alchemy recipes |
| [Azure-Peak/Azure-Peak](https://github.com/Azure-Peak/Azure-Peak) | live | **richest structured merchant tree** — one file per department |
| [Rotwood-Vale/Ratwood-2.0](https://github.com/Rotwood-Vale/Ratwood-2.0) | live | same item data as Azure Peak, byte-identical in places |
| [Monkestation/Vanderlin](https://github.com/Monkestation/Vanderlin) | live, maintained | trader framework, relics, mage items, carved gems, books |
| [SS13-Special-Codebases-Archive/RogueTown](https://github.com/SS13-Special-Codebases-Archive/RogueTown) | archived | direct Lifeweb successor; gems |
| [tgstation/tgstation](https://github.com/tgstation/tgstation) | live | uplink + cargo + spellbook |
| [SS13-Source-Archive/Farweb](https://github.com/SS13-Source-Archive/Farweb) | archived | **false lead** — its `lifeweb.dm` is an unrelated altar module; descends from Luna, not Lifeweb |

Three confirmations that these are the right wells — the catalog has drawn
from them already:

- The Lifeweb merchant sells a **Neoclassic R&W10 Revolver** and a
  **Flamethrower**. Both are tags (`old-45-revolver`, `flamethrower`).
- Lifeweb's alchemy page lists **Cain's Forgiveness** and **Potion of Flawless
  Skin**. Both are tags (`forgiveness`, `flawless-skin`).
- tg's uplink sells **Holoparasites** and a **Power Fist**. Both are tags
  (`holoparasite`, `power-fist`).

---

## 1. Lifeweb SS13 — the merchant's stock

`https://lif3web.fandom.com/wiki/Obol`. Currency is **obols**: copper base,
4 copper = 1 silver, 4 silver = 1 gold.

**Firearms & ammunition** — ML-23 9mm ammo 80 · Neoclassic R&W10 Revolver 60 ·
Shotgun 300 · Legax Gravpulser Gun 300 · Stunner/Tazer 100 · Flamethrower
1000 (*"Fires every time it is dropped or placed"*) · Weapon Crate 110 (2
revolvers, 2 bronze knuckles, 2 switchblades, 5 bullets) · Combat Syringe Gun
100 · Ammo Big Box 60 · Ammo Small Box 40

**Protective gear** — Light Infantry Armour 500 · Hazardous Material Suit &
Gear 90

**Tools & equipment** — Camera 40 · Alchemy Tools 300 · Boombox 88 · Surgical
Tools with Surgical Laser & Wrench 35 (*"Saw NOT INCLUDED"*) · Sheath 8x &
Quivers 3x 15 · Poison Snooper 15

**Consumables & supplies** — Shroomwood 20x 100 · Camouflage Generators 4x 80 ·
Maulet P2R Energy Pistol 3x 80 (*"no batteries"*) · Eggs, 3 packs of 12 40 ·
Syringes 10x 10 · Paper, 6 packs of 6 20 · Pig 60 · Bags 4x & Coin Bags 4x 60 ·
Sweets 8x 120 · Surgical Needles 6x 45 · Seeds 10x 25 · Cannabis Seeds 2x 40 ·
Embalming Fluid 15 · Iron Ore 8x 40 · Coal Ore 8x 30

**Poisons & drugs** — Poison, 5 units of Technoborg's blood 40 · Soporific
Sleep Drug, AKA *"Jesus's Tears"* 40

**Medical** — Antibiotics 6x 100 · Kalocine ("Disease cure") 6x 60 ·
Immuno-correctors 12x 60 · Overseer's Antidote 3x 10

**Beverages & food** — Expensive Alcohol Crate 12x 110 · Cheap Alcohol Crate
10x 60 · Cigarettes 6x 60 · Butter 4x 20 · Flour 5x 15 · Cheese 5x 20 ·
Salami 5x 30

**Miscellaneous** — Chemical Reagent Packs, 3 variations, 15 each · Battery
Pack 2x 10

### Lifeweb alchemy (`/wiki/Recipes`)

`forgiveness` and `flawless-skin` already came from here; the rest is unmined.

Cave Wine · Scavengers Oil · Grey Honey · Love Potion · Bridge of the True
Faith · **Curiorture** · Voice of Thunder · Smile of the Savior · Flaying
Potion · Sorokoputka · Dream Beauties · Berserker's Sweat · Sparkling Juice ·
Cain's Forgiveness · Rotcleaner · Potion of Impossible Targets · Mushroom
Powder · Potion of Dead Memory · Potion of Flawless Skin

The ingredient vocabulary is worth stealing on its own: Krovnik, Podgnilnik,
Zhelezniak, Bezglaznik, Ovrazhnik, Otorvyannik, Slezyak, Barhovik, Zelegrib,
Korpny, Lyutogrib, Morfyannik, Plump Helmet, and one ingredient literally
named *"Please wake up Trey."*

Also on that page: a chem-synthesis table (aPVP, Dentrine, Polytrinic Acid,
Synaptizine, Immumod, Kelotane, Tricordrazine — made from *Blood of the Mad
God* — Alkysine, Mentats, Gelabine, Widow's Tears, Retorine) and Kalocine
disease-cure variants named **Brainrot, Brown rot, Ataxia, Fever Frenzy, Cave
Plague**.

---

## 2. Azure Peak / Ratwood-2.0 — the full merchant tree

`code/modules/cargo/packsrogue/merchant/`, one file per department. The most
directly usable body of material here, because it is already organised the way
a shop is.

**Adventure Supplies** (`adventure_supplies.dm`) — Bedroll 13 · Waterskin 13 ·
Ropes 3x 10 · Six Foot Pole 6 · Iron Lamptern 15 · Folding Table 35 ·
Alchemical Station Kit 45 · Folding Cauldron 45 · Mess Kit 60 · Needles 3x 15 ·
Ration Wrapping Paper 20 · Roll of Bandages 25 · Small Tent Kit 30 · Ger Kit
75 · Yurt Kit 150 · White Stag Map 190 · Boars Map 50 · Grappling Hook 320

**Tools** (`tools.dm`) — Wooden Spade 5 · Shovel 20 · Hoe 10 · Thresher 10 ·
Sickle 10 · Pitchfork 10 · Scythe 25 · Plough 50 · Handsaw 35 · Hammer 35 ·
Tongs 35 · Armor Plates 60 · Iron Pick 10 · Chisel 10 · Steel Pick 40 ·
Hunting Knife 10 · Iron Scissors 30 · **Surgeon's Bag (Full) 45 / (Empty)
15** · Soap 10 · Herbal Soap 20 · Frying Pan 20 · Iron Pot 12 · **Lockpicks
20** · Chains 15 · Sacks 10 · Keyrings 20 · Iron Head Hook 10 · Papyrus 20 ·
Glass Bottles 15 · Alchemy Bottle 2 (bulk 8) · Pipe 15 · Premium Fishing Bait
15 · **Flint 15** · Bottlin' Kit 50 · Spare Shopkey 10 · **Serfstone 40** ·
**Scomstone 120** · Woodcutters Wheelbrace 25 · Reinforced Wheelbrace 50

**Prosthetics**, same file — Wood Arm (L/R) 40 · Wood Leg (L/R) 15 · Bronze
Prosthetic 60 · Iron Prosthetic 60 · Steel Prosthetic 80.

The sharpest single find. The catalog carries **Missing Arm, Missing Leg, Peg
Leg, Crippled Leg, Missing Fingers** and **Mangled Hand** as health tags, and
has nothing that fits any of them. A four-rung ladder (wood → bronze → iron →
steel) priced off `SMITHING.md` and gated on `smithing` would close that, and
Peg Leg is already the bottom rung in all but name.

**Instruments** (`instruments.dm`) — Music Box 500 · Flute 10 · Harp 20 ·
Guitar 30 · Accordion 30 · Lute 20 · Drum 10 · Hurdy-Gurdy 30 · Viola 30 ·
Vocalist's Talisman 30 · Shamisen 30 · Psyaltery 30

**Livestock** (`livestock.dm`) — Saiga 150 · Chicken 50 · Cow 80 · Goat 80 ·
Cat 50 · Pig (Truffle) 80 · Swine 100 · Hog 100 · Hog (Saddled) 125 · Queen
Bee 80

**Food** (`food.dm`) — Dry Meat 28 · Hardtacks 22 · Raisin Loaf 30 · Egg 20 ·
Coffee Beans 25 · Tea Leaves 25 · Dried Rosa Petals 20 · Pepper Mill 30 ·
Butter 35 · Honey 30 · Spider Honey 40 · Sugar 45 · Allspice 50 · Chocolate
40 · Eel 20 · Carp 40 · Anglerfish 60 · Clownfish 120

**Luxury** (`luxury.dm`) — Ozium 5 · Moon Dust 10 · Spice 30 · Fancy Tea Set
110 · Silver Psycross 250 · Silver Amulet of Astrata / of Ten / of Necra 250
each · Blessed Amulet of Noc 250 · Silver Dagger 250 · **Ring of Null Magic**
300 · **Scrying Orb** 300 · Emerald Choker 250 · Polishing Kit 100 ·
**Talkstone** 100 · Circlet 80 · Gold Ring 70 · Signet 220 · Manabloom Flowers
55 · **Writ of Commendation** 80 · Canvas 30 · Easel 80 · Paint Brush 15 ·
Paint Palette 15 · Paper Parasol 30 · Fine Parasol 65 · Tallowpot 100 · Lump
of Blacktallow 50 · Heel Elixirs 300

**Apparel** (`apparel.dm`, in silver) — Shoulder Hood 40 · Silver Cross 250 ·
god-aligned Amulets (Astratan, Malumite, Eoran, Ravox, Pestran, Necran,
Dendor, Abyssor, Noc, Xylix, Undivided) 10 each · Psicross 20 · Leather
Trousers 60 · Rain Cloak 60 · Shirt 40 · Undershirt 40 · Trousers 40 · Hair
Dye Cream 10 · Merchant Pouch 100 · Satchel variants 13 each · Backpack 18 ·
Pouches 15 · Leather Belts 50 · Sheath 12 · Scabbard 15 · Empty Quiver 20 ·
Empty Bolt Pouch 20 · Empty Shotstake Pouch 20 · Greatweapon Strap 30 · Silver
Plaque Belt 110 · Golden Plaque Belt 130 · Leather Belt 25 · Black Leather
Belt 25

**Potions** (`merchant_potions.dm`) — Rot Cure Potion 300 · Healing 25 · Mana
25 · Stamina 25 · Poison Antidote 25 · Runic Tincture Flask 100 · Strength 90 ·
Perception 75 · Willpower 75 · Constitution 75 · Intelligence 70 · Speed 90 ·
Luck 75 · Bottle Bomb 5x 40

**Gems** (`merchant_gems.dm`) — Amythortz 25 · Toper 55 · Gemerald 67 ·
Saffira 89 · Blortz 130 · Rontz 160 · Diamond/Dorpel 190 · **Riddle of Steel**
500 · Jade 80 · Onyxa 48 · Heartstone 96 · Cerulite 120 · Amber 80 · Opal 128 ·
Rosestone 24. Ships in a "merchant guild's crate."

**Raw materials** (`rawmat.dm`) — Iron Ore 60 · Copper Ore 60 · Tin Ore 80 ·
Coal 100 · Silver Dust 70 · Cloth 60 · Stone 30 · Lumber 30 · Ash 20. (You
already have `saltpeter` as a mined tag; this is the rest of that shelf.)

**Alcohols** (`alcohols.dm`) — 35 named regional drinks, 10–400. Beer-In-A-
Bottle 10 · Zagul Lager 15 · Blackgoat Beer 20 · Ratkept Onin Cognac 20 ·
Hagwood Bitters 25 · Rockhill Toper 20 · Norwandine Red Ale 20 · Elvish
Aurorian Beer 20 · Elvish Fireleaf 25 · Elvish Red Wine 150 · **Valmora Blue
Wine 400** · Dwarvish Butterhairs 35 · Stonebeards Reserve 60 · Ranesheni Wine
15 · Hoftian Sour Wine 25 · Otavan Red 30 · Otavan White 35 · Norwandine
Voddena 25 · Stoutenson Sazdistal 30 · Jagdtrunk Herbal Schnapps 80 ·
Apfelweinheim Cider 30 · Etruscan Limoncello 60 · Shieldmaiden Mead 25 ·
Zögiin Bal Mead 20 · Makkolir Rice Wine 30 · Bökhiin Milk-Arkhi 100 ·
Yamaguchi Pale Lager 20 · Umeshu Plum Wine 40 · Junmai-ginjo 150 · Shochu 150 ·
Huangjiu 20 · Baijiu 50 · Yaojiu 150 · Shejiu Snake Wine 150 · Divine Snake
Wine 250

**Seeds** (`seeds.dm`) — 3 each: Spelt, Maize, Apple, Westleach, Jacksberry,
Onion, Cabbage, Potato, Poppy, Coffee, Tea, Sugarcane, Rocknut, Oats, Rice,
Pear, Tomato, Turnip, Sunflower, Garlick, Pumpkin, Carrot, Eggplant, Cucumber.
5: Raspberry, Blackberry, Strawberry. 6: Lemon, Lime, Tangerine, Plum. 8:
Swampweed.

Not pulled: `wardrobe.dm`, `zadpack.dm`, and the armor/weapon files — skipped
deliberately, those ladders are already full.

---

## 3. Vanderlin — traders, relics, mage items

### Trader framework

`code/datums/world_factions/traders/`. Currency is zennies; stock is written
`path = list(buy, sell, qty)`. Thirteen generic archetypes exist, but **only
Luxury and Seedsman carry any sell stock** — the other eleven (Food, Clothier,
Tool, Alchemical, Material, Arms Dealer, Beast Trader, Minstrel, Scholar,
Healer, Curiosity Dealer, Instrument, Livestock) are buy-side only, defined
purely by what raw material they *want*. That structure is itself a usable
idea: a merchant who pays for fibre, hides, ash, feathers and gems.

The real inventories sit in the specialty files:

**Artifact trader** — named legendary weapons; buys gold ore and gems.
*"These weapons carry the souls of ancient warriors. Choose carefully."*

| Item | Gold |
|---|---|
| Peasant War Flail (Matthios) | 3000 |
| Long Martyr Sword | 3000 |
| Steel Double-Head Greataxe (Graggar) | 3000 |
| Psydonian Wooden Staff | 1000 |
| Gorefeast Woodcutter Bardiche | 6000 |
| Neant Polearm | 6000 |
| Turbulenta Bow | 6000 |
| Pleonexia Long Sword | 6000 |
| Psycenser Lantern | 500 |

**Sake merchant** — Huangjiu 3/25/3 · Baijiu 4/35/2 · Yaojiu 5/45/2 · Shejiu
6/50/1 · Murkwine 4/30/2 · **Nocshine** 7/60/1 · Whipwine 5/40/2 ·
Komuchisake 8/75/1. *"Rice wine aged in the shadow of cherry blossoms!"*

**Eastern Blades** — Mulyeog Katana 3/45/3 (Rumahench 4/65/2, Rumacaptain
6/120/1) · Hook Sabre 5/85/2 · Naginata 6/90/2 · Navaja Dagger 6/75/1 ·
Nagaika Whip 5/60/2. *"Steel folded a thousand times under the light of the
eastern moon!"*

**Luxury** — fancy teacup 5/10/6, fancy teapot 5/40/1.
**Seedsman** — ancient wheat 4/15/1, tea 4/19/3, coffee 4/22/5, queen bee
11/50/2.

### Inquisition relics (`code/game/objects/items/inquisition_relics.dm`)

The best-written material in the dig.

- **oratorium reliquary** — *"A foreboding red chest with an intricate lock
  design. It seems to only fit a very specific key. Choose wisely."*
- **Reliquary Key** — *"The single use key with which to unleash woe. Choose
  wisely."*
- **Censer of Penitence** — *"A device filled with bubbling silver. Its
  unstable state is dangerous to those who do not know its true nature, but to
  wield it is great honour for Psydon."*
- **INDEXER** — *"A blessed ampoule with a retractable bladetip, intended to
  further information gathering through hematology. Siphon blood from an
  individual until the INDEXER clicks shut…"*
- **tallowpot** — *"A small metal pot meant for holding waxes or melted
  redtallow. Convenient for coating signet rings and making an imprint…"*
- **inquiry cordage** — *"A length of thick leather inquiry cordage that has
  been dipped in both holy water and dye before being consecrated and
  spell-laced…"*
- **seizing garrote** — *"A macabre instrument favored by the more clandestine
  of the Psydonian Silver Order…"*
- **profane razor** — *"A thin strand of phantom black wire strung between
  steel grasps. Cold to the touch even through gloves…"*
- **black bag** — *"A heavily spell-weaved padded sack intended to muffle the
  cries made within it…"*
- **black mirror** — *"A mass-produced relic of the Oratorium Throni Vacui…"*
- **melancholic crankbox** — *"A relic from the bowels of the Oratorium's
  thaumaturgical workshops…"*
- otavan nocshade eyepiece

### Mage items (`mageitems.dm`)

- **void lamptern** — *"An old lamptern that seems darker and darker the
  longer you look at it."*
- **sending stone** — *"One of a pair of sending stones."*
- **mimic trinket** — *"A small mimic, imbued with the arcyne to make it
  docile. It can transform into most things it touches."*
- **temporal hourglass** — *"An arcyne infused hourglass that glows with
  magick."*
- **shimmering lens** — *"…Looking through it gives you a bit of a headache."*
- **Voidstone** — *"A piece of blackstone, it feels off to stare at it for
  long."*
- **leyline shards** — *"A shard of a fractured leyline, it glows with lost
  power."*
- **runed artifact** — *"An old stone from age long ago, marked with glowing
  sigils."*
- **amythortz** — *"A pink crystal, it surges with magical energy, yet its
  artificial nature means it's worth little."*
- **arcanic aberation** — *"…It pulses erratically, power coiled tightly
  within and dangerous. Many would be afraid of going near this, let alone
  holding it."*
- **planar binding shackles** — *"…imbued to bind other-planar creatures'
  intelligence to this plane. They will not be under your thrall and a deal
  will need to be made."*
- **ley linker**, **mana bloom**, **obsidian fragment**, **stick of chalk**
  (*"possibly made from quicksilver"*), **summoners pouch**, **infernal
  feather**, **soul** (*"The soul of the dead"*)

A nice escalating series: arcanic meld → dense arcanic meld → sorcerous weave
→ magical confluence → arcanic aberation.

### Materials (`natural.dm`)

- **infernal ash** — *"Ash burnt and burnt once again. Smells of brimstone and
  hellfire. Still has embers within."*
- **hellhound fang** — *"A sharp fang that glows bright red, no matter how long
  it's left to cool."*
- **molten core** — *"A molten orb of rock and magick. It gives off waves of
  magical heat and energy."*
- **abyssal flame** — *"A flickering, black flame contained in a crystal; the
  heart of an archfiend. Or, at least, what passes for one."*
- **heartwood core** — *"A piece of enchanted wood imbued with the dryad's
  essence. Merely holding it transports one's mind to ancient times."*
- **sylvan essence** — *"A swirling, multicolored liquid emitting a dizzying
  array of lights."*
- **voidstone** — *"An incredibly rare substance torn from creatures immune to
  magick. This material forsakes Noc's gifts."*
- **iridescent scales**, **fairy dust**, **elemental mote/shard/fragment/relic**
- **generic clod** — *"A handful of nothing."*

### Books (`books.dm`)

You have a `literate` tag and no books. Best of the named titles: *Soup de
Rattus* (*"Weathered book containing advice on surviving a famine."*) ·
*Manners of Gentlemen* (*"A popular guide for young people of genteel
birth."*) · *Dont be a gaff, the guild masters manual* (*"The author page has
rotted off with time."*) · *A hundred kinds of stitches* · *Ye olde ways of
cookinge* (*"Penned by Svend Fatbeard, butler in the fourth generation"*) ·
*The Secrets of the Agronome* (*"Soilson bible."*) · *Necra's Vow of Silence*
(*"A faded page, with seemingly no author."*) · *God of Dreams & Nightmares*
(*"An old decrepit book, with seemingly no author."*) · *Reading for Robbers* ·
*Legend of the Nitebeast* · *Studie of the Etheral Foge phenomenon* · *Latent
Magicks, where does Arcyne Power come from?* · *Fontaine's Advanced Guide to
Fishery* · *Burial Rites for Necra* · *The Six Follies: How To Survive by the
Sword*

`literary.dm` also has **textbooks** in six tiers (novice → legendary) that
train reading — *"The higher the complexity, the more skilled the reader must
be to study it."* A ready-made shape for an item that advances a skill chain.

### Tools and small things

**chisel** — *"Hold it in one hand with a mallet or stone in the other."* ·
**steel pick** — *"With a reinforced handle and sturdy shaft, this is a
superior tool for delving in the darkness."* · **stone pick** — *"Stone versus
sharp stone, who wins?"* · **clockwork drill** — *"A wonderfully complex work
of engineering capable of shredding walls in seconds as opposed to hours."* ·
**winding sheet** — *"A sheet used to drag bodies easier and shield them from
the elements."* · **necran battle shovel** — *"…granted for the completion of
a gravetender's final initiation rites, for the wielder of this shovel shall
rise no more, and with it in hand, neither shall their quarry."*

**lockpick ring** — *"A piece of bent wire to store lockpicking tools. Too
bulky for fine work."* · **purifying waterskin** — *"Bronze tubes spiral about
from the mouth of this waterskin in complex, dizzying patterns."* · **skull
goblet** — *"The hollow eye sockets tell you of forgotten, dark rituals."* ·
**wine glass** — *"A fancy glass; the few scratches upon it tell grand tales
of lies and betrayal…"* · **metal cup** — *"An iron cup, its rim gnawed-upon
and grimey."* · **dwarven music box** — *"A personal device heralding the new
era of machine and steam. Dwarven artificers both prize and fear this device
for its broad musical range…"*

### Carved gems (`gem_items.dm`)

A materials × forms matrix — eight stones (shell, rosellusk, joapstone, onyxa,
ceruleabaster, aoetal, petriamber, opaloise) crossed with fork, spoon, cameo,
figurine, vase, bust, comb, duck, urn, statue, obelisk — plus a signature
carving per stone:

- **raw rosellusk** — *"Pink and lustrous, these pearls produced by fossilized
  clamshells are valued by Eorans: and are usually gifted to expecting mothers
  and newlyweds."*
- **onyxa snake statue** — *"A flying horned snake carved out of onyxa. Once
  considered a sacred animal of Subterra, now considered vermin."*
- **petriamber beaver statue** — *"Beavers known to build dams and congregate
  around shipwrecks. Some sailors consider them to be a bad omen."*
- **opaloise crab sculpture** — *"Don't stick your fingers in its pincers,
  that's a terrible idea."*

### One named relic

**Mad God's Dream** — *"A deer skull shaped from iron-like bark, shaped around
a hefty chunk of raw silver. In Dendor's dreams, he remembers a time before
artifice destroyed both his realm and his kinship with the God of Toil."*

---

## 4. RogueTown gems

`code/game/objects/items/rogueitems/gems.dm` — Rontz 100 · Gemerald 22 ·
Blortz 88 · Toper 14 · Saffira 56 · **"Riddle of Steel"** 554, desc
*"Flesh, mind."*

---

## 5. tgstation — uplink, cargo, spellbook

`holoparasite` and `power-fist` came from here. The wikis 403 to bots, so
these are from source (`code/modules/uplink/uplink_items/`).

**Stealthy uplink** — Energy Dagger 2 (*"A dagger made of energy that looks
and functions as a pen when off."*) · Sleepy Pen 4 (*"A syringe disguised as a
functional pen…"*) · Dart Pistol 4 (*"…very quiet when fired"*) · Boxed
Origami Kit 4 · Poison Kit 6 · Syndie Lipstick 6 · Carnivorous Blood 3
(*"…will rapidly consume its victim's supply of usable blood."*) · Suppressor
1 · Syndicate Holster 1 (*"inconspicuous carrying of guns using chameleon
technology"*) · Contractor Baton 7 · Miniature Energy Crossbow 10 (*"Small
enough to fit into a pocket or slip into a bag unnoticed."*) · Martial Arts
Scroll 17 · Dehydrated Space Carp 1

**Dangerous uplink** — Box of Throwing Weapons 3 · Energy Sword 6 · Power Fist
6 · Makarov Pistol Case 7 · Gloves of the North Star 8 · Donksoft Riot Pistol
6 · Syndicate Revolver 13 · Double-Bladed Energy Sword 13 · Holoparasites 18

**Cargo packs** (`code/modules/cargo/packs/`) — Big Band Instrument
Collection · Book Crate (codex gigas + 3 random manuals + 3 random books) ·
Bureaucracy Crate (filing cabinet, camera film, hand labelers, paper bins,
pens, folders, clipboards, stamps, laser pointer) · Calligraphy Crate ·
Funeral Supplies Crate · Religious Supplies Crate · Candle Box Crate · Tattoo
Kit · Art Supplies · Scrapyard Crate (relic, broken bottle, rusted pickaxe) ·
Paper Cutters Crate

**Wizard spellbook** — mostly spells, but some item-shaped entries: Staff of
Chaos (*"A capricious tool that can fire all sorts of magic without any rhyme
or reason."*) · Staff of Change · Staff of Shrinking · Mjolnir · Singularity
Hammer · Spellblade · High Frequency Blade · **item fortification scroll**
(*"Somehow, this piece of paper can be applied to items to make them 'better'.
Apparently there's a risk of losing the item if it's already 'too good'."*)

---

## 6. Tabletop item tables

**Licensing splits these.** Maze Rats, Knave and Cairn are CC BY / open SRD —
lift freely with attribution. Into the Odd, Mörk Borg and Troika! are not, and
came off full-text mirrors of paid books; reword rather than copy.

### Maze Rats (CC BY 4.0) — the best open source here

**Tools** — Acid flask · Bear trap · Bellows · Bolt-cutters · Chain · Chisel ·
Crowbar · Door ram · Ear trumpet · Fire oil · Goggles · Grappling hook ·
Grease · Hacksaw · Hammer · Hand drill · Lantern · Lens · Lock/key ·
Lockpicks · Manacles · Metal file · Mortar/pestle · Needle · Pickaxe ·
Pitchfork · Pliers · Pole · Pulleys · Rope · Scissors · Shovel · Spikes ·
Steel wire · Tongs

**Treasure** — Alchemy recipe · Amulet · **Astrolabe** · Blueprints ·
Calligraphy · Compass · Crown · Crystal · **Deed** · Embroidery · Fine china ·
Fine liquor · Instrument · Magical book · Microscope · Music box · **Orrery** ·
Painting · Perfume · Prayer book · Printing block · Rare textile · Royal
robes · **Saint's relic** · **Scrimshaw** · Sextant · Sheet music · **Signet
ring** · Silverware · Spices · Spyglass · Tapestry · Telescope · **Treasure
map**

**Treasure traits** — a modifier list that could turn one tag into many:
Altered · Ancient · Blessed · Bulky · Compact · Consumable · Cultural value ·
**Cursed** · Damaged · Disguised · **Draws enemies** · Encoded · Exotic ·
Famous · **Forbidden** · Fragile · Immovable · Indestructible · Intelligent ·
Masterwork · Military value · **Owned** · Political value · Religious value ·
Royal · Toxic · Vile

**Miscellaneous** (pocket loot) — Brass bell · Brooch · Carved figurine · Deck
of cards · **Glass eye** · Glass jar · Handkerchief · Hinged box · Hourglass ·
**Human tooth** · **Numbered key** · Oil lamp · Old doll · Purse · Quill pen ·
Salve · Scroll · **Sealed letter** · Shaving razor · Silver button · **Skull** ·
Tobacco pipe · Wine bottle

**Magical ingredients** — the closest tabletop analogue to the brewing
ingredient list, and very close in register: Ancient liquor · Blind eye ·
Bottled fog · **Coffin nail** · Corpse's hair · **Crossroad dust** · Cultist's
entrails · **Killer's hand** · King's tooth · **Last breath** · **Liar's
tongue** · Lodestone · **Monk's vow** · **Newborn's cry** · Pyre ember ·
Queen's bee · Queen's blood · Ship's barnacle · **Star-metal** · Thief's
finger · **Tomb flower** · **Widow's tears** · Wizard skull

(`Widow's Tears` is a Lifeweb chem name too — the registers converge.)

**Book subjects** — what a found book answers: Alchemy · Astrology ·
**Blackmail** · Charts & maps · **Conspiracies** · Cookbook · Divination ·
Etiquette · **Genealogy** · Hagiography · Journal · Laws · **Lost empires** ·
Lost places · Mythology · **Odd customs** · **Propaganda** · **Prophecies** ·
Siegecraft · **State secrets** · Theology · War chronicle · **Who's who** ·
Witch-hunting

### Knave (CC BY 4.0) and Cairn (open SRD)

Same designer lineage, near-identical shape. Useful additions beyond Maze
Rats: Air bladder · Antitoxin · Blank book · Caltrops · Card deck · Chalk ·
Cook pots · Dowsing rod · Face paint · **Fake jewels** · Fishing rod · Glue ·
Holy water · Incense · **Loaded dice** · Marbles · Mirror (small, silver) ·
Net · Oilskin bag · Oilskin trousers · Padlock and key · Quill & ink ·
**Repellent** · Salt pack · Saw · Sealant · Small bell · Soap · Spiked boots ·
Sponge · Tar pot · Tinderbox · Twine · Whistle · Wolfsbane · **Spirit ward**

Knave's **Misfortunes** table is a ready-made negative-tag list: Abandoned ·
Addicted · **Blackmailed** · Condemned · Cursed · **Defrauded** · Demoted ·
**Discredited** · **Disowned** · **Exiled** · **Framed** · **Haunted** ·
Kidnapped · Mutilated · Poor · **Pursued** · Rejected · Replaced · **Robbed** ·
**Suspected**

Several are close to tags you have (`wanted`, `disgraced`, `in-debt`,
`slave-brand`); the rest is unclaimed ground.

### The three closed sources, for inspiration only

**Mörk Borg** starting kit — magnesium strip · lantern with oil · medicine
chest · metal file and lockpicks · bear trap · sealed-bottle bomb · bottle of
red poison · silver crucifix · life elixir · random unclean scroll. Its
**sacred scroll** names are the tonal standout: *Grace for a Sinner · Pass the
Gate · Bestial Speech · Whispers · Unmet Fate · Aegis of Sorrow · Hermetic
Step · False Dawn · Night's Chariot · Roskoe's Consuming Glare · Enochian
Syntax.*

**Troika!** — the buried-tech register that matches the caves. *Cacogen*
carries "Fusil, 2d6 **Plasmic Cores**, Sword, and Velare"; *Thinking Engine*
has "detachable autonomous hands… or inbuilt particle detector"; *Fellowship
of Knidos* a "Large Astrolabe (Damage as Mace)"; *Parchment Witch* "Vials of
Pigments and Powders… and Sword Cane"; *Necromancer* "The Skull of your
Master."

**Into the Odd** — its Arcana tables turned out to be *effects*, not objects,
so they read as powers rather than gear. Less useful than hoped.

---

## Where each gap gets filled

| Gap | Best source |
|---|---|
| `items-gear` — light, rope, containers, camp | Azure Peak **Adventure Supplies** and **Tools**; **Maze Rats/Knave/Cairn** tool lists |
| `items-food` (2 entries) | Azure Peak **Food**; Lifeweb **Beverages & Food** |
| `assets-companions` (4 entries) | Azure Peak **Livestock** |
| `items-special` — exotic salvage | Vanderlin **inquisition relics**, **mage items**, `natural.dm`; tg **stealthy uplink** |
| Court / social objects | Azure Peak **Luxury**; Maze Rats **Treasure** |
| Occult / cult objects | Vanderlin relics; Azure Peak **Apparel** amulets; Mörk Borg **scroll names** |
| Writing, forgery, records | tg **Bureaucracy** and **Calligraphy** crates; Maze Rats **Book subjects** |
| Instruments — `musician` has nothing to hold | Azure Peak **Instruments** |
| Books — `literate` has nothing to read | Vanderlin `books.dm`; Maze Rats **Book subjects** |
| Brewing ingredients beyond the current five | Lifeweb's fungal vocabulary; Maze Rats **Magical ingredients** |
| Negative tags | Knave **Misfortunes** |
| **Prosthetics — six maiming tags, nothing that fits** | Azure Peak `tools.dm` |

### The three worth doing first

1. **Prosthetics.** The clearest hole. Missing Arm, Missing Leg, Peg Leg,
   Crippled Leg, Missing Fingers and Mangled Hand all exist with no answer.
   Azure Peak has wood → bronze → iron → steel. Priced off `SMITHING.md` and
   gated on `smithing`, that is four or five tags that make six existing ones
   playable instead of terminal.
2. **`items-gear`.** Fourteen entries, and no light source, rope, container or
   camp kit in a game whose map is caves.
3. **Instruments and books.** Two skills with no object attached to either.
   Small, cheap, and they make an existing purchase feel real.

Deliberately **not** recommended: more weapons, more armor, more potions. All
three ladders are full, and `SMITHING.md`/`BREWING.md` govern them.

## Caveats

- **One negative claim was wrong and was overruled.** A research pass reported
  Vanderlin's merchant stock as "not found, probably map-placed"; an earlier
  pass had already pulled it from
  `code/datums/world_factions/traders/trade_data_types/`. If something below
  looks absent rather than empty, it is worth a second look.
- **Genuinely absent, not missed:** the Lifeweb wiki has only two content
  categories (Fate and Lore) — no items or equipment page beyond Obol and
  Recipes. Eleven of Vanderlin's thirteen generic trader archetypes have no
  sell stock at all. Rope was not in Vanderlin's `natural.dm` and its real
  file was not located.
- **Not obtained:** Ultraviolet Grasslands and Veins of the Earth (no open
  transcription exists). The D&D 5e d100 trinket table was not pursued.
- The SS13 codebases are AGPL. Their text is reusable but carries the licence
  — for tag descriptions you are rewriting anyway this is mostly moot, but
  don't paste desc strings verbatim into the catalog.
