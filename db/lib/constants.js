const HUNGER_SLUG = "hungry";
const HUNGERLESS_SLUG = "hungerless";
const DYING_SLUG = "dying";
const NOBILITY_SLUG = "nobility";
const COURTIER_SLUG = "courtier";
const ATE_MEAL_SLUG = "ate-meal";
const MORTUS_SLUG = "mortus";
const DRAINED_SLUG = "drained";
const EXHAUSTED_SLUG = "exhausted";
const LABORING_BASIC_SLUG = "laboring-basic";
const LABORING_SKILLED_SLUG = "laboring-skilled";
const LABORING_FARMING_SLUG = "laboring-farming";
const LABORING_HUNTING_SLUG = "laboring-hunting";
const LABORING_FISHING_SLUG = "laboring-fishing";
const CATATONIC_SLUG = "catatonic-afk";
const DISAPPOINTED_SLUG = "disappointed";
// Over a carry cap (db/lib/carry.js). Granted and cleared by settleCarry,
// never by a player; read by the travel gate in db/lib/locationTravel.js.
const OVERBURDENED_SLUG = "overburdened";

// Corpses (docs/systemdocs/CORPSES.md). CORPSE_GROUP_SLUG is the whole
// discriminator on the catalog side — the three monster corpses live in that
// group, and so does every "{name}'s Corpse" a death writes. BUTCHER_SLUG
// gates the Butcher button; ENGRAVE_RESOURCE_COST is what carving a stone for
// someone whose body you can't find costs.
const CORPSE_GROUP_SLUG = "items-corpse";
const BUTCHER_SLUG = "butcher";

// The two standing kits (db/lib/equipmentReach.js). Neither is worn: each is
// satisfied by HOLDING it or by standing where one is already set up, which is
// what makes a Sanctuary operating theatre and a Factory floor worth walking
// to. Workshop Equipment gates smithing and building; Surgical Equipment is
// +1 on a medical Gambit.
const WORKSHOP_EQUIPMENT_SLUG = "workshop-equipment";
// Packaging Equipment is the third standing kit, alongside the two above:
// having it in reach is what turns the Package button on. Unlike those two it
// is not craftable — there are exactly two in the world, one on the Godard
// Factory's Logistics Room floor and one in the Merchant's Cargo Bay.
const PACKAGING_EQUIPMENT_SLUG = "packaging-equipment";
// What one crate holds, and how long the line printed on its side may be.
// 150 lb is the number the Squeeze economy is balanced on: at 20 lb a cube
// that is 7 to a crate, 70 lb each, and a Horse-and-Cart takes 8 of them.
// See docs/systemdocs/FACTORY.md.
const PACKAGE_MAX_LBS = 150;
const PACKAGE_LABEL_MAX = 120;
const SURGICAL_EQUIPMENT_SLUG = "surgical-equipment";
const HUMAN_FLESH_SLUG = "human-flesh";
const ENGRAVE_RESOURCE_COST = 4;
// How many turns a person's corpse stays fresh before it turns. Monster
// corpses never rot — only a person stinks.
const CORPSE_ROT_TURNS = 3;

// The Teaching tree (docs/systemdocs/LESSONS.md). Holding Teaching lets you
// run a lesson; Lecturing widens one Routine to LECTURE_CAPACITY learners;
// a Drill Instructor's students succeed on a 4 when the skill's group is
// FIGHTING_GROUP_SLUG. Thresholds are the die's face after the modifier.
const TEACHING_SLUG = "teaching";
const LECTURING_SLUG = "teaching-lecturing";
const DRILL_INSTRUCTOR_SLUG = "teaching-drill-instructor";
const FIGHTING_GROUP_SLUG = "skills-fighting";
const LECTURE_CAPACITY = 3;
const LESSON_THRESHOLD = 5;
const DRILL_THRESHOLD = 4;

// The one "read someone else's sheet" tag — see db/lib/inspectVision.js, the
// only reader. This is the Demoness Seductive, not its general-category cousin
// Empathetic (`empathetic`), which is deliberately NOT here; nor is
// Mindreading, the Succubus Draught's grant. Both of those read a Desire on a
// Gambit after a conversation, which no code adjudicates.
const SEDUCTIVE_DEMONESS_SLUG = "demoness-seductive";

// The counter to both of the above, read off the SUBJECT rather than the
// viewer — see db/lib/inspectVision.js.
const INSCRUTABLE_SLUG = "inscrutable";

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
  LABORING_BASIC_SLUG,
  LABORING_SKILLED_SLUG,
  LABORING_FARMING_SLUG,
  LABORING_HUNTING_SLUG,
  LABORING_FISHING_SLUG,
  CATATONIC_SLUG,
  DISAPPOINTED_SLUG,
  OVERBURDENED_SLUG,
  CORPSE_GROUP_SLUG,
  BUTCHER_SLUG,
  WORKSHOP_EQUIPMENT_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
  PACKAGE_MAX_LBS,
  PACKAGE_LABEL_MAX,
  SURGICAL_EQUIPMENT_SLUG,
  HUMAN_FLESH_SLUG,
  ENGRAVE_RESOURCE_COST,
  CORPSE_ROT_TURNS,
  TEACHING_SLUG,
  LECTURING_SLUG,
  DRILL_INSTRUCTOR_SLUG,
  FIGHTING_GROUP_SLUG,
  LECTURE_CAPACITY,
  LESSON_THRESHOLD,
  DRILL_THRESHOLD,
  SEDUCTIVE_DEMONESS_SLUG,
  INSCRUTABLE_SLUG,
};
