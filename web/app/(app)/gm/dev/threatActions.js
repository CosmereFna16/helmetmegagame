"use server";

// The two threat verbs, behind /gm/dev?s=assignments.
//
// ASSIGN hands a seat to a character who already exists: its tags, its points,
// its blurb. SPAWN offers a whole new character to somebody who has none — it
// writes the offer and DMs the buttons; the accept lands in the bot, because
// a DM has no guild (bot/src/lib/threatSpawn.js).
//
// Both re-check everything the UI already checked. A server action is a public
// endpoint, and a hidden button is a hint, not a lock.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { threatBySlug } from "@lifeweb/db/lib/threats";
import { resolveAssignTags, spawnOfferComponents } from "@lifeweb/db/lib/threatSpawn";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { sendDm } from "@/lib/discordGuild";

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

function repaint() {
  revalidatePath("/gm/dev");
  revalidatePath("/gm/players", "layout");
}

// The DM a newly-seated threat reads. One ‡ for the whole message, at the very
// end — the blurb lines are Bascinet's own words and carry none of their own,
// except the one Demoness line still waiting on a rewrite.
function seatMessage(threat, { spawned = false } = {}) {
  const opening = spawned
    ? `You have been offered a seat: the ${threat.name}.`
    : `You are now the ${threat.name}!`;
  const tail = spawned
    ? "Accept and you arrive immediately. Decline and nothing happens."
    : "Check your tags and documents.";
  return [opening, ...(threat.blurb ?? []), tail].join("\n");
}

// Hands an existing character a seat. Any threat, opted in or not — consent is
// a GM's judgement call, and the opt-in column is there to inform it, not to
// gate it.
export async function assignThreat({ characterId, threatSlug }) {
  let session;
  try {
    session = await requireSuperadmin();
  } catch {
    return { error: "Not authorized." };
  }

  const threat = threatBySlug(threatSlug);
  if (!threat?.assignable) return { error: "That isn't an assignable threat." };

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, name: true, discordUserId: true, status: true },
  });
  if (!character) return { error: "That character no longer exists." };
  if (character.status !== "ALIVE") {
    return { error: `${character.name} isn't alive. Spawn a new character instead.` };
  }

  // Already seated? Refuse rather than run again. The tag upsert below is
  // idempotent but the point grant is NOT — a second press would quietly hand
  // over another 7 or 17 points, and a double-click is the likeliest way this
  // button gets pressed twice.
  if (threat.seatTagSlug) {
    const held = await prisma.characterTag.count({
      where: { characterId: character.id, tag: { slug: threat.seatTagSlug } },
    });
    if (held > 0) return { error: `${character.name} is already the ${threat.name}.` };
  }

  const resolved = await resolveAssignTags(prisma, threat);
  if (resolved.error) return { error: resolved.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  // Stamped before the transaction, since a tag with a catalog duration must
  // arrive already carrying expiresTurn.
  const rows = [];
  for (const { tag, quantity } of resolved.tags) {
    rows.push({
      tagId: tag.id,
      name: tag.name,
      quantity: tag.stackable ? quantity : 1,
      expiresTurn: await expiryForGrant(prisma, tag, openTurn, { where: "assignThreat" }),
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      // Upsert rather than create: a GM may have granted the seat tag by hand
      // already, and a duplicate would violate the (characterId, tagId) unique.
      await tx.characterTag.upsert({
        where: { characterId_tagId: { characterId: character.id, tagId: row.tagId } },
        update: {},
        create: {
          characterId: character.id,
          tagId: row.tagId,
          source: "GM_GRANT",
          quantity: row.quantity,
          expiresTurn: row.expiresTurn,
        },
      });
    }
    if (threat.assign?.tagPoints) {
      await tx.character.update({
        where: { id: character.id },
        data: { tagPoints: { increment: threat.assign.tagPoints } },
      });
    }
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "threat_assigned",
        targetCharacterId: character.id,
        details: {
          threat: threat.name,
          tagPoints: threat.assign?.tagPoints ?? 0,
          tags: rows.map((r) => r.name),
        },
      },
    });
  });

  // Post-commit: the DM must never cost the grant. sendDm applies the » prefix,
  // splits past 2000 characters and logs to DirectMessage, so /gm/messages
  // shows the whole thing.
  after(async () => {
    await sendDm(character.discordUserId, seatMessage(threat), {
      authorDiscordUserId: session.discordUserId,
      source: "threat_assign",
    }).catch((err) => console.error("Threat assign DM failed:", err));
  });

  repaint();
  return { ok: true, threat: threat.name, tags: rows.map((r) => r.name) };
}

// Offers a seat to somebody with no character. Writes the row, DMs the buttons.
export async function offerThreatSpawn({ discordUserId, threatSlug, roleId, locationId }) {
  let session;
  try {
    session = await requireSuperadmin();
  } catch {
    return { error: "Not authorized." };
  }

  const threat = threatBySlug(threatSlug);
  if (!threat?.spawn) return { error: "That threat can't be spawned." };
  if (!discordUserId) return { error: "Pick somebody to offer it to." };

  const wantedRoleSlug = threat.spawn.roleSlug ?? null;
  const role = wantedRoleSlug
    ? await prisma.role.findUnique({ where: { slug: wantedRoleSlug } })
    : roleId
      ? await prisma.role.findUnique({ where: { id: roleId } })
      : null;
  if (!role) return { error: "Pick a starting role." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    return { error: "They already have a living character. Assign the seat instead." };
  }
  if (await prisma.threatSpawn.findFirst({ where: { discordUserId, status: "PENDING" } })) {
    return { error: "They already have an offer waiting. Cancel it first." };
  }

  // Falls back to the role's own start; null only if the role has none either.
  const finalLocationId = locationId || role.startingLocationId || null;

  const spawn = await prisma.threatSpawn.create({
    data: {
      discordUserId,
      threatSlug: threat.slug,
      roleId: role.id,
      locationId: finalLocationId,
      offeredBy: session.discordUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "threat_spawn_offered",
      details: { threat: threat.name, discordUserId, role: role.name },
    },
  });

  const sent = await sendDm(discordUserId, seatMessage(threat, { spawned: true }), {
    authorDiscordUserId: session.discordUserId,
    source: "threat_spawn_offer",
    components: spawnOfferComponents(spawn.id),
  }).catch((err) => {
    console.error("Threat spawn offer DM failed:", err);
    return null;
  });

  // An offer nobody can see is worse than none: roll it back so the GM can
  // retry rather than leaving a live row with no buttons behind it.
  if (!sent) {
    await prisma.threatSpawn.update({
      where: { id: spawn.id },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });
    repaint();
    return { error: "Couldn't DM them — their DMs may be closed. Nothing was offered." };
  }

  repaint();
  return { ok: true, threat: threat.name, role: role.name };
}

export async function cancelThreatSpawn({ spawnId }) {
  let session;
  try {
    session = await requireSuperadmin();
  } catch {
    return { error: "Not authorized." };
  }

  const spawn = await prisma.threatSpawn.findUnique({ where: { id: spawnId } });
  if (!spawn) return { error: "That offer no longer exists." };
  if (spawn.status !== "PENDING") return { error: "That offer has already been answered." };

  await prisma.threatSpawn.update({
    where: { id: spawn.id },
    data: { status: "CANCELLED", resolvedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "threat_spawn_cancelled",
      details: { threat: spawn.threatSlug, discordUserId: spawn.discordUserId },
    },
  });

  repaint();
  return { ok: true };
}
