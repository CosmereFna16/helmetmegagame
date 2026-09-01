// A living character who can't defend themselves or walk away — the target
// class for LOOT_CHARACTER, HARM_CHARACTER and the "or helpless" branch of
// MOVE_CHARACTER (REQUESTS.md, TAGS.md §5c). Slugs here must exist in
// docs/tags.yaml; each is either a health affliction that already means
// "can't act" (dying, paralyzed) or the AFK/status equivalent (catatonic,
// bound). Catatonic also carries a death countdown now — held for
// GameConfig.catatonicDeathTurns turns straight, the character dies at turn
// close (db/lib/catatonicDeathPass.js) — and covers players who left the
// guild, not just the idle (db/lib/playerDeparture.js).
//
// Also read on the afflicted character's own side: db/lib/defaultMovePass.js
// skips filing a standing Default Move for anyone holding one of these. That
// is why "can't act" has to stay literally true of every slug added here —
// adding one without checking that it belongs on the acting side too would
// silently cancel someone's default for the wrong reason.
const INCAPACITATING_SLUGS = new Set(["dying", "catatonic", "paralyzed", "bound"]);

// The narrower set HARM_CHARACTER's lethal half needs, and the reason it is
// narrower matters more than it used to: that half kills outright now
// (REQUESTS.md §5b), so this gate is the whole of what stands between a player
// and another player's character. There is no GM confirmation behind it.
//
// Being Paralyzed for a turn is a moment's stumble — you can rob someone in
// that state, but not finish them off. Dying and Bound are the classic
// helpless body: someone put them there, in the fiction, and somebody else can
// cut them loose or treat them before the blow lands.
//
// `catatonic` is deliberately NOT here, and was briefly added and then pulled
// back out. It reads as helplessness but it isn't: it means the player is AFK
// or has left the guild. Letting it through would make "your player stopped
// logging in" a thing another player can convert into a dead character on the
// spot, with nobody in the loop — and the engine already has its own answer
// for that case, on its own clock and its own dial
// (db/lib/catatonicDeathPass.js). A Catatonic body can still be dragged and
// robbed; INCAPACITATING_SLUGS above is what governs that.
const FINISHABLE_SLUGS = new Set(["dying", "bound"]);

module.exports = { INCAPACITATING_SLUGS, FINISHABLE_SLUGS };
