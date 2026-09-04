// The threat catalog: every antagonist seat in the game, in one place.
//
// A threat is three things at once, and which ones an entry carries is what
// tells them apart:
//
//   optIn      a checkbox on the creation wizard's Antagonists step. Consent
//              data — a player says which seats they are open to being handed.
//   assign     a real seat a GM can hand to an existing character. Grants the
//              tags and points named here and DMs the blurb.
//   spawn      the same seat, handed to somebody with no character: a whole
//              new one, offered over DM and accepted with a button.
//
// MOST OPT-INS ARE DECOYS. They carry `optIn` and nothing else, so ticking one
// tells a GM about consent without telling the player which seats are real.
// An entry with neither `assign` nor `optIn` is a brief a GM runs entirely by
// hand — no checkbox, no button, prose only.
//
// Kept in code rather than a table for the same reason as db/lib/roleIds.js:
// fixed values that can never differ per environment, so a row would only add
// a join and a way to drift.
//
// Alphabetized by `name` so catalog order *is* display order and nothing
// downstream has to sort. That ordering is also what hides the real seats
// among the decoys on the wizard.
//
// The blurbs are Bascinet's own words and carry no ‡ (CLAUDE.md), except the
// one Demoness line that was drafted here and still waits on a rewrite.

const THREATS = [
  {
    slug: "aberrant-emissary",
    name: "Aberrant Emissary",
    optIn: true,
  },
  {
    slug: "archon",
    name: "Archon",
    optIn: true,
  },
  {
    slug: "brigand",
    name: "Brigand",
    zone: "Caves",
    blurb: ["Loot the caves (dangerous) as a way to fund the Camp's war effort."],
  },
  {
    slug: "brigand-leader",
    name: "Brigand Leader",
    zone: "Caves",
    blurb: ["Loot the caves (dangerous) as a way to fund the Camp's war effort."],
  },
  {
    slug: "demoness",
    name: "Demoness",
    optIn: true,
    assignable: true,
    // How the roster finds who holds this seat. Derived from the tag rather
    // than stored on the character, so a GM granting it by hand from
    // /gm/dev/characters/[id] still shows up.
    seatTagSlug: "demoness",
    zone: "Fortress",
    blurb: [
      "You live for the thrill of enslaving souls and causing pain.",
      "You are a being from the Caves. You have been alive for a long time, but your memory is fuzzy.",
      "You don't need to eat. Instead, you live for the thrill of enslaving souls, manipulating people, and causing pain. You will become unhappy if you don't.",
      "You can Break souls — see the Demoness tag.",
      "Your Desires are drawn from the Demoness's own gated catalog entries (`demoness`), a ladder running from encouraging someone to let loose at the low end up to enslaving the soul of the Heir at the top — see `docs/desires.yaml`'s `4g. Demoness` block for the full list. ‡",
      "You find normal crosses tacky and boring. Fire scares you somewhat — it definitely hurts. The Silver Cross, on the other hand, terrifies you. If you touch it, your powers are disabled for the rest of the day.",
      "There may be people in the area who want to use your power. They'll take your treasured independence — the demented, servile idiots.",
    ],
    assign: { tagPoints: 7, tagSlugs: ["demoness", "hungerless"] },
    spawn: {
      gender: "WOMAN",
      // null: the seat has no default role, so the GM picks one when offering.
      roleSlug: null,
      resources: 3,
      tagPoints: 7,
      // parseStartingTag syntax (db/lib/startingTags.js) — "x4" is a stack
      // count, not four entries, which a name-set lookup would collapse.
      tagSlugs: ["dagger", "obol x4"],
    },
  },
  {
    slug: "false-chaplain",
    name: "False Chaplain",
    optIn: true,
  },
  {
    slug: "judge",
    name: "Judge",
    optIn: true,
    assignable: true,
    seatTagSlug: "judge",
    zone: "Town, or Cave",
    blurb: [
      '"Whatever in creation exists without my knowledge exists without my consent."',
      "True evil doesn't exist, but you come close. Among the lost, weak, and misunderstood, history contains those who inexplicably choose darkness. That is you.",
      "Your ultimate goal is to become infamous—not because you care what other people think, but because it sends a message. The more people know, fear, or respect your name, the better.",
      "Immortal or delusional, you treat life like a game. You glory in war and despise weakness. You fear nothing, although people that are genuinely good through and through make you uncomfortable. Fortunately, there are very few of those left.",
      "You can work alone, but you are a natural leader. Take over the Brigands, start an adventurer troop, or rise the ranks of the Bastard's entourage.",
      "Do not hide your nature or commit murders in the dark. You're not a serial killer.",
      "People can't help but love you.",
    ],
    assign: { tagPoints: 17, tagSlugs: ["cruel", "judge"] },
    spawn: {
      gender: "MAN",
      roleSlug: null,
      resources: 3,
      tagPoints: 17,
      tagSlugs: ["neoclassic-duelista", "light-infantry-armour", "obol x4"],
    },
  },
  {
    slug: "monsters",
    name: "Monsters",
    zone: "Caves",
    blurb: ["Monsters in the caves, to be hunted."],
  },
  {
    slug: "neomorph",
    name: "Neomorph",
    optIn: true,
  },
  {
    slug: "obsessed",
    name: "Obsessed",
    optIn: true,
  },
  {
    slug: "phrygian-count",
    name: "Phrygian Count",
    optIn: true,
  },
  {
    slug: "schemer",
    name: "Schemer",
    optIn: true,
  },
  {
    slug: "sympathizer",
    name: "Sympathizer",
    zone: "Fortress",
    blurb: [
      "Install the Bastard on the throne, by any means necessary.",
      "Your main goal: install the Bastard on the throne. To that end, turn the court against itself, scheme, and so on.",
      "You must also choose a second, self-serving goal. Ideas: kill the Baron in a dramatic way as revenge; kidnap the Heir or Successor (you're obsessed); take the Manor from the Lord and install yourself in it. In other words, figure out why you are personally invested in seeing this through.",
      "Be creative. Turn people against each other, convert people, cause incidents that make other people look bad.",
    ],
  },
  {
    slug: "tribunal-operations",
    name: "Tribunal Operations",
    optIn: true,
  },
  {
    slug: "warlock",
    name: "Warlock",
    optIn: true,
  },
];

const THREATS_BY_SLUG = new Map(THREATS.map((t) => [t.slug, t]));

// The wizard's checkbox list. Everything else in the catalog is either a
// GM-only brief or a seat handed out without asking.
const OPT_IN_THREATS = THREATS.filter((t) => t.optIn);
const ANTAGONISTS = OPT_IN_THREATS;
const ANTAGONIST_SLUGS = new Set(OPT_IN_THREATS.map((t) => t.slug));

// Every seat a GM can hand out. Assignable and spawnable are the same set:
// anything that can be given to an existing character can also arrive as a
// new one.
const ASSIGNABLE_THREATS = THREATS.filter((t) => t.assignable);

// Slug -> the tag that means "holds this seat", for the roster's derivation.
const SEAT_TAG_SLUGS = ASSIGNABLE_THREATS.map((t) => t.seatTagSlug).filter(Boolean);

function threatBySlug(slug) {
  return THREATS_BY_SLUG.get(slug) ?? null;
}

// The one entry, if any, whose seat tag this slug is. Lets the roster turn a
// held tag back into the seat it stands for.
function threatBySeatTag(tagSlug) {
  return ASSIGNABLE_THREATS.find((t) => t.seatTagSlug === tagSlug) ?? null;
}

// Whatever the form posted, reduced to known opt-in slugs, deduped, in
// catalog order. The wizard's checkboxes are UX; this is the boundary that
// keeps junk out of the column, same posture as normalizeHonorific's
// allowlist. A slug that has since left the catalog is dropped here, which is
// why renaming one needs no data migration.
function normalizeAntagonistSlugs(input) {
  const posted = new Set(
    (Array.isArray(input) ? input : [input])
      .filter((v) => v != null)
      .map((v) => v.toString().trim()),
  );
  return OPT_IN_THREATS.filter((t) => posted.has(t.slug)).map((t) => t.slug);
}

// Slugs -> display names, in catalog order. Unknown slugs are dropped rather
// than rendered raw, so a stale value can never leak into the UI.
function antagonistNames(slugs) {
  const held = new Set(slugs ?? []);
  return OPT_IN_THREATS.filter((t) => held.has(t.slug)).map((t) => t.name);
}

// A spawned character needs a name and there is nobody to type one, so one is
// rolled. NO ‡ ANYWHERE IN THESE — a name is written to Character.name, the
// Discord nickname and the personal role title, all of which are matched or
// worn as identity rather than read as prose.
const SPAWN_NAMES = {
  WOMAN: [
    "Maeris", "Ilvane", "Corrin", "Sabeth", "Vessa", "Orlaith",
    "Thessaly", "Maren", "Yveline", "Perrin", "Cassia", "Domna",
    "Roswitha", "Ferren", "Alisaunde", "Nyssa", "Odila", "Verity",
    "Halcyone", "Ismene", "Brenna", "Solveig", "Cerise", "Aldith",
  ],
  MAN: [
    "Jorren", "Aldric", "Vaskin", "Corben", "Merric", "Thaddeus",
    "Ossian", "Ruvain", "Gaspar", "Edren", "Lucan", "Ambrose",
    "Halvard", "Ceril", "Rodrigan", "Ysbrand", "Emeric", "Tobias",
    "Warrin", "Anselm", "Dorian", "Fenric", "Marcus", "Oswin",
  ],
  NEUTRAL: [
    "Ash", "Corvin", "Wren", "Sable", "Lark", "Rowan",
    "Vesper", "Quill", "Ember", "Marlow", "Peregrine", "Sorrel",
  ],
};

function randomSpawnName(gender) {
  const pool = SPAWN_NAMES[gender] ?? SPAWN_NAMES.NEUTRAL;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Button customId prefixes for the spawn offer. The web builds the buttons and
// the bot routes the clicks, so the strings live here rather than on either
// side — the REST/gateway twin convention (ARCHITECTURE.md).
const THREAT_SPAWN_ACCEPT_PREFIX = "threat-spawn-accept:";
const THREAT_SPAWN_DECLINE_PREFIX = "threat-spawn-decline:";

module.exports = {
  THREATS,
  OPT_IN_THREATS,
  ASSIGNABLE_THREATS,
  SEAT_TAG_SLUGS,
  SPAWN_NAMES,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  threatBySlug,
  threatBySeatTag,
  randomSpawnName,
  // Kept under the old names: the column is still Character.antagonistOptIns
  // and every caller of these two is about that column.
  ANTAGONISTS,
  ANTAGONIST_SLUGS,
  normalizeAntagonistSlugs,
  antagonistNames,
};
