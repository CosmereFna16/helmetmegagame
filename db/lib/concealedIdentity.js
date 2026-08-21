// The anonymous identity a character posts under when they use `/conceal`
// (see bot/src/events/messageCreate.js). Pure — no prisma, no I/O — same
// posture as db/lib/characterName.js, whose HONORIFICS list this mirrors.
//
// The alias deliberately carries only what a stranger could tell at a glance:
// roughly how old someone looks, and how they present. Everything else — the
// name, the appearance, the faction — is what concealing is for.

const { HONORIFICS } = require("./characterName");

// Under YOUNG you read as young, at OLD and above you read as old, and the
// broad middle gets no adjective at all — which is what makes the word mean
// something when it does appear.
const YOUNG_UNDER = 25;
const OLD_FROM = 55;

// Honorifics that read as a man or a woman. Everything else — rank and
// profession, which say nothing about the wearer — falls through to Person,
// as does having picked no honorific at all.
const MAN = ["Mr.", "Master", "Sir", "Lord", "Baron", "Father", "Brother"];
const WOMAN = ["Mrs.", "Ms.", "Dame", "Lady", "Baroness", "Mother", "Sister"];

function genderWord(honorific) {
  const h = (honorific ?? "").trim();
  if (MAN.includes(h)) return "Man";
  if (WOMAN.includes(h)) return "Woman";
  return "Person";
}

function ageWord(age) {
  if (typeof age !== "number" || Number.isNaN(age)) return null;
  if (age < YOUNG_UNDER) return "Young";
  if (age >= OLD_FROM) return "Old";
  return null;
}

// "Young Man" / "Old Woman" / "Person". Used as the webhook username, so it
// is Title Case and comfortably inside Discord's 80-char cap.
function concealedAlias({ age, honorific } = {}) {
  return [ageWord(age), genderWord(honorific)].filter(Boolean).join(" ");
}

// The line shown when someone 🔍-inspects a concealed message. Lower-cased
// mid-sentence: "An unknown young woman, their identity concealed."
function concealedLine(alias) {
  return `An unknown ${(alias || "person").toLowerCase()}, their identity concealed.`;
}

// Every honorific must resolve to a deliberate word — this is the guard against
// db/lib/characterName.js gaining an entry that silently reads as "Person".
// Exported rather than run at require time so a startup can't be taken down by
// a catalog edit; the test suite and the tag sync call it.
function assertHonorificsCovered() {
  const uncovered = HONORIFICS.filter(
    (h) => !MAN.includes(h) && !WOMAN.includes(h) && genderWord(h) !== "Person",
  );
  if (uncovered.length) {
    throw new Error(`concealedIdentity: unmapped honorifics: ${uncovered.join(", ")}`);
  }
  return true;
}

module.exports = {
  YOUNG_UNDER,
  OLD_FROM,
  concealedAlias,
  concealedLine,
  genderWord,
  ageWord,
  assertHonorificsCovered,
};
