"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGmSession, sendDm } from "@/lib/discordGuild";
import { UserError, guarded } from "@/lib/actionResult";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { getOpenTurn } from "@/lib/turn";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new UserError("Not authenticated.");
  if (!gm) throw new UserError("Not authorized.");
  return session;
}

// Resolves a caller-supplied `discordUserId` OR `characterId` into the
// player's Discord id. Never trust a posted discordUserId for anything but
// this lookup shape — every action below re-derives everything it needs from
// the DB, never from the client's claim about who it's talking to.
async function resolvePlayerDiscordUserId({ discordUserId, characterId }) {
  if (discordUserId) return String(discordUserId);
  if (characterId) {
    const character = await prisma.character.findUnique({
      where: { id: String(characterId) },
      select: { discordUserId: true },
    });
    if (!character) throw new UserError("That character no longer exists.");
    return character.discordUserId;
  }
  throw new UserError("No conversation specified.");
}

const TAKE_DEFAULT = 100;

// Keyset-paged thread page, newest-first cursor then reversed to chronological
// order for the thread view. `take` defaults to the tail (100); ThreadPane's
// "load older" bumps beforeMs/beforeId back through history a page at a time.
export async function getDmThreadPage({ discordUserId, characterId, beforeMs, beforeId, take = TAKE_DEFAULT }) {
  return guarded(async () => {
    await requireGm();
    const playerDiscordUserId = await resolvePlayerDiscordUserId({ discordUserId, characterId });
    const takeN = Math.min(Math.max(1, Number(take) || TAKE_DEFAULT), 200);

    const where = { discordUserId: playerDiscordUserId };
    if (beforeMs) {
      const beforeDate = new Date(Number(beforeMs));
      where.OR = [
        { createdAt: { lt: beforeDate } },
        beforeId ? { createdAt: beforeDate, id: { lt: String(beforeId) } } : undefined,
      ].filter(Boolean);
    }

    const rows = await prisma.directMessage.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: takeN + 1,
    });
    const hasMore = rows.length > takeN;
    const messages = rows.slice(0, takeN).reverse();
    return { messages, hasMore };
  });
}

const ALLOWED_SEND_SOURCES = new Set(["gm_reply", "gm_inspector"]);

export async function sendGmDm({ discordUserId, characterId, content, source = "gm_reply" }) {
  return guarded(async () => {
    const session = await requireGm();
    const playerDiscordUserId = await resolvePlayerDiscordUserId({ discordUserId, characterId });

    const message = content?.toString().trim();
    if (!message) throw new UserError("Write something to send.");
    if (message.length > GM_MESSAGE_MAX_LENGTH) {
      throw new UserError(`That message is too long (max ${GM_MESSAGE_MAX_LENGTH} characters).`);
    }
    const resolvedSource = ALLOWED_SEND_SOURCES.has(source) ? source : "gm_reply";

    await sendDm(playerDiscordUserId, message, {
      authorDiscordUserId: session.discordUserId,
      source: resolvedSource,
    });

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_dm_reply",
        details: { discordUserId: playerDiscordUserId, message },
      },
    });

    // Sending a reply implies you've read up to now — stamp the sender's own
    // read cursor so the thread doesn't show as unread to the GM who just
    // answered it.
    await prisma.conversationRead
      .upsert({
        where: {
          gmDiscordUserId_playerDiscordUserId: {
            gmDiscordUserId: session.discordUserId,
            playerDiscordUserId,
          },
        },
        update: { lastReadAt: new Date() },
        create: {
          gmDiscordUserId: session.discordUserId,
          playerDiscordUserId,
          lastReadAt: new Date(),
        },
      })
      .catch(() => {});

    revalidatePath("/gm/messages");
    revalidatePath(`/gm/messages/${playerDiscordUserId}`);

    const page = await getDmThreadPage({ discordUserId: playerDiscordUserId });
    return page.ok ? { messages: page.messages, hasMore: page.hasMore } : { messages: [], hasMore: false };
  });
}

export async function markConversationRead({ playerDiscordUserId }) {
  return guarded(async () => {
    const session = await requireGm();
    const id = playerDiscordUserId?.toString().trim();
    if (!id) throw new UserError("No conversation specified.");

    await prisma.conversationRead.upsert({
      where: {
        gmDiscordUserId_playerDiscordUserId: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: id },
      },
      update: { lastReadAt: new Date() },
      create: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: id, lastReadAt: new Date() },
    });

    revalidatePath("/gm/messages");
  });
}

export async function markConversationUnread({ playerDiscordUserId }) {
  return guarded(async () => {
    const session = await requireGm();
    const id = playerDiscordUserId?.toString().trim();
    if (!id) throw new UserError("No conversation specified.");

    // Backdated rather than deleted — a far-past cursor reads as "everything
    // inbound is unread" without a special-cased "no row" branch downstream.
    await prisma.conversationRead.upsert({
      where: {
        gmDiscordUserId_playerDiscordUserId: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: id },
      },
      update: { lastReadAt: new Date(0) },
      create: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: id, lastReadAt: new Date(0) },
    });

    revalidatePath("/gm/messages");
  });
}

export async function claimConversation({ playerDiscordUserId }) {
  return guarded(async () => {
    const session = await requireGm();
    const id = playerDiscordUserId?.toString().trim();
    if (!id) throw new UserError("No conversation specified.");

    await prisma.conversationMeta.upsert({
      where: { playerDiscordUserId: id },
      update: { claimedByDiscordUserId: session.discordUserId, claimedAt: new Date() },
      create: { playerDiscordUserId: id, claimedByDiscordUserId: session.discordUserId, claimedAt: new Date() },
    });

    revalidatePath("/gm/messages");
  });
}

export async function releaseConversation({ playerDiscordUserId }) {
  return guarded(async () => {
    await requireGm();
    const id = playerDiscordUserId?.toString().trim();
    if (!id) throw new UserError("No conversation specified.");

    await prisma.conversationMeta
      .update({
        where: { playerDiscordUserId: id },
        data: { claimedByDiscordUserId: null, claimedAt: null },
      })
      .catch(() => {}); // no row yet — already "released"

    revalidatePath("/gm/messages");
  });
}

// ---------------------------------------------------------------------------
// CanonPanel: stage a DM as a turn-end message instead of sending it now.
// Mirrors createStagedMessageImpl's PRIVATE-kind validation shape
// (web/app/(desk)/gm/turns/actions.js) so a message staged from the inbox
// looks and behaves exactly like one staged from the adjudication desk.
// ---------------------------------------------------------------------------

export async function stageDmAsMessage({ characterId, content }) {
  return guarded(async () => {
    const session = await requireGm();
    const id = characterId?.toString().trim();
    if (!id) throw new UserError("No character specified.");

    const character = await prisma.character.findUnique({ where: { id } });
    if (!character) throw new UserError("That character no longer exists.");
    if (character.status !== "ALIVE") throw new UserError("That character isn't alive.");

    const text = content?.toString().trim() ?? "";
    if (!text) throw new UserError("Write the message first.");
    if (text.length > GM_MESSAGE_MAX_LENGTH) {
      throw new UserError(`Messages cap at ${GM_MESSAGE_MAX_LENGTH} characters.`);
    }

    const openTurn = await getOpenTurn();
    if (!openTurn) throw new UserError("No turn is open.");

    const row = await prisma.stagedMessage.create({
      data: {
        turnId: openTurn.id,
        kind: "PRIVATE",
        content: text,
        createdByDiscordUserId: session.discordUserId,
        recipients: { create: [{ characterId: id }] },
      },
    });

    // The turn-boundary race, same as the desk's retargetIfTurnClosed: a row
    // created in the seconds around the cron can land on a turn the push
    // already swept. Re-read after the insert and retarget to the new open
    // turn; anything that still slips through is the tray banner's job.
    const still = await prisma.turn.findFirst({ where: { id: openTurn.id, status: "OPEN" } });
    if (!still) {
      const fresh = await prisma.turn.findFirst({ where: { status: "OPEN" } });
      if (fresh) {
        await prisma.stagedMessage.update({ where: { id: row.id }, data: { turnId: fresh.id } });
      }
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "staged_message_created",
        details: { stagedMessageId: row.id, kind: "PRIVATE", moveId: null, recipients: 1, via: "gm_inbox" },
      },
    });

    revalidatePath(`/gm/messages/${character.discordUserId}`);
    revalidatePath("/gm/turns");

    return { id: row.id, content: text, createdAt: row.createdAt.toISOString() };
  });
}

// ---------------------------------------------------------------------------
// BulkComposer broadcast — consolidated here from web/app/(app)/gm/actions.js
// (sendGmMessage/deliverGmMessage), same delivery discipline: sequential
// sends deferred to after() per ARCHITECTURE.md §5, never a fan-out against
// Discord's rate limiter.
// ---------------------------------------------------------------------------

async function deliverGmBroadcast(actorDiscordUserId, recipients, message) {
  const failed = [];

  for (const recipient of recipients) {
    try {
      await sendDm(recipient.discordUserId, message, {
        authorDiscordUserId: actorDiscordUserId,
        source: "gm_broadcast",
      });
    } catch (err) {
      console.error(`GM broadcast to ${recipient.name} (${recipient.discordUserId}) failed:`, err);
      failed.push({ characterId: recipient.id, name: recipient.name, discordUserId: recipient.discordUserId });
    }
  }

  if (failed.length > 0) {
    await prisma.auditLog
      .create({
        data: {
          actorDiscordUserId,
          actionType: "gm_message_delivery_failed",
          details: { failed, failedCount: failed.length, totalCount: recipients.length, message },
        },
      })
      .catch((err) => console.error("Could not record GM broadcast delivery failures:", err));
  }

  // Always written, success or not — this is what the last-broadcast banner
  // reads to show "N sent · M failed" without guessing from the two
  // conditional rows above.
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId,
        actionType: "gm_message_delivered",
        details: { total: recipients.length, failedCount: failed.length },
      },
    })
    .catch((err) => console.error("Could not record GM broadcast delivery summary:", err));
}

export async function sendGmBroadcast({ characterIds, message }) {
  return guarded(async () => {
    const session = await requireGm();

    const ids = [...new Set((characterIds ?? []).map(String).filter(Boolean))];
    if (!ids.length) throw new UserError("Select at least one recipient.");

    const text = message?.toString().trim() ?? "";
    if (!text) throw new UserError("Write something to send.");
    if (text.length > GM_MESSAGE_MAX_LENGTH) {
      throw new UserError(`That message is too long (max ${GM_MESSAGE_MAX_LENGTH} characters).`);
    }

    const recipients = await prisma.character.findMany({
      where: { id: { in: ids }, status: "ALIVE" },
      select: { id: true, name: true, discordUserId: true },
    });
    if (!recipients.length) throw new UserError("None of those characters are alive.");

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_message_sent",
        details: { characterIds: recipients.map((r) => r.id), message: text, recipientCount: recipients.length },
      },
    });

    revalidatePath("/gm/messages");
    revalidatePath("/gm/players");
    revalidatePath("/gm/turns");

    after(() =>
      deliverGmBroadcast(session.discordUserId, recipients, text).catch((err) =>
        console.error("GM broadcast delivery failed:", err),
      ),
    );

    return { recipientCount: recipients.length };
  });
}
