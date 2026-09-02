// The pool the "Randomize" button and the /character Bio panel draw from.
// Kept in code, not YAML, so a client component can import it. Pure: no
// prisma, no node: builtins, no I/O.

// Central/Eastern European, Iberian, and British given names and surnames
// from OpenXcom's SoldierName/*.nam files (GPL-3.0).
const SLAVIC_WEST = "slavic-west"; // Polish, Czech, Slovak
const HUNGARIAN = "hungarian";
const ROMANIAN = "romanian";
const SLAVIC_SOUTH = "slavic-south";
const RUTHENIAN = "ruthenian";
const BALTIC = "baltic";
const IBERIAN = "iberian";
const BRITISH = "british";

// `[region, ...names]` rows, expanded below.
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

// The non-medieval pool: cosmopolitan given names and object/noun
// nicknames, including RimWorld colonist nicknames
// (rimworldwiki.com/wiki/User:Paintsimmon/NameinGame). These carry no
// region — pairing with a regional surname is the point. The Witcher pool
// below pairs with its own surnames instead.
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
  // Kenshi's shared male/female column (kenshi.fandom.com/wiki/Random_Names_List).
  "Bark", "Burn", "Claw", "Dirt", "Fade", "Fish", "Flick", "Gecko", "Gills", "Hex",
  "Ice", "Knife", "Patch", "Plank", "Ribs", "Saint", "Sand", "Scratch", "Slick", "Spade",
  "Squint", "Stone", "Stork", "Streak", "Twitch",
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
  // Kenshi's male-only column.
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
  // Kenshi's female-only column.
  "Adi", "Kat", "Liff", "Nat", "Nei", "Pins", "Rin", "Slink", "Trepp", "Wish",
  ...FLAVOUR_NEUTRAL_NAMES,
]);

// Tags a given name as belonging to the Witcher batch, so
// randomCharacterName reaches for FLAVOUR_WITCHER_SURNAMES instead of a
// medieval one.
const WITCHER = "witcher";

// Three Hearts of Stone (DLC) characters, kept as their own category.
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
const FLAVOUR_CHANCE = 1 / 3;

// Of a flavour roll, how often it narrows to the three-name Witcher batch.
const WITCHER_SHARE_OF_FLAVOUR = 1 / 10;

// How often a medieval given name is paired with a surname from a
// different region.
const CROSS_REGION_CHANCE = 0.15;

// Which given-name pool a character's gender implies.
function poolsFor(gender, medieval) {
  switch (gender) {
    case "MAN":
      return medieval ? [MEDIEVAL_MALE] : [FLAVOUR_MALE];
    case "WOMAN":
      return medieval ? [MEDIEVAL_FEMALE] : [FLAVOUR_FEMALE];
    // NEUTRAL draws from both.
    default:
      return medieval ? [MEDIEVAL_MALE, MEDIEVAL_FEMALE] : [FLAVOUR_MALE, FLAVOUR_FEMALE];
  }
}

/**
 * One rolled name. `random` is injectable so the distribution is testable
 * without stubbing globals. Returns `{ firstName, lastName }`; `lastName` is
 * null when `lastNameLocked` (see db/lib/dynasty.js).
 */
function randomCharacterName({ gender = "NEUTRAL", random = Math.random, lastNameLocked = false } = {}) {
  const pick = (arr) => arr[Math.floor(random() * arr.length)];

  const useFlavour = random() < FLAVOUR_CHANCE;
  // The three Witcher names are all masculine.
  const useWitcher = useFlavour && gender !== "WOMAN" && random() < WITCHER_SHARE_OF_FLAVOUR;
  const given = useWitcher ? pick(FLAVOUR_WITCHER) : pick(pick(poolsFor(gender, !useFlavour)));

  if (lastNameLocked) return { firstName: given.name, lastName: null };

  if (given.region === WITCHER) {
    return { firstName: given.name, lastName: pick(FLAVOUR_WITCHER_SURNAMES) };
  }

  // A flavour name carries no region, so it always takes the cross-region path.
  const matching =
    given.region && random() >= CROSS_REGION_CHANCE
      ? MEDIEVAL_SURNAMES.filter((s) => s.region === given.region)
      : [];

  // Fallback is currently unreachable; guards a future region with no surnames.
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
