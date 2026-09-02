const HUNGER_SLUG = "hungry";
const HUNGERLESS_SLUG = "hungerless";
const DYING_SLUG = "dying";
const NOBILITY_SLUG = "nobility";
const COURTIER_SLUG = "courtier";
const ATE_MEAL_SLUG = "ate-meal";
const MORTUS_SLUG = "mortus";
const DRAINED_SLUG = "drained";
const EXHAUSTED_SLUG = "exhausted";
const LABORER_BASIC_SLUG = "laborer-basic";
const LABORER_SKILLED_SLUG = "laborer-skilled";
const LABORER_FARMING_SLUG = "laborer-farming";
const CATATONIC_SLUG = "catatonic-afk";
const DISAPPOINTED_SLUG = "disappointed";

// The one "read someone else's sheet" tag — see db/lib/inspectVision.js, the
// only reader. This is the Demoness Seductive, not its general-category cousin
// Empathetic (`empathetic`), which is deliberately NOT here; nor is
// Mindreading, the Succubus Draught's grant. Both of those read a Desire on a
// Gambit after a conversation, which no code adjudicates.
const SEDUCTIVE_DEMONESS_SLUG = "demoness-seductive";

// The counter to both of the above, read off the SUBJECT rather than the
// viewer — see db/lib/inspectVision.js.
const INSCRUTABLE_SLUG = "inscrutable";


// Consumed with everything a Rite: Rage caster examines — see
// db/lib/inspectVision.js. Read off the REACTOR, same posture as Seductive.
const RAGE_SLUG = "rage";

// A ZONE slug, not a tag: the Fortress holds the Lifeweb tower and the PA
// system, so two separate rules gate on standing there.
const FORTRESS_SLUG = "fortress";

// #leave — the GM-only channel departure alerts and catatonic deaths post to.
// A channel ID, hardcoded for the same reason db/lib/roleIds.js hardcodes its
// role IDs: Bascinet runs in a single guild, the ID is not a secret, and a
// missing env var here would fail silently — a leave nobody hears about.
// Lives in db/ rather than the bot because the turn engine's side-effect
// thunk (db/index.js) posts death alerts to it too.
const LEAVE_ANNOUNCE_CHANNEL_ID = "1540014692926361651";

module.exports = {
  FORTRESS_SLUG,
  LEAVE_ANNOUNCE_CHANNEL_ID,
  HUNGER_SLUG,
  HUNGERLESS_SLUG,
  DYING_SLUG,
  NOBILITY_SLUG,
  COURTIER_SLUG,
  ATE_MEAL_SLUG,
  MORTUS_SLUG,
  DRAINED_SLUG,
  EXHAUSTED_SLUG,
  LABORER_BASIC_SLUG,
  LABORER_SKILLED_SLUG,
  LABORER_FARMING_SLUG,
  CATATONIC_SLUG,
  DISAPPOINTED_SLUG,
  SEDUCTIVE_DEMONESS_SLUG,
  INSCRUTABLE_SLUG,
  RAGE_SLUG,
};
