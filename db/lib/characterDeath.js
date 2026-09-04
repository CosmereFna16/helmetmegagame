// The DATABASE half of a character's death — shared so the two death paths
// can't drift: web/lib/discordGuild.js#killCharacter (a GM's Kill button, the
// lethal-outcome request path) and db/lib/catatonicDeathPass.js (the turn
// engine's one auto-kill). Each caller keeps its own Discord half — the web
// one inline, the pass via returned side effects — but what death *means* on
// the row is decided here, once.
//
// Takes `prisma` as the first parameter (the db/lib/dm.js convention) and is
// deliberately NOT on the @lifeweb/db barrel; require it by path.
const { recordArchiveEvent } = require("./archive");
const { mintCorpse } = require("./corpseMint");
const { cancelOffersForCharacter } = require("./lessons");

// Marks one character DEAD. Returns { claimed } — false when the character
// was no longer ALIVE, in which case NOTHING else was written: the update's
// own `status: "ALIVE"` where-clause is the claim, so two racing callers (or
// a resumed turn re-running the death pass) can never half-kill or
// double-archive the same character. `expectStatus` exists for the web path,
// which calls this a moment AFTER updateCharacterRaw already wrote DEAD.
//
// What it does when it claims: status DEAD, discordRoleId nulled (the caller
// must capture the role id FIRST — it still owes Discord the role delete),
// catatonicSinceTurn nulled (a corpse has no countdown), every equipped tag
// unequipped (a corpse doesn't wield things — frees the equip slots for a
// Revive and keeps the loot panel honest), and one DEATH row in the
// transcript. `content` is the archive line; `turn` pins the archive row to a
// specific turn (the death pass hands the closing turn) rather than whatever
// happens to be open.
//
// Returns `corpse` alongside `claimed` — { tag, room } — so a caller that owes
// Discord an announcement knows which Room the body landed in. `room` is null
// when it stayed on the dead sheet for want of a public room to fall in.
async function applyDeathToRow(prisma, character, { turn = null, content = null, expectStatus = "ALIVE" } = {}) {
  const claimed = await prisma.character.updateMany({
    where: { id: character.id, status: expectStatus },
    data: { status: "DEAD", discordRoleId: null, catatonicSinceTurn: null },
  });
  if (claimed.count === 0) return { claimed: false };

  await prisma.characterTag
    .updateMany({ where: { characterId: character.id, equipped: true }, data: { equipped: false } })
    .catch((err) => console.error(`Failed to unequip on death for ${character.id}:`, err));

  // A pending handshake either way is void, and a half-made thing stays
  // half-made (docs/systemdocs/LESSONS.md, CRAFTING.md). An ACCEPTED lesson
  // still resolves — it happened when it was accepted.
  await cancelOffersForCharacter(prisma, character.id).catch((err) =>
    console.error(`Failed to void offers on death for ${character.id}:`, err),
  );
  // The same rule for a faction handshake (FACTIONS.md): an application or an
  // invitation nobody can answer any more is withdrawn rather than left in a
  // queue for an officer to trip over.
  await prisma.factionApplication
    .updateMany({
      where: { characterId: character.id, status: "PENDING" },
      data: { status: "WITHDRAWN", decidedAt: new Date() },
    })
    .catch((err) => console.error(`Failed to void faction applications on death for ${character.id}:`, err));
  await prisma.craftProject
    .updateMany({ where: { characterId: character.id, status: "ACTIVE" }, data: { status: "CANCELLED" } })
    .catch((err) => console.error(`Failed to cancel craft projects on death for ${character.id}:`, err));

  // The body itself, as a real object: one Tag row, dropped into a random
  // public Room at the Location they fell in (docs/systemdocs/CORPSES.md). It
  // is a HANDLE to this sheet, not a container — nothing moves off the row, so
  // LOOT_CHARACTER is unaffected — but from here on the sheet follows the tag,
  // which is what makes a body draggable by carrying it.
  //
  // Wrapped, and deliberately after the claim: a catalog that has not been
  // synced yet must not turn a death into a throw. A missing corpse is
  // recoverable by hand; a half-applied death is not.
  const corpse = await mintCorpse(prisma, character, turn).catch((err) => {
    console.error(`Failed to mint a corpse for ${character.id}:`, err);
    return { tag: null, room: null };
  });

  // recordArchiveEvent already swallows its own failures (a lost transcript
  // line must never abort a death), so no catch here.
  await recordArchiveEvent(prisma, {
    kind: "DEATH",
    character,
    turn,
    zoneId: character.zoneId ?? null,
    content: content ?? `${character.name} died.`,
  });

  return { claimed: true, corpse };
}

module.exports = { applyDeathToRow };
