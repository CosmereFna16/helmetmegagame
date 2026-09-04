// Thin prisma-binding shim over db/lib/factionPermissions.js, which is the
// real home of this logic now that the bot needs it too (the 🔍 inspect
// reaction shows member Resources to a faction's Leader/Treasurer). Same
// pattern bot/src/lib/resourceDelta.js uses over db/lib/resourceDelta.js —
// web call sites keep the shorter signature and never pass prisma.
import { prisma } from "@lifeweb/db";
import * as shared from "@lifeweb/db/lib/factionPermissions";

export function getMyFactionRole(discordUserId, factionId) {
  return shared.getMyFactionRole(prisma, discordUserId, factionId);
}

export function getFactionAncestorIds(factionId) {
  return shared.getFactionAncestorIds(prisma, factionId);
}
