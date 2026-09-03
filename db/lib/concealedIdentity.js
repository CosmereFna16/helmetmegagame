// The anonymous identity a character posts under when they use `/conceal`
// (see bot/src/events/messageCreate.js). Pure — no prisma, no I/O — same
// posture as db/lib/characterName.js.
//
// The alias deliberately carries only what a stranger could tell at a glance:
// roughly how old someone looks, and how they present. Everything else — the
// name, the appearance, the faction — is what concealing is for.


// Under YOUNG you read as young, at OLD and above you read as old, and the
// broad middle gets no adjective at all — which is what makes the word mean
// something when it does appear.
const YOUNG_UNDER = 25;
const OLD_FROM = 55;

// Straight off Character.gender. This used to be inferred from the title —
// first from two hardcoded MAN/WOMAN arrays here, then from a `gender` on each
// word — which meant an untitled character was always "Person" however they
// present, and that a Captain was too. A character carries their own gender
// now, so the alias can simply say it.
function genderWord(gender) {
  if (gender === "MAN") return "Man";
  if (gender === "WOMAN") return "Woman";
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
//
// Destructured off a whole Character row, which is what both call sites pass
// (bot/src/events/messageCreate.js, interactionCreate.js) — so moving from
// `honorific` to `gender` needed no change at either.
//
// The alias is frozen into ArchiveEntry.concealedAlias at send time, so a
// later gender change never rewrites history. That is correct: the archive
// records who someone was as they were known then.
function concealedAlias({ age, gender } = {}) {
  return [ageWord(age), genderWord(gender)].filter(Boolean).join(" ");
}

// The line shown when someone 🔍-inspects a concealed message. Lower-cased
// mid-sentence: "An unknown young woman, their identity concealed."
function concealedLine(alias) {
  return `An unknown ${(alias || "person").toLowerCase()}, their identity concealed.`;
}

// "a young man" / "an old woman" — the alias as a noun phrase for a line of
// prose. Shared by the whisper poll and the room stash announcements so the
// same person reads the same way in both.
function withArticle(word) {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

function capitalizeFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// "An old woman", ready to start a sentence.
function aliasSubject(character) {
  return capitalizeFirst(withArticle(concealedAlias(character ?? {}).toLowerCase()));
}

module.exports = {
  concealedAlias,
  concealedLine,
  genderWord,
  withArticle,
  capitalizeFirst,
  aliasSubject,
};
