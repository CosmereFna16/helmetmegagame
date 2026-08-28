// The pool the "Randomize" button on the creation wizard and the /character
// Bio panel draws from.
//
// Kept in code rather than a table or a YAML master, for the same reason as
// db/lib/antagonists.js: fixed values that can never differ per environment, so
// a row would only add a join and a way to drift. It also has to be importable
// by a client component (via web/lib/nameCorpus.js), which rules out YAML
// outright — every sync*.js reads its file with node:fs, which cannot be
// bundled for the browser.
//
// Pure: no prisma, no node: builtins, no I/O. Same posture as
// db/lib/characterName.js, whose NAME_LIMITS every entry here fits inside by a
// wide margin (longest given name 10, longest surname 10, against caps of 24
// and 20) — so nothing downstream ever silently truncates a generated name.
//
// Register: Central and Eastern European first, then Iberian, a few
// British — all drawn from OpenXcom's bin/common/SoldierName/*.nam files
// (github.com/OpenXcom/OpenXcom, GPL-3.0), which ship real, everyday given
// names and surnames per nationality rather than the archaic, hard-to-place
// names an earlier pass of this file used (Miłosz, Zbyslava). The surnames mix
// noble houses with trade and descriptive names on purpose, so one pool serves
// both a Baron and a miner.
// Region tags exist only so a generated name can be internally coherent —
// "Zsigmond Nádasdy" reads like a person, "Zsigmond Ataíde" reads like a random
// generator. See randomCharacterName's CROSS_REGION_CHANCE for the exception.
const SLAVIC_WEST = "slavic-west"; // Polish, Czech, Slovak
const HUNGARIAN = "hungarian";
const ROMANIAN = "romanian";
const SLAVIC_SOUTH = "slavic-south"; // OpenXcom has no Serbian/Croatian file; Bulgarian.nam is the closest match
const RUTHENIAN = "ruthenian"; // OpenXcom has no distinct Ruthenian/Ukrainian file; Russian.nam is the closest match
const BALTIC = "baltic"; // OpenXcom has no Lithuanian/Latvian file — kept from the original hand-built list
const IBERIAN = "iberian";
const BRITISH = "british";

// Written as `[region, ...names]` rows and expanded below rather than repeating
// the region on every entry, which was unreadable and easy to mis-tag.
function expand(rows) {
  return Object.freeze(
    rows.flatMap(([region, ...names]) => names.map((name) => Object.freeze({ name, region }))),
  );
}

const MEDIEVAL_MALE = expand([
  [SLAVIC_WEST, "Jan", "Piotr", "Tomasz", "Marek", "Ales", "David", "Filip", "Vojtech", "Andrej", "Jakub", "Milan", "Peter"],
  [HUNGARIAN, "Adam", "Andras", "Attila", "Balazs", "Gabor", "Istvan", "Laszlo", "Zoltan"],
  [ROMANIAN, "Adrian", "Alexandru", "Andrei", "Bogdan", "Constantin", "Mihai", "Vlad"],
  [SLAVIC_SOUTH, "Aleksandar", "Dimitar", "Georgi", "Ivan", "Nikola", "Stoyan"],
  [RUTHENIAN, "Aleksandr", "Andrey", "Boris", "Ivan", "Nikolay", "Sergey", "Vladimir"],
  [BALTIC, "Mindaugas", "Gediminas", "Vytautas", "Kęstutis"],
  [IBERIAN, "Alejandro", "Diego", "Javier", "Miguel", "Afonso", "Joao", "Rui", "Vasco"],
  [BRITISH, "Alexander", "Andrew", "Charles", "James", "Thomas", "William"],
]);

const MEDIEVAL_FEMALE = expand([
  [SLAVIC_WEST, "Anna", "Katarzyna", "Barbara", "Ewa", "Adela", "Eva", "Hana", "Tereza", "Andrea", "Lenka", "Natalia", "Zuzana"],
  [HUNGARIAN, "Agnes", "Alexandra", "Aniko", "Erzsebet", "Ilona", "Judit", "Katalin", "Zsofia"],
  [ROMANIAN, "Alexandra", "Ana", "Andreea", "Carmen", "Elena", "Ioana", "Maria"],
  [SLAVIC_SOUTH, "Ana", "Boyana", "Ivana", "Maya", "Svetlana", "Yana"],
  [RUTHENIAN, "Anna", "Ekaterina", "Irina", "Natalya", "Olga", "Svetlana", "Tatyana"],
  [BALTIC, "Birutė", "Aldona", "Danutė", "Gražina"],
  [IBERIAN, "Ana", "Carmen", "Isabel", "Sofia", "Beatriz", "Catarina", "Ines", "Mariana"],
  [BRITISH, "Alice", "Elizabeth", "Emma", "Hannah", "Margaret", "Victoria"],
]);

const MEDIEVAL_SURNAMES = expand([
  [SLAVIC_WEST, "Nowak", "Kowalski", "Wisniewski", "Wojcik", "Dvorak", "Novak", "Svoboda", "Kral", "Baca", "Horvath", "Nagy", "Varga", "Kovac", "Simek"],
  [HUNGARIAN, "Nagy", "Kovacs", "Toth", "Szabo", "Horvath", "Varga", "Kiss", "Molnar", "Farkas", "Balogh"],
  [ROMANIAN, "Popescu", "Ionescu", "Constantin", "Dumitru", "Stanescu", "Radu", "Munteanu", "Georgescu"],
  [SLAVIC_SOUTH, "Ivanov", "Petrov", "Dimitrov", "Georgiev", "Todorov", "Hristov", "Nikolaev", "Markov"],
  [RUTHENIAN, "Ivanov", "Petrov", "Smirnov", "Volkov", "Kuznetsov", "Sokolov", "Popov", "Morozov"],
  [BALTIC, "Radvila", "Sapieha", "Goštautas"],
  [IBERIAN, "Garcia", "Rodriguez", "Martinez", "Fernandez", "Silva", "Ferreira", "Pereira", "Costa", "Mendoza", "Almeida"],
  [BRITISH, "Adams", "Anderson", "Baker", "Clarke", "Fraser", "Mackenzie", "Taylor", "Wallace"],
]);

// The non-medieval pool: cosmopolitan European given names, nicknames drawn
// from ordinary objects, surnames worn as first names, real common nouns worn
// as names (Watership Down's rabbits are named after English words, mostly
// plants; Strong/Brick/Red/Domino/Ivy/Ghost/Rook are each a real character's
// actual given name, not a nickname, in Fallout 4, Borderlands, Transistor,
// Marvel, DC, Call of Duty and Dragon Age: The Veilguard respectively), and a
// large batch of RimWorld colonist nicknames — sourced from a fan-maintained
// list of backer-submitted names (rimworldwiki.com/wiki/User:Paintsimmon/
// NameinGame), which is why this batch in particular reads as "found," not
// designed. Ravenheart is a city people arrive in, and a name that doesn't
// match the local register is a character detail rather than a mistake.
//
// These carry no region — they are the leakage, so pairing them with a
// regional surname is the whole point (see randomCharacterName). The Witcher
// pool below is the one exception: it pairs with its own surnames instead,
// since "Olgierd Kowalski" reads as a mismatch this pool doesn't otherwise
// have to worry about.
//
// A handful of the common nouns and RimWorld nicknames read as gender-neutral
// in their source material (a rabbit called Fiver has no gender the word
// itself implies), so rather than invent a third pool they are simply listed
// in both arrays below — the same trick poolsFor()'s "Person" branch already
// relies on.
//
// This block used to be pasted twice, byte-identical, into FLAVOUR_MALE and
// FLAVOUR_FEMALE. Kept here as its own array instead so the next batch of
// gender-neutral nicknames only needs adding once — don't re-inline it.
function freezeNames(names) {
  return Object.freeze(names.map((name) => Object.freeze({ name, region: null })));
}

const FLAVOUR_NEUTRAL_NAMES = [
  "Bastion", "Blade", "Bomb", "Bond", "Bones", "Bookworm", "Boomer", "Boots", "Bramble", "Bravo",
  "Bubbles", "Buck", "Buddy", "Bugsy", "Bull", "Buster", "Butcher", "Cadet", "Cake", "Cannon",
  "Canyon", "Cash", "Castle", "Chef", "Chief", "Chili", "Chopper", "Cobra", "Coffee", "Colonel",
  "Comrade", "Cookie", "Cornbread", "Corporal", "Cosmic", "Dagger", "Dapper", "Dash", "Diesel", "Duke",
  "Echo", "Falcon", "Ferret", "Flint", "Fox", "Fury", "Hammer", "Havoc", "Hawk", "Honey",
  "Hound", "Husky", "Justice", "Legend", "Lucky", "Lynx", "Maestro", "Magpie", "Mantis", "Maverick",
  "Meerkat", "Nova", "Ocelot", "Onyx", "Peaches", "Pepper", "Phoenix", "Pickle", "Possum", "Preacher",
  "Puma", "Raccoon", "Ranger", "Rebel", "Reckless", "Rogue", "Rowdy", "Rutabaga", "Sarge", "Scout",
  "Sensei", "Shadow", "Shark", "Sharp", "Skipper", "Slate", "Smokey", "Spark", "Sparrow", "Static",
  "Storm", "Swift", "Thistle", "Thunder", "Toucan", "Turtle", "Weasel", "Wolf", "Wombat", "Zero",
  // Kenshi's shared male/female name column (kenshi.fandom.com/wiki/Random_Names_List) —
  // short found-object names, same register as the batch above.
  "Bark", "Burn", "Claw", "Dirt", "Fade", "Fish", "Flick", "Gecko", "Gills", "Hex",
  "Ice", "Knife", "Patch", "Plank", "Ribs", "Saint", "Sand", "Scratch", "Slick", "Spade",
  "Squint", "Stone", "Stork", "Streak", "Twitch",
  // More backer-submitted RimWorld colonist nicknames from the same
  // Paintsimmon list, plus the initials DJ/VV/AJ/MJ/TJ, which pair with a
  // regional surname the same way any other flavour name does.
  "Rusty", "Trigger", "Moth", "Snake", "Wingnut", "Tweak", "Pyro", "Shorty", "Shrike", "Stalker",
  "Laser", "Steel", "Twig", "Killjoy", "Doom", "Snow", "Blue", "Ginger", "Styx", "Ninja",
  "DJ", "VV", "AJ", "MJ", "TJ",
];

const FLAVOUR_MALE = freezeNames([
  "Ernö", "Santiago", "Aurel", "Zoltán", "Kasimir", "Stellan",
  "Emeric", "Tibor", "Rui", "Nikodem", "Marek", "Cosmin",
  "Cog", "Sprite", "Kid", "Bishop",
  "Codsworth", "Freeman", "Rockatansky", "Halloway",
  "Bigwig", "Buckthorn", "Woundwort", "Strong", "Brick", "Rook", "Ghost", "Scooter", "Domino",
  "Fiver", "Pipkin", "Blackberry", "Dandelion", "Silver", "Acorn",
  // Kenshi's male-only column (kenshi.fandom.com/wiki/Random_Names_List).
  "Arkh", "Barth", "Brecht", "Carp", "Garr", "Harp", "Hesric", "Krup", "Nines",
  "Stenn", "Thoke", "Voth", "Zepp", "Zimm",
  ...FLAVOUR_NEUTRAL_NAMES,
]);

const FLAVOUR_FEMALE = freezeNames([
  "Klaasje", "Marienne", "Annika", "Ilse", "Zsóka", "Věra",
  "Renata", "Solveig", "Pilar", "Nadia", "Lenka", "Mirela",
  "Kit", "Pip", "Dita", "Bibi",
  "Holly", "Clover", "Bluebell", "Ivy", "Red",
  "Fiver", "Pipkin", "Blackberry", "Dandelion", "Silver", "Acorn",
  "Osgood", "Vermeer", "Ashby",
  // Kenshi's female-only column (kenshi.fandom.com/wiki/Random_Names_List).
  "Adi", "Kat", "Liff", "Nat", "Nei", "Pins", "Rin", "Slink", "Trepp", "Wish",
  ...FLAVOUR_NEUTRAL_NAMES,
]);

// Tags a given name as belonging to the Witcher batch below, so
// randomCharacterName knows to reach for FLAVOUR_WITCHER_SURNAMES instead of a
// medieval one. Never appears on a MEDIEVAL_SURNAMES row, so the region-match
// filter in randomCharacterName can never accidentally select it.
const WITCHER = "witcher";

// Verified individually against the character wiki rather than assumed: all
// three are Hearts of Stone (DLC) characters. Kept as its own labeled category
// rather than folded into the cosmopolitan rows above, since CD Projekt Red's
// IP isn't the kind of thing to bulk-import — this is the same "borrow a
// handful of named characters" move as Codsworth/Freeman/Rockatansky above,
// just kept visibly separate.
const FLAVOUR_WITCHER = Object.freeze(
  ["Olgierd", "Vlodimir", "Gaunter"].map((name) => Object.freeze({ name, region: WITCHER })),
);
const FLAVOUR_WITCHER_SURNAMES = Object.freeze(["von Everec", "O'Dimm"]);

const NAME_CORPUS = Object.freeze({
  medieval: Object.freeze({
    male: MEDIEVAL_MALE,
    female: MEDIEVAL_FEMALE,
    surnames: MEDIEVAL_SURNAMES,
  }),
  flavour: Object.freeze({
    male: FLAVOUR_MALE,
    female: FLAVOUR_FEMALE,
    witcher: FLAVOUR_WITCHER,
  }),
});

// How often a roll reaches for the flavour pool instead of the medieval one.
// One in three leans into the Kenshi/RimWorld nickname register without
// making it the house style outright.
const FLAVOUR_CHANCE = 1 / 3;

// Of a flavour roll, how often it narrows further to the three-name Witcher
// batch. Nested under FLAVOUR_CHANCE rather than a top-level chance of its own
// — three names getting equal billing with the ~180-entry cosmopolitan/noun
// pools would make Olgierd absurdly overrepresented. Dropped from 1/6 to 1/10
// when FLAVOUR_CHANCE went up, so the Witcher batch's absolute rate holds
// roughly steady rather than becoming more common along with everything else.
const WITCHER_SHARE_OF_FLAVOUR = 1 / 10;

// How often a medieval given name is paired with a surname from a different
// region. Ravenheart is a destination — Migrants literally arrive on the
// Railroad — so a mismatched name should happen, just not by default.
const CROSS_REGION_CHANCE = 0.15;

// Which given-name pool a character's gender implies. Reads Character.gender
// directly — it used to be inferred from whichever title they happened to wear,
// so an untitled character or a Captain drew from both pools whoever they were.
function poolsFor(gender, medieval) {
  switch (gender) {
    case "MAN":
      return medieval ? [MEDIEVAL_MALE] : [FLAVOUR_MALE];
    case "WOMAN":
      return medieval ? [MEDIEVAL_FEMALE] : [FLAVOUR_FEMALE];
    // NEUTRAL draws from both, which is the honest answer rather than a
    // fallback — there is no third corpus to reach for.
    default:
      return medieval ? [MEDIEVAL_MALE, MEDIEVAL_FEMALE] : [FLAVOUR_MALE, FLAVOUR_FEMALE];
  }
}

/**
 * One rolled name. `random` is injectable for the same reason
 * web/lib/portrait/catalog.js#randomSelection takes it — it is the seam that
 * makes the distribution testable without stubbing globals.
 *
 * Returns `{ firstName, lastName }`. `lastName` is null when `lastNameLocked`,
 * so a Baron-family character keeps the dynasty surname the Baron chose; the
 * caller simply doesn't write it (the disabled input is only a hint — see
 * db/lib/dynasty.js).
 */
function randomCharacterName({ gender = "NEUTRAL", random = Math.random, lastNameLocked = false } = {}) {
  const pick = (arr) => arr[Math.floor(random() * arr.length)];

  const useFlavour = random() < FLAVOUR_CHANCE;
  // The three Witcher names are all masculine, so this narrowing only ever
  // applies on a flavour roll that isn't for a woman — same posture as every
  // other name in this file staying inside its implied gender.
  const useWitcher = useFlavour && gender !== "WOMAN" && random() < WITCHER_SHARE_OF_FLAVOUR;
  const given = useWitcher ? pick(FLAVOUR_WITCHER) : pick(pick(poolsFor(gender, !useFlavour)));

  if (lastNameLocked) return { firstName: given.name, lastName: null };

  if (given.region === WITCHER) {
    return { firstName: given.name, lastName: pick(FLAVOUR_WITCHER_SURNAMES) };
  }

  // A flavour given name carries no region, so it always takes the cross-region
  // path — which is the intent: an outsider's name over a local surname.
  const matching =
    given.region && random() >= CROSS_REGION_CHANCE
      ? MEDIEVAL_SURNAMES.filter((s) => s.region === given.region)
      : [];

  // Every region currently carries surnames, so the fallback is unreachable —
  // it exists so adding a given-name region without surnames degrades to a
  // cross-region pairing rather than returning `undefined` into a form field.
  return {
    firstName: given.name,
    lastName: pick(matching.length ? matching : MEDIEVAL_SURNAMES).name,
  };
}

module.exports = {
  NAME_CORPUS,
  FLAVOUR_CHANCE,
  CROSS_REGION_CHANCE,
  WITCHER_SHARE_OF_FLAVOUR,
  randomCharacterName,
};
