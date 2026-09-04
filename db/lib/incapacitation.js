// A living character who can't defend themselves or walk away — the target
// class for LOOT_CHARACTER, HARM_CHARACTER and the "or helpless" branch of
// MOVE_CHARACTER (REQUESTS.md, TAGS.md §5c). Slugs here must exist in
// docs/tags.yaml. Catatonic carries a death countdown
// (GameConfig.catatonicDeathTurns, db/lib/catatonicDeathPass.js) and also
// covers players who left the guild (db/lib/playerDeparture.js).
//
// db/lib/autoLaborPass.js skips filing an auto-Labor for anyone holding
// one of these slugs — "can't act" must stay literally true of every slug here.
// `seizure` is what eating a Squeeze cube does to you for a turn: you cannot
// walk, and anyone standing over you can carry you off. It is deliberately NOT
// in FINISHABLE_SLUGS below — nobody asked for executing the man on the floor.
const INCAPACITATING_SLUGS = new Set(["dying", "catatonic-afk", "paralyzed", "bound", "seizure"]);

// The narrower set HARM_CHARACTER's lethal half uses: that half kills
// outright with no GM confirmation (REQUESTS.md §5b), so this gate is the
// whole of what stands between a player and another player's character.
// Catatonic is deliberately excluded — it means AFK or departed, not
// helpless, and the engine kills those on its own clock
// (db/lib/catatonicDeathPass.js). A Catatonic body can still be dragged and
// robbed; INCAPACITATING_SLUGS above governs that.
const FINISHABLE_SLUGS = new Set(["dying", "bound"]);

module.exports = { INCAPACITATING_SLUGS, FINISHABLE_SLUGS };
