# Cultist inspiration — what the old Lifeweb codebase actually did

Notes for designing Bascinet's cultist tags. Everything here is read out of the
open-sourced SS13 Lifeweb forks, which are the same codebase four times over:

- `mcschwa/Farweb` — the one I read from. Most complete.
- `Near-Web/Deathweb`, `mcschwa/Nearweb`, `Near-Web/Neargame` — identical trees.
- `SS13-Special-Codebases-Archive/OpenSourceWeb` — the "official" open-source
  dump of Farweb.

The cult is called the **Thanati**, and their god is **Tzchernobog**. Paths
below are relative to the repo root, e.g.
`code/modules/mob/living/carbon/human/thanati/`.

This is a reference doc, not a proposal. Nothing here is decided.

---

## 1. The frame: you don't know who else is in

At roundstart every job carries a `thanati_chance`. A private roll decides if
you're Thanati, and you're told either "Thanati Roll: Successful!" or "Thanati
Roll: Failed!" — so *everyone* knows a roll happened, and nobody knows anyone
else's result (`code/game/jobs/job_controller.dm:513`).

A successful cultist gets:

> ⠀You're part of the Thanati cult. It's not a legal religion in Evergreen,
> stay away from the Inquisition. Check your memories to see who's your
> brothers and sisters in faith.

Three things come with it, and they're the good part:

**A Circle.** One of eight, picked at random: *Doll Making, Malice, Traps,
Alteration, Fate, Grief, Mind, Speech*. Your Circle is your speciality — some
rituals check it (`cultistType = "Malice"` in `thanati/rituals.dm`).

**A corrupt word.** Two nonsense syllable-halves joined, drawn from
`Staza / Gmysa / Gxero / Fgaxa / Ixero / Bpah / Xhot` and
`Gmyhoxe / Gmyho / Gzma / Tzche / Bog / Irkhvi` — so, "Fgaxa Irkhvi", "Xhot
Tzche". Speaking your word while standing in a sigil is what fires a ritual
(`thanati/rituals.dm`, the `say()` override).

**A second, fake word.** `thanati_word_random` is generated the same way and
handed to you alongside the real one, with no label saying which is which
(`job_controller.dm:527`). So a cultist under interrogation can give up a word
that does nothing, and an Inquisitor who collects words can't tell signal from
noise. This is the single best idea in the whole codebase.

The memory line is stored as: `My word is [word] and my circle is [Circle]`.

Three verbs come with membership, surfaced as a Thanati panel button:
*Call to the Lord* (`praisethelord` — a public emote), *Remember the Words*
(`getWords`), *Remember the Associates* (`getBrothers` — lists every living
Thanati **and their Circle**). Note that last one is a total roster; there is
no cell structure. Bascinet's `cult-leader` telepathic broadcast is already
a softer version of this.

---

## 2. The sigil: rituals are recipes on a 3×3 grid

`thanati/rituals.dm` is a table. Each ritual is a 3×3 layout — eight compass
cells plus a centre — and each cell names an object type that has to be sitting
there. Stand in the middle, say your word, and the engine walks the table and
fires the first ritual whose ingredients are all present.

Drawing the sigil itself takes **Tzchernobog's flesh**: hold food in your hand,
say a corrupt word, and it turns into a lump of flesh
(`get_corrupt()`, `thanatos.dm`). Hit the floor with the flesh and it's consumed
drawing nine sigil tiles, one at a time, with a `do_after` on each — so you can
be walked in on halfway through.

The sigils are `/obj/effect/decal/cleanable/` — **cleanable**. Anyone can scrub
them off the floor.

> "Strange runics, symbols draw with unknown materials."

The recipes themselves, verbatim from the table:

| Ritual | Ingredients | Circle |
|---|---|---|
| Convert | a person in the centre | any |
| Black Judgment | 6 candles + a coin in the centre | Malice |
| Rage | 4 severed heads + a liver + three people | Malice |
| Living Dead | 3 bones + a candle + meat | any |
| Loneliness | 8 glass shards + a photo | any |
| Propaganda | a written paper | any |
| The Call | left foot + right foot + a photo | any |
| Become Monster | 4 brains + a monster | any |
| Grand Gathering | 2 candles + a stone | Speech |
| Armor of Faith | 4 lumps of flesh + cult robes | Alteration |
| False Target | 1 lump of flesh + a photo | Traps |
| Malignant | 4 candles + a person | Traps |

Two structural notes worth stealing regardless of the fiction:

- **A photograph of a person is a targeting component.** Three separate rituals
  reach a victim by having their picture on the altar. It's a physical,
  stealable, burnable thing that stands in for "I have you".
- **Bodies are ingredients.** Heads, feet, brains, livers, bones. The cult
  needs corpses in a game that already has corpses and a `Mortus` who handles
  them.

---

## 3. The rituals, one by one

**Convert** (`rituals/convert.dm`) — the recruitment ritual. Only works on a
willing person standing on the sigil.

> "Your mind is filled with thoughts that you once saw as heretics, giving you
> an overwhelming desire to glorify the overlord."

Church jobs are worth more to convert: an Incarn costs the converter 1 point,
an Inquisitor 5, a Bishop or Priest 10. If a cultist stands on their *own*
sigil and does it, they teleport to a random other sigil in the world instead —
the sigil network doubles as fast travel.

**Black Judgment** (`rituals/malice/blackjudgment.dm`) — a death curse on a
named person, at real risk to yourself. You enchant a coin; the coin *listens*,
and the last name spoken near it becomes the victim. Use the coin and that
person dies wherever they are, head detached.

> "You have received judgement."

It fails against a Bishop, Priest, Baron or Count, against anyone wearing a
holy cross amulet, and against the Dreamer. And there's a backfire branch: if
the coin was the last one, the caster dies instead — `JINXED!`

**Rage** (`rituals/malice/rage.dm`) — a war-band buff. Everyone standing in the
row gets +6 to +10 Strength, +2 Dexterity, and **−5 Intelligence**, once ever.

> "You feel your muscles itching, and your head getting lighter"

The cost is real: a raged character examining anything gets back the single
word `Uh?` They physically cannot read the room any more.

**Loneliness / Mr Lonely** (`rituals/grief/mrlonely.dm`) — the cruellest one.
Target by photo. From then on the victim sees *every other person* as a burning
figure, and examining anyone returns:

> "Something is there but you can't see it."

They can still talk to people. They just can't identify anyone, ever again.
Blocked by the holy cross, and by being Count, Bishop or Priest.

**The Call** (`rituals/mind/thecall.dm`) — photo target, and they are simply
teleported onto your sigil. Abduction with no travel and no witnesses. Blocked
by the cross.

**Grand Gathering** (`rituals/speech/grandgathering.dm`) — Speech Circle. Every
Thanati in the world vanishes and reappears on your sigil.

> "**GATHER!**"

Note the check: a cultist wearing a holy cross as camouflage doesn't get
summoned. The comment in the source is `// don't wear the cross thanati :troll:`
— protective disguise and cult utility are mutually exclusive, which is a nice
tension to build a tag pair on.

**Propaganda** (`rituals/speech/propaganda.dm`) — write anything on a piece of
paper, put it on the sigil, and a copy of it materialises at the feet of every
single person in the world. One-shot per sheet. This is the one that translates
most directly to an asynchronous game.

**False Target** (`rituals/traps/falsetarget.dm`) — photo target, sets a
`falsetarget` flag on them. Downstream, the Church's own blood rite reads that
flag and treats the victim as if they were a heretic. You frame someone by
making the Inquisition's detection tool lie.

> "*Falsified.*"

**Malignant** (`rituals/traps/malignant.dm`) — if the person on your sigil has
swallowed a lump of Tzchernobog's flesh, they become yours.

> "You're now [name]'s servant."

**Armor of Faith** (`rituals/alteration/armoroffaith.dm`) — the only crafting
ritual. Four lumps of flesh turn cult robes into black cult robes.

> "**The robes darken, transforming into something more strong.**"

**Living Dead** (`rituals/grief/livingdead.dm`) — global, once per round.
Every zombie in the world gets much stronger.

> "Screamers are coming..."

**Become Monster** (`rituals/special/graga.dm`) — you abandon your body and
transfer your mind into a monster standing on the sigil. The end of a cultist's
career, not a power.

---

## 4. Counterplay, and it's mostly one item

Count how many rituals check `istype(H.amulet, .../holy/cross)`: Loneliness,
The Call, Black Judgment, False Target, Grand Gathering. **The holy cross
amulet is the whole defence.** One cheap wearable, visible on your character,
that turns off most of the cult's targeting.

The rest of the counterplay:

- Sigils are cleanable. Anyone who finds one can erase it.
- Ranking Church and noble jobs (Bishop, Priest, Baron, Count) are flatly
  immune to several rituals.
- The Cross of Ravenheart (`code/defines/obj/heresy.dm`) — raising it snuffs
  one lit candle per living Thanati in the world, which is a *detector*: the
  Church learns how many cultists exist by how many candles go out. Standing
  among three or more lit candles when you raise it makes you a martyr.
- The Church's own blood rite defiles its altar if the blood came from a
  non-believer — which is exactly what False Target subverts.

Objectives are shared and cult-wide, not personal
(`thanati/thanatiDatum.dm`): kill the entire Church (Bishop, Inquisitor,
Practicus, Nun), blow up the church and destroy the sun of eternal night, or
simply *have at least ten of our own inside the fortress*. That last one is
the interesting shape for a month-long game — a headcount win, not a kill win.
There's a commented-out fourth: "Summon a manifestation of Tzchernobog."

---

## 5. The doctrine, verbatim

From `html/beliefs.html` in the Neargame fork. This is the in-game religion
book and it's genuinely well written. The Thanati keys:

> - Our Multiverse is a bleak and miserable place. Its possibilities are
>   limited and poor even for godlike beings.
> - Our Lord Tzchernobog is one of the supreme creatures of the First God, and
>   he showed us the way.
> - The Multiverse shall be replaced.
> - When the weak Old God created the Universe, he couldn't keep it all in his
>   mind, therefore he created the Living, who were supposed to seal the Order
>   of Things by their faith and conscience.
> - A truly new Multiverse cannot exist before Infinity becomes Zero.
> - The Moment of Now doesn't exist without the Living.
> - Tzchernobog is able to create a far more complicated and marvelous world,
>   where we all shall be reborn.
> - To achieve the Great Rebirth, it is necessary for us to destroy the First
>   God by sending Him and all his followers into Oblivion.

Their tagline is **"Transmutation through Death."**

The Old Ways in that same book are a *cosmology*, not a pantheon — worth
reading against our own `old-ways-*` tags:

> Death doesn't stop our existence. When a truly living being reaches death,
> it's soul goes to the Shadow which is casted by reality. […] A strong soul
> could be reborn in a new material form, but a weak one will surrender. It
> will descend into a pseudo-reality, thus losing all possibility of return to
> the real world. These pseudo-realities, called Reflections, are creations of
> souls. […] As for us, we've been dead for long, and we are in the fourth of
> seven Reflections.

And the gods are dead people who got stuck:

> The strongest of lost souls are called Gods. […] After all these millennia,
> their consciousnesses have become degraded and narrow, absorbed by but one of
> their aspects, whether it be an emotion or occupation. […] Quasi-living
> profit by it, pleasing the passion of a god they choose, and gaining his help
> in reward.

The roster, with their one aspect each — **Veles** (supreme, sage, mediator),
**Thoth** (knowledge, crafts, arts; possesses people and forces them to make
things), **Armok** (blood, violence, the Creator who reached the Fourth
Reflection first), **Lir** (nature, scorns technology, the only inhuman one),
**Baccus** ("the Lustful God, Prince of Illusions, The One Who Abides In
Orgasm"), **Eusoch** (the Healer, delays your Descent), **Xom** (chance and
chaos, "mad like all those who intentionally become his toy"), **Grosth**
(disgust; "worshippers are total outcasts, and they are likely to be slain on
sight by anyone who recognizes them").

Our `old-ways-sylvia` maps onto Lir. We have no Veles, Armok, Xom or Grosth.

The code for the Old Ways is thinner than the lore: each god is a statue you
right-click to swear to ("Do you accept [god] as your leader?"), you accumulate
**piety** by sacrificing items on an altar next to the statue
(`oldways/altar.dm` — piety goes up by the item's worth), and the statue talks
back at you. Xom is the only one with implemented powers, and they're a random
table of pranks fired at his followers on a timer, weighted by probability —
spawn monsters near them, set them on fire, teleport them to a stranger and
demand they talk, reroll their stats up or down, and one 1-in-100 outcome that
literally ends your game. The rest of that file is Brazilian shitposting; the
*structure* — a god who acts on you unbidden, good and bad — is the salvageable
part.

---

## 6. The Dreamer, for a different kind of seat

Not the cult, but adjacent and worth knowing
(`code/game/gamemodes/dreamer/`). One player is the Dreamer. He's told:

> Another NIGHT here. This labyrinthine fortress TWISTS and DISTORTS, something
> shimmers under the CRACKS. I know in my VISIONS, something GREATER lies
> beyond this LIFE.
> I shall CUT my BONDS, only beneath the skin does the TRUTH lay.
> Dream #1: FOLLOWING my HEART shall be the WHOLE of the law.

He builds four **Wonders** — sculptures assembled out of organs, each with a
recipe (bones + a skull + 3 lungs; guts + jaws + a liver; and so on) and each
carrying a four-digit key. Anyone who *sees* a Wonder screams, is permanently
marked, and has the key written into their own heart. To finish, the Dreamer
needs all four keys, which means cutting them out of the people who saw his
work.

> "Who could have done something like this?!!?"

If he completes it, he wakes up: the fortress was never real, he's Trey Liam, a
second-class pilot on a trade vessel that's been drifting for twenty years, and
the whole game was the cyberdeck he used to doze off. The round ends there. His
failure message is *"The Dreamer is still imprisioned in his own labyrinth."*

The mechanic to steal is the marking: **a work of art that brands everyone who
sees it, and the artist has to hunt down his own audience.** That's an
information economy, not a combat one, and it would run fine on a one-day turn.

---

## 7. What I'd actually lift

Ranked by how well it survives being asynchronous and GM-adjudicated.

1. **The decoy word.** Every cultist holds a real passphrase and a fake one,
   with nothing marking which is which. Costs nothing to implement, ruins
   interrogation forever. Fits our existing hidden-tag machinery.
2. **Circles.** Eight named specialities, assigned not chosen, each gating a
   handful of tags. Gives cultists a reason to find *each other* rather than
   just more converts — you can't do a Speech ritual without a Speech cultist.
3. **Propaganda.** Write a document, and it appears in front of every player.
   We already have `/documents` and `#info`; this is a one-request feature and
   it's pure social chaos.
4. **The photo as a targeting component.** A physical, stealable object that
   means "I can reach this person". Everything nasty needs one.
5. **The headcount objective.** "Have at least ten of our own inside the
   fortress" beats "kill the Bishop" for a month-long game — it's a growth
   race the Church can measure and fight without anyone having to die.
6. **The cross that turns off the cult, and can't be worn by cultists.** One
   visible item, worn on the character sheet, that blocks most targeting — and
   wearing it as camouflage locks you out of your own rituals. That's a real
   decision, made once, in public.
7. **Ritual ingredients that are corpse parts**, with a Mortus in the middle of
   it. We already have burial as a request.
8. **Rage.** A buy-in that trades intelligence for strength, permanently, and
   whose downside is that you stop being able to *read* — in our terms, losing
   access to information rather than a stat.
9. **The Wonder.** An artwork that marks its audience.

The two to leave alone: Black Judgment (a name-a-player-and-they-die button is
too much for 100 players on a day cycle) and Grand Gathering (mass teleport
breaks the map and the travel economy outright).
