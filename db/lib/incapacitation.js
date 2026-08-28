// A living character who can't defend themselves or walk away — the target
// class for LOOT_CHARACTER and the "or bound" branch of MOVE_CHARACTER
// (REQUESTS.md, TAGS.md §5c). Slugs here must exist in docs/tags.yaml; each
// is either a health affliction that already means "can't act" (dying,
// paralyzed) or the AFK/status equivalent (catatonic, bound).
const INCAPACITATING_SLUGS = new Set(["dying", "catatonic", "paralyzed", "bound"]);

module.exports = { INCAPACITATING_SLUGS };
