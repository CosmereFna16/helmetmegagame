// The anonymous identity a character posts under when they use `/conceal`
// (see bot/src/events/messageCreate.js). Pure — no prisma, no I/O — same
// posture as db/lib/characterName.js.
//
// The alias deliberately carries only what a stranger could tell at a glance:
// roughly how old someone looks, and how they present. Everything else — the
// name, the appearance, the faction — is what concealing is for.

const { genderOf } = require("./titles");

// Under YOUNG you read as young, at OLD and above you read as old, and the
// broad middle gets no adjective at all — which is what makes the word mean
// something when it does appear.
const YOUNG_UNDER = 25;
const OLD_FROM = 55;

// A title's gender reading is a property of the WORD, and it is declared once
// in db/lib/titles.js beside the word itself. This used to be two arrays here
// that had to be edited in lockstep with that catalog — miss one and a new
// title silently read as "Person" with nothing to catch it.
//
// Rank and profession say nothing about the wearer, so Captain, Doctor and
// Master are all "neutral" and land on Person, as does having no title.
function genderWord(honorific) {
  const gender = genderOf(honorific);
  if (gender === "man") return "Man";
  if (gender === "woman") return "Woman";
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

module.exports = {
  YOUNG_UNDER,
  OLD_FROM,
  concealedAlias,
  concealedLine,
  genderWord,
  ageWord,
};
