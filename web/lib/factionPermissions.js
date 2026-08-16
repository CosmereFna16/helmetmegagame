import { prisma, LEADER_SLUG, TREASURER_SLUG } from "@lifeweb/db";

// Silo management (viewing withdrawal history, transferring resources out)
// is available to a faction's Leader and Treasurer — checked via the tags
// granted alongside those roles (see faction/actions.js#setFactionLeader /
// setTreasurer), not just Character.isLeader, so a Treasurer without the
// isLeader flag still qualifies.
export async function getMyFactionRole(discordUserId, factionId) {
  const character = await prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      factionId: true,
      isLeader: true,
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });

  if (!character || character.factionId !== factionId) {
    return { character, isLeader: false, isTreasurer: false, canManageSilo: false };
  }

  const slugs = new Set(character.tags.map((ct) => ct.tag.slug).filter(Boolean));
  const isLeader = character.isLeader || slugs.has(LEADER_SLUG);
  const isTreasurer = slugs.has(TREASURER_SLUG);
  return { character, isLeader, isTreasurer, canManageSilo: isLeader || isTreasurer };
}

// Walks parentFactionId up to the root, returning ancestor faction IDs
// nearest-first. Visited-set guards against a cycle slipping through despite
// the write-side check in gm/dev/actions.js#updateFaction.
export async function getFactionAncestorIds(factionId) {
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
export async function getSiloAccess(discordUserId, targetFactionId) {
  const own = await getMyFactionRole(discordUserId, targetFactionId);
  if (!own.character) return { character: null, canManageSilo: false, isOwnFaction: false };

  if (own.character.factionId === targetFactionId) {
    return { character: own.character, canManageSilo: own.canManageSilo, isOwnFaction: true };
  }

  if (!own.character.factionId) return { character: own.character, canManageSilo: false, isOwnFaction: false };

  const ancestorIds = await getFactionAncestorIds(targetFactionId);
  if (!ancestorIds.includes(own.character.factionId)) {
    return { character: own.character, canManageSilo: false, isOwnFaction: false };
  }

  const atAncestor = await getMyFactionRole(discordUserId, own.character.factionId);
  return { character: own.character, canManageSilo: atAncestor.canManageSilo, isOwnFaction: false };
}
