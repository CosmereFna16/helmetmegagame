// A living character who can't defend themselves or walk away — the target
// class for LOOT_CHARACTER, HARM_CHARACTER and the "or bound" branch of
// MOVE_CHARACTER (REQUESTS.md, TAGS.md §5c). Slugs here must exist in
// docs/tags.yaml; each is either a health affliction that already means
// "can't act" (dying, paralyzed) or the AFK/status equivalent (catatonic,
// bound).
const INCAPACITATING_SLUGS = new Set(["dying", "catatonic", "paralyzed", "bound"]);

// The narrower set HARM_CHARACTER's lethal half needs. Being Paralyzed for a
// turn or having gone quiet for four is not the same as lying there bleeding
// out or tied to a chair — you can rob someone in either state, but only the
// second is someone a player may ask a GM to finish off.
const FINISHABLE_SLUGS = new Set(["dying", "bound"]);

module.exports = { INCAPACITATING_SLUGS, FINISHABLE_SLUGS };
