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
