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

// The narrower set HARM_CHARACTER's lethal half needs. Being Paralyzed for a
// turn is a moment's stumble — you can rob someone in that state, but they
// are not someone a player may finish off. Dying, Bound and
// Catatonic all are: the first two are the classic helpless body, and a
// Catatonic character is either long gone from the guild or has been silent
// for turns on end, with their own death countdown already running. This set
// is what makes the kill safe: HARM_CHARACTER's lethal half kills outright now
// (REQUESTS.md §5b), so what stands between a player and another player's
// character is this gate, not a GM's later confirmation.
const FINISHABLE_SLUGS = new Set(["dying", "bound", "catatonic"]);

module.exports = { INCAPACITATING_SLUGS, FINISHABLE_SLUGS };
