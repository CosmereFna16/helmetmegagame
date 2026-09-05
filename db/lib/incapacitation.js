// What a status tag takes away from you.
//
// This used to be one flat Set called INCAPACITATING_SLUGS, and that set was
// the only answer the game had to "can this character do this?". It worked
// for the physical half — a bound man does not swing a hammer — but it had
// nothing to say about the other half, so a Paralyzed character could shout
// across a Location and a Mute one could talk all day. {tag:mute} cost −7
// points and did not appear in a single line of code.
//
// So the set became a table. Each slug names the capabilities it removes, and
// everything else is derived from it, which is the point: the old set and a
// speech gate maintained separately would have drifted within a month.
//
// Two capabilities, because two is what the game actually distinguishes:
//
//   ACT    the physical half — equip, craft, destroy, labor, butcher, trade,
//          extract, teach, confess. "Can't act" must stay literally true of
//          every slug that blocks it, because db/lib/autoLaborPass.js skips
//          filing an auto-Labor for them.
//   SPEAK  the voice half — the proxy (ordinary chat, whispers, the Speak
//          modal), /shout, the Council Room intercom, a Bird reply.
//
// Deliberately NOT capabilities: seeing and hearing. Vision already has two
// homes that predate this file (db/lib/examineVision.js,
// db/lib/inspectVision.js) and answers a different question — what a surface
// will show you, not what you may do. Hearing cannot be modelled at all: a
// shout and the intercom are posted into shared Discord channels, and there
// is no way to hide a channel message from one member of it. {tag:deaf} is
// therefore enforced on the SENDING side only (it cannot work a radio,
// db/lib/intercom.js) and not hearing stays roleplay, as it always has.
const ACT = "ACT";
const SPEAK = "SPEAK";

// The table. A slug absent from here takes nothing away.
//
//   bound        can't act, CAN shout. Being tied up is the one state where
//                calling for help is the whole point, and a hostage nobody
//                can hear is a hostage nobody can rescue.
//   dying        can't act, CAN speak. Last words are the tradition.
//   catatonic-afk  can't act, CAN speak — and this one is not a taste call.
//                db/lib/catatonicPass.js DMs the player "it lifts the moment
//                you act or speak in character again", and lifts it off the
//                back of their activity clock. Gate their speech and they can
//                never clear it, and db/lib/catatonicDeathPass.js then kills
//                them for it. Catatonic must never block SPEAK.
//   paralyzed    both. Its description has promised "You can't move or talk"
//                since the day it was written; this is the first time the
//                second half has been true.
//   seizure      both. You are on the floor (docs/systemdocs/FACTORY.md).
//   unconscious  both. The top of the drinking ladder (BREWING.md).
//   mute         speech only. Acts normally — a mute smith is still a smith.
const RESTRICTIONS = {
  dying: [ACT],
  "catatonic-afk": [ACT],
  bound: [ACT],
  seizure: [ACT, SPEAK],
  paralyzed: [ACT, SPEAK],
  unconscious: [ACT, SPEAK],
  mute: [SPEAK],
};

// A living character who can't defend themselves or walk away — the target
// class for LOOT_CHARACTER, HARM_CHARACTER and the "or helpless" branch of
// MOVE_CHARACTER (REQUESTS.md, TAGS.md §5c). Slugs here must exist in
// docs/tags.yaml. Catatonic carries a death countdown
// (GameConfig.catatonicDeathTurns, db/lib/catatonicDeathPass.js) and also
// covers players who left the guild (db/lib/playerDeparture.js).
//
// DERIVED from the ACT column rather than written out again: helpless is
// exactly "cannot act", and two hand-maintained lists would disagree the
// first time somebody added a tag to one of them. {tag:mute} is the proof
// this is the right derivation — it is the one entry in the table that keeps
// its hands, and it correctly does not appear here.
const INCAPACITATING_SLUGS = new Set(
  Object.entries(RESTRICTIONS)
    .filter(([, caps]) => caps.includes(ACT))
    .map(([slug]) => slug),
);

// The narrower set HARM_CHARACTER's lethal half uses: that half kills
// outright with no GM confirmation (REQUESTS.md §5b), so this gate is the
// whole of what stands between a player and another player's character.
// Catatonic is deliberately excluded — it means AFK or departed, not
// helpless, and the engine kills those on its own clock
// (db/lib/catatonicDeathPass.js). A Catatonic body can still be dragged and
// robbed; INCAPACITATING_SLUGS above governs that.
//
// Hand-written, NOT derived: this is a shorter list on purpose, and every
// addition to it should cost somebody a deliberate keystroke. `seizure` is
// out because nobody asked for executing the man on the floor, and
// `unconscious` is out for the same reason — passing out in a tavern should
// not be a death sentence anyone can carry out without a GM.
const FINISHABLE_SLUGS = new Set(["dying", "bound"]);

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`)
// and tolerates a bare Tag[], matching db/lib/examineVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// The one question every gate asks. Returns the OFFENDING TAG rather than a
// boolean, so the caller can name it — "You're Bound." beats "You can't do
// that.", and a player who cannot see why they were refused files a GM ticket
// about it.
//
// Returns { slug, name } or null. `name` falls back to the slug for a caller
// that loaded tags without one.
//
// No assertCan() wrapper on top: the two faces need different failures — a
// thrown UserError on the web, a respond() in the bot — and a helper that
// threw would be wrong for one of them.
function blockerFor(characterTags, capability) {
  const held = slugSet(characterTags);
  for (const [slug, caps] of Object.entries(RESTRICTIONS)) {
    if (!caps.includes(capability) || !held.has(slug)) continue;
    const match = (characterTags ?? []).find((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
    return { slug, name: match?.tag?.name ?? match?.name ?? slug };
  }
  return null;
}

// Every slug that blocks a capability — for the bot's message-proxy query,
// which has to name the tags it wants in a `where` rather than loading them
// all on the hottest path in the game.
function slugsBlocking(capability) {
  return Object.entries(RESTRICTIONS)
    .filter(([, caps]) => caps.includes(capability))
    .map(([slug]) => slug);
}

module.exports = {
  ACT,
  SPEAK,
  RESTRICTIONS,
  INCAPACITATING_SLUGS,
  FINISHABLE_SLUGS,
  blockerFor,
  slugsBlocking,
};
