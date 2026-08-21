// Faction Leader/Treasurer authority — who may manage a faction's Silo, and
// (the same thing) who may see how many Resources its members are holding.
//
// This lives in db/lib rather than web/lib because both faces of the game ask
// the question: the web app on /faction, and the bot on the 🔍 inspect
// reaction (bot/src/events/messageReactionAdd.js). web/lib/factionPermissions
// is a thin re-export that binds the singleton prisma, so web call sites keep
// the shorter (discordUserId, factionId) signature.
//
// Takes `prisma` as a parameter rather than require("../index") — same reason
// as dm.js/turnAnnouncement.js — and is deliberately NOT spread into the
// db/index.js barrel; require it by path.

// Silo management (viewing withdrawal history, transferring resources out,
// seeing member Resources) is available to a faction's Leader and Treasurer —
// plain booleans on Character (see faction/actions.js#setFactionLeader /
// setTreasurer), so a Treasurer without the isLeader flag still qualifies.
async function getMyFactionRole(prisma, discordUserId, factionId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      factionId: true,
      isLeader: true,
      isTreasurer: true,
    },
  });

  if (!character || character.factionId !== factionId) {
    return { character, isLeader: false, isTreasurer: false, canManageSilo: false };
  }

  const { isLeader, isTreasurer } = character;
  return { character, isLeader, isTreasurer, canManageSilo: isLeader || isTreasurer };
}

// Walks parentFactionId up to the root, returning ancestor faction IDs
// nearest-first. Visited-set guards against a cycle slipping through despite
// the write-side check in gm/dev/actions.js#updateFaction.
async function getFactionAncestorIds(prisma, factionId) {
  const ids = [];
  const seen = new Set([factionId]);
  let currentId = factionId;
  while (currentId) {
    const current = await prisma.faction.findUnique({
      where: { id: currentId },
      select: { parentFactionId: true },
    });
    if (!current?.parentFactionId || seen.has(current.parentFactionId)) break;
    ids.push(current.parentFactionId);
    seen.add(current.parentFactionId);
    currentId = current.parentFactionId;
  }
  return ids;
}

// Silo access for a *target* faction, which may not be the character's own —
// a parent faction's Leader or Treasurer can manage a subject faction's Silo
// (one-directional: only ancestors of the target qualify, never siblings or
// descendants), matching getMyFactionRole's same-faction Leader-or-Treasurer
// rule for the character's own faction.
async function getSiloAccess(prisma, discordUserId, targetFactionId) {
  const own = await getMyFactionRole(prisma, discordUserId, targetFactionId);
  if (!own.character) return { character: null, canManageSilo: false, isOwnFaction: false };

  if (own.character.factionId === targetFactionId) {
    return { character: own.character, canManageSilo: own.canManageSilo, isOwnFaction: true };
  }

  if (!own.character.factionId) return { character: own.character, canManageSilo: false, isOwnFaction: false };

  const ancestorIds = await getFactionAncestorIds(prisma, targetFactionId);
  if (!ancestorIds.includes(own.character.factionId)) {
    return { character: own.character, canManageSilo: false, isOwnFaction: false };
  }

  const atAncestor = await getMyFactionRole(prisma, discordUserId, own.character.factionId);
  return { character: own.character, canManageSilo: atAncestor.canManageSilo, isOwnFaction: false };
}

module.exports = { getMyFactionRole, getFactionAncestorIds, getSiloAccess };
