// Faction Leader/Treasurer authority — who may see how many Resources a
// faction's members are holding. (Until 9/2026 the same pair managed the
// faction's Silo; Silos are gone, and this is what's left of the seat.)
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

// Seeing member Resources is available to a faction's Leader and Treasurer —
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
    return { character, isLeader: false, isTreasurer: false, isOfficer: false };
  }

  const { isLeader, isTreasurer } = character;
  return { character, isLeader, isTreasurer, isOfficer: isLeader || isTreasurer };
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

module.exports = { getMyFactionRole, getFactionAncestorIds };
