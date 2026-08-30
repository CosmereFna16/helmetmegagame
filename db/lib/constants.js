const HUNGER_SLUG = "hunger";
const HUNGERLESS_SLUG = "hungerless";
const DYING_SLUG = "dying";
const NOBILITY_SLUG = "nobility";
const COURTIER_SLUG = "courtier";
const ATE_MEAL_SLUG = "ate-meal";
const MORTUS_SLUG = "mortus";
const DRAINED_SLUG = "drained";
const LABORER_BASIC_SLUG = "laborer-basic";
const LABORER_SKILLED_SLUG = "laborer-skilled";
const LABORER_FARMING_SLUG = "laborer-farming";
const CATATONIC_SLUG = "catatonic";

// The one "read someone else's sheet" tag — see db/lib/inspectVision.js, the
// only reader. This is the Demoness Seductive, not its general-category cousin
// Empathetic (slug `seductive`), which is deliberately NOT here; nor is
// Mindreading, the Succubus Draught's grant. Both of those read a Desire on a
// Gambit after a conversation, which no code adjudicates.
const SEDUCTIVE_DEMONESS_SLUG = "seductive-demoness";

// The counter to both of the above, read off the SUBJECT rather than the
// viewer — see db/lib/inspectVision.js.
const INSCRUTABLE_SLUG = "inscrutable";


// Consumed with everything a Rite: Rage caster examines — see
// db/lib/inspectVision.js. Read off the REACTOR, same posture as Seductive.
const RAGE_SLUG = "rage";

// A ZONE slug, not a tag: the Fortress holds the Lifeweb tower and the PA
// system, so two separate rules gate on standing there.
const FORTRESS_SLUG = "fortress";

module.exports = {
  FORTRESS_SLUG,
  HUNGER_SLUG,
  HUNGERLESS_SLUG,
  DYING_SLUG,
  NOBILITY_SLUG,
  COURTIER_SLUG,
  ATE_MEAL_SLUG,
  MORTUS_SLUG,
  DRAINED_SLUG,
  LABORER_BASIC_SLUG,
  LABORER_SKILLED_SLUG,
  LABORER_FARMING_SLUG,
  CATATONIC_SLUG,
  SEDUCTIVE_DEMONESS_SLUG,
  INSCRUTABLE_SLUG,
  RAGE_SLUG,
};
