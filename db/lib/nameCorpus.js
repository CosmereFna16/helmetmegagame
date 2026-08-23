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
// wide margin (longest given name 11, longest surname 9, against caps of 24 and
// 20) — so nothing downstream ever silently truncates a generated name.
//
// Register: Central and Eastern European first, then Iberian, a few Italian, a
// few British. Recognisable rather than archaic, and deliberately not the
// Thorne/Locke dark-fantasy register. The surnames mix noble houses with trade
// and descriptive names on purpose, so one pool serves both a Baron and a
// miner.

const { genderWord } = require("./concealedIdentity");

// Region tags exist only so a generated name can be internally coherent —
// "Zsigmond Nádasdy" reads like a person, "Zsigmond Ataíde" reads like a random
// generator. See randomCharacterName's CROSS_REGION_CHANCE for the exception.
const SLAVIC_WEST = "slavic-west"; // Polish, Czech, Slovak
const HUNGARIAN = "hungarian";
const ROMANIAN = "romanian";
const SLAVIC_SOUTH = "slavic-south";
const RUTHENIAN = "ruthenian";
const BALTIC = "baltic";
const IBERIAN = "iberian";
const ITALIAN = "italian";
const BRITISH = "british";

// Written as `[region, ...names]` rows and expanded below rather than repeating
// the region on all 150 entries, which was unreadable and easy to mis-tag.
function expand(rows) {
  return Object.freeze(
    rows.flatMap(([region, ...names]) => names.map((name) => Object.freeze({ name, region }))),
  );
}

const MEDIEVAL_MALE = expand([
  [SLAVIC_WEST, "Miłosz", "Racław", "Bolesław", "Wojciech", "Kazimierz", "Vojtěch", "Zdeněk", "Jaromír", "Vratislav", "Oldřich"],
  [HUNGARIAN, "Béla", "Géza", "Levente", "Kálmán", "Zsigmond", "Endre", "Farkas"],
  [ROMANIAN, "Vlad", "Radu", "Mircea", "Bogdan", "Dragoș"],
  [SLAVIC_SOUTH, "Vuk", "Miloš", "Lazar", "Nemanja", "Uroš", "Tomislav"],
  [RUTHENIAN, "Yaroslav", "Sviatoslav", "Mstislav", "Gleb", "Oleg"],
  [BALTIC, "Mindaugas", "Gediminas", "Vytautas", "Kęstutis"],
  [IBERIAN, "Rodrigo", "Sancho", "Ramiro", "Íñigo", "Nuno", "Vasco"],
  [ITALIAN, "Cosimo", "Baldassare", "Rinaldo", "Guido"],
  [BRITISH, "Wat", "Osbert", "Rowland"],
]);

const MEDIEVAL_FEMALE = expand([
  [SLAVIC_WEST, "Jadwiga", "Dobrawa", "Ludmiła", "Bożena", "Zofia", "Blažena", "Vlasta", "Květa", "Milena"],
  [HUNGARIAN, "Ilona", "Piroska", "Erzsébet", "Margit", "Emese", "Csenge", "Tünde"],
  [ROMANIAN, "Ruxandra", "Ileana", "Domnica", "Stanca", "Anca"],
  [SLAVIC_SOUTH, "Jelena", "Milica", "Danica", "Ružica", "Simonida", "Vesna"],
  [RUTHENIAN, "Olga", "Predslava", "Zbyslava", "Marfa", "Vasilisa"],
  [BALTIC, "Birutė", "Aldona", "Danutė", "Gražina"],
  [IBERIAN, "Urraca", "Sancha", "Berenguela", "Mencía", "Elvira", "Constança"],
  [ITALIAN, "Bianca", "Lucrezia", "Ginevra", "Fiammetta", "Isotta"],
  [BRITISH, "Maud", "Avice", "Cecily"],
]);

const MEDIEVAL_SURNAMES = expand([
  [SLAVIC_WEST, "Ostroróg", "Nałęcz", "Rawicz", "Sobieski", "Czarnecki", "Bednarz", "Kowal", "Žižka", "Rožmberk", "Šternberk", "Kolowrat", "Sedlák", "Krejčí", "Dvořák"],
  [HUNGARIAN, "Hunyadi", "Báthory", "Szapolyai", "Zrínyi", "Nádasdy", "Kovács", "Varga", "Molnár"],
  [ROMANIAN, "Basarab", "Movilă", "Cantemir", "Ciobanu", "Morar"],
  [SLAVIC_SOUTH, "Frankopan", "Šubić", "Kosača", "Branković", "Nemanjić"],
  [RUTHENIAN, "Volkov", "Morozov", "Shuisky", "Kurbsky", "Golitsyn"],
  [BALTIC, "Radvila", "Sapieha", "Goštautas"],
  [IBERIAN, "Mendoza", "Guzmán", "Osorio", "Pimentel", "Ataíde"],
  [ITALIAN, "Malatesta", "Baglioni", "Scaligeri"],
  [BRITISH, "Talbot", "Mowbray"],
]);

// The non-medieval pool: cosmopolitan European given names, nicknames drawn
// from ordinary objects, surnames worn as first names, and — the newest
// stripe — real common nouns worn as names, sourced from actual media rather
// than invented (Watership Down's rabbits are named after English words,
// mostly plants; Strong/Brick/Red/Domino/Ivy/Ghost/Rook are each a real
// character's actual given name, not a nickname, in Fallout 4, Borderlands,
// Transistor, Marvel, DC, Call of Duty and Dragon Age: The Veilguard
// respectively). Ravenheart is a city people arrive in, and a name that
// doesn't match the local register is a character detail rather than a
// mistake.
//
// These carry no region — they are the leakage, so pairing them with a
// regional surname is the whole point (see randomCharacterName).
//
// A handful of the common nouns read as gender-neutral in their source
// material (a rabbit called Fiver has no gender the word itself implies), so
// rather than invent a third pool they are simply listed in both arrays
// below — the same trick poolsFor()'s "Person" branch already relies on.
const FLAVOUR_MALE = Object.freeze(
  [
    "Ernö", "Santiago", "Aurel", "Zoltán", "Kasimir", "Stellan",
    "Emeric", "Tibor", "Rui", "Nikodem", "Marek", "Cosmin",
    "Cog", "Sprite", "Kid", "Bishop",
    "Codsworth", "Freeman", "Rockatansky", "Halloway",
    "Bigwig", "Buckthorn", "Woundwort", "Strong", "Brick", "Rook", "Ghost", "Scooter", "Domino",
    "Fiver", "Pipkin", "Blackberry", "Dandelion", "Silver", "Acorn",
  ].map((name) => Object.freeze({ name, region: null })),
);

const FLAVOUR_FEMALE = Object.freeze(
  [
    "Klaasje", "Marienne", "Annika", "Ilse", "Zsóka", "Věra",
    "Renata", "Solveig", "Pilar", "Nadia", "Lenka", "Mirela",
    "Kit", "Pip", "Birdie", "Dita", "Bibi",
    "Holly", "Clover", "Bluebell", "Ivy", "Red",
    "Fiver", "Pipkin", "Blackberry", "Dandelion", "Silver", "Acorn",
    "Osgood", "Vermeer", "Ashby",
  ].map((name) => Object.freeze({ name, region: null })),
);

const NAME_CORPUS = Object.freeze({
  medieval: Object.freeze({
    male: MEDIEVAL_MALE,
    female: MEDIEVAL_FEMALE,
    surnames: MEDIEVAL_SURNAMES,
  }),
  flavour: Object.freeze({
    male: FLAVOUR_MALE,
    female: FLAVOUR_FEMALE,
  }),
});

// How often a roll reaches for the flavour pool instead of the medieval one.
// One in five keeps the button worth pressing again without making the odd
// names the house style.
const FLAVOUR_CHANCE = 0.2;

// How often a medieval given name is paired with a surname from a different
// region. Ravenheart is a destination — Migrants literally arrive on the
// Railroad — so a mismatched name should happen, just not by default.
const CROSS_REGION_CHANCE = 0.15;

// Which given-name pool an honorific implies. Deliberately delegates to
// db/lib/concealedIdentity.js#genderWord rather than restating its MAN/WOMAN
// lists: one rule in the codebase, and a new honorific added to HONORIFICS
// starts working in both places at once.
function poolsFor(honorific, medieval) {
  switch (genderWord(honorific)) {
    case "Man":
      return medieval ? [MEDIEVAL_MALE] : [FLAVOUR_MALE];
    case "Woman":
      return medieval ? [MEDIEVAL_FEMALE] : [FLAVOUR_FEMALE];
    // Rank and profession honorifics ("Captain", "Doctor"), and having picked
    // none at all, say nothing about the wearer — so draw from either.
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
function randomCharacterName({ honorific = null, random = Math.random, lastNameLocked = false } = {}) {
  const pick = (arr) => arr[Math.floor(random() * arr.length)];

  const useFlavour = random() < FLAVOUR_CHANCE;
  const given = pick(pick(poolsFor(honorific, !useFlavour)));

  if (lastNameLocked) return { firstName: given.name, lastName: null };

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
  randomCharacterName,
};
