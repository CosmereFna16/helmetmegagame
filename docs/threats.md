# Threats

The GM-assigned seats: Sympathizer, the Demoness, the Judge, the NPC
monsters, the Brigands.

Note this list and the **antagonist opt-in catalog** are separate and have
drifted: `db/lib/antagonists.js` ships eleven consent entries a player can tick
at character creation (`CHARACTERS.md` §1), while the briefs below cover fewer
seats. Neither reads the other — the opt-ins are pure consent data, and these
are prose for a GM. If you add a seat to one, consider whether it belongs in
the other.

**Nothing reads this file.** These seats never appear in the player-facing role
picker and have no rows in the database — a GM hands one out by hand, over
Discord, and runs it from there. This file exists so that brief is legible in
one place. It lived in `docs/roles.yaml`'s `zones[].threats[]` blocks until it
was moved here; those blocks carried `starting_resources`, `starting_location`,
`doc_elements` and seat caps, all of which were only ever decoration, since
`db/lib/syncRoles.js` walks `zones[].factions[].roles[]` and never touches
threats.

Starting tags are kept, because they are a genuinely useful pointer for the GM
setting the seat up: they name real entries in `docs/tags.yaml`, and a GM grants
them from `/gm/dev/characters/[characterId]`.

---

## Fortress

### Sympathizer (Fortress)

_Install the Bastard on the throne, by any means necessary._

- Your main goal: install the Bastard on the throne. To that end, turn the court against itself, scheme, and so on.
- You must also choose a second, self-serving goal. Ideas: kill the Baron in a dramatic way as revenge; kidnap the Heir or Successor (you're obsessed); take the Manor from the Lord and install yourself in it. In other words, figure out why you are personally invested in seeing this through.
- Be creative. Turn people against each other, convert people, cause incidents that make other people look bad.

**Starting tags:** none.

### Demoness (Fortress)

_You live for the thrill of enslaving souls and causing pain._

- You are a being from the Caves. You have been alive for a long time, but your memory is fuzzy.
- You don't need to eat. Instead, you live for the thrill of enslaving souls, manipulating people, and causing pain. You will become unhappy if you don't.
- You can Break souls — see the Demoness tag.
- Your Desires are drawn from the Demoness's own gated catalog entries (`demoness`), a ladder running from encouraging someone to let loose at the low end up to enslaving the soul of the Heir at the top — see `docs/desires.yaml`'s `4g. Demoness` block for the full list. ‡
- You find normal crosses tacky and boring. Fire scares you somewhat — it definitely hurts. The Silver Cross, on the other hand, terrifies you. If you touch it, your powers are disabled for the rest of the day.
- There may be people in the area who want to use your power. They'll take your treasured independence — the demented, servile idiots.

**Starting tags:** Hungerless, Insightful, Demoness.

The Demoness tag unlocks the Demoness tag category — Slavemaster, the
discounted Seductive/Torturer twins, and the three true forms. See
`docs/tags.yaml` and the `demoness` document in `docs/documents.yaml`.

## Town

### The Judge (Town, or Cave)

_"Whatever in creation exists without my knowledge exists without my consent."_

- "Whatever in creation exists without my knowledge exists without my consent." You start with +15 Tag Points.
- True evil doesn't exist, but you come close. Among the lost, weak, and misunderstood, history contains those who inexplicably choose darkness. That is you.
- Your ultimate goal is to become infamous—not because you care what other people think, but because it sends a message. The more people know, fear, or respect your name, the better.
- Immortal or delusional, you treat life like a game. You glory in war and despise weakness. You fear nothing, although people that are genuinely good through and through make you uncomfortable. Fortunately, there are very few of those left.
- You can work alone, but you are a natural leader. Take over the Brigands, start an adventurer troop, or rise the ranks of the Bastard's entourage.
- Do not hide your nature or commit murders in the dark. You're not a serial killer.
- People can't help but love you.
- Your Desires must relate to violence, glory, control, or competition.

**Starting tags:** none.

## Caves

### Monsters (NPC)

_Monsters in the caves, to be hunted._

- Monsters in the caves, to be hunted.

**Starting tags:** none.

### Brigand Leader (Caves)

_Loot the caves (dangerous) as a way to fund the Camp's war effort._

- Loot the caves (dangerous) as a way to fund the Camp's war effort.

**Starting tags:** none.

### Brigand (Caves)

_Loot the caves (dangerous) as a way to fund the Camp's war effort._

- Loot the caves (dangerous) as a way to fund the Camp's war effort.

**Starting tags:** none.
