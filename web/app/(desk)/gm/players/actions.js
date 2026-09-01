"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGmSession, sendDm } from "@/lib/discordGuild";
import { UserError, guarded } from "@/lib/actionResult";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { getOpenTurn } from "@/lib/turn";
import { withoutDmNoise, dmNoiseSql } from "@/lib/dmThread";
import { MOVE_REVIEW_LABELS, moveKindLabel, rollLabel } from "@/lib/moves";
import { gmTransferResources } from "@/lib/gmTransfer";

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
      where: withoutDmNoise(where),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: takeN + 1,
    });
    const hasMore = rows.length > takeN;
    const messages = rows.slice(0, takeN).reverse();
    return { messages, hasMore };
  });
}

const ALLOWED_SEND_SOURCES = new Set(["gm_reply", "gm_inspector", "gm_dev_panel"]);

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

    // The Discord POST stays awaited: a GM has to know if the send itself
    // failed.
    const sent = await sendDm(playerDiscordUserId, message, {
      authorDiscordUserId: session.discordUserId,
      source: resolvedSource,
    });

    // The row sendDm just wrote, read back by the Discord message id it
    // stamped on it — never "the newest outbound row", which under a failed
    // log write or two GMs replying at once would hand back somebody else's
    // message to swap in for the optimistic placeholder. (sendDm returns the
    // Discord message, not the DirectMessage row, and swallows its own
    // create() failure — in which case `created` is null and the client
    // keeps its placeholder.)
    const created = sent?.id
      ? await prisma.directMessage.findFirst({ where: { discordMessageId: sent.id, direction: "OUTBOUND" } })
      : null;

    // Not deferred: the audit row is what /gm/audit exists for (a DM that
    // reached a player with no record of who sent it is the gap the log is
    // there to close), and the read cursor has to land BEFORE the layout
    // revalidation below or the thread the GM just answered flickers unread.
    // Sending a reply implies you have read up to now. Both are one indexed
    // write; the slowness was the Discord round trip plus a serial re-read,
    // and the client no longer waits on the latter to paint.
    await Promise.all([
      prisma.auditLog.create({
        data: {
          actorDiscordUserId: session.discordUserId,
          actionType: "gm_dm_reply",
          details: { discordUserId: playerDiscordUserId, message },
        },
      }),
      prisma.conversationRead
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
        .catch(() => {}),
    ]);

    // Revalidation has to happen inside the action, or the router never hears
    // about it — after() runs once the response is already gone.
    revalidatePath("/gm/players", "layout");
    revalidatePath(`/gm/players/${playerDiscordUserId}`);

    // The fresh page rides along with the one new row: it is the only path
    // that pulls in whatever the PLAYER said since the pane mounted (the
    // pane's state is seeded once, and a poll's router.refresh can't reseed
    // it), so a live back-and-forth keeps showing both sides.
    const page = await getDmThreadPage({ discordUserId: playerDiscordUserId });

    return { message: created, messages: page?.messages ?? null, hasMore: page?.hasMore ?? null };
  });
}

// Content search across every conversation, for the rail's search box. The
// fuzzy engine on the client only ever sees the ONE latest message per
// conversation (the preview), so "search my messages for the word barley"
// could not work at all — this is the other half of it: an ILIKE over the
// whole DirectMessage table with the same noise predicate the rail and the
// thread use, grouped per conversation.
//
// Returns counts and the newest match time per player; the rail merges these
// under its fuzzy hits rather than replacing them.
const CONVERSATION_SEARCH_LIMIT = 50;
const CONVERSATION_SEARCH_MIN = 3;

export async function searchConversations({ q }) {
  return guarded(async () => {
    await requireGm();
    const query = String(q ?? "").trim();
    if (query.length < CONVERSATION_SEARCH_MIN) return { hits: [] };

    // LIKE metacharacters escaped so a query containing % or _ searches for
    // those characters instead of turning into a wildcard. Backslash is
    // Postgres's default LIKE escape character, so no ESCAPE clause is needed.
    const pattern = `%${query.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

    const rows = await prisma.$queryRaw`
      SELECT dm."discordUserId",
             COUNT(*)::int AS "hits",
             MAX(dm."createdAt") AS "lastAt"
      FROM "DirectMessage" dm
      WHERE dm."content" ILIKE ${pattern}
        AND ${dmNoiseSql("dm")}
      GROUP BY dm."discordUserId"
      ORDER BY MAX(dm."createdAt") DESC
      LIMIT ${CONVERSATION_SEARCH_LIMIT}
    `;

    return {
      hits: rows.map((r) => ({
        discordUserId: r.discordUserId,
        hits: r.hits,
        lastAtMs: r.lastAt ? new Date(r.lastAt).getTime() : 0,
      })),
    };
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

    revalidatePath("/gm/players", "layout");
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

    revalidatePath("/gm/players", "layout");
  });
}

// The "no reply needed" mark. Desk-wide rather than per-GM, like the claim
// below: whether a conversation still wants an answer is a fact about the
// conversation, not one GM's taste. Stored as a stamp so it expires on its
// own — the rail only reads it as handled while it is at or after the
// conversation's last message (layout.js).
export async function setConversationHandled({ playerDiscordUserId, handled }) {
  return guarded(async () => {
    const session = await requireGm();
    const id = playerDiscordUserId?.toString().trim();
    if (!id) throw new UserError("No conversation specified.");

    const now = new Date();
    const handledAt = handled ? now : null;

    await prisma.conversationMeta.upsert({
      where: { playerDiscordUserId: id },
      update: { handledAt },
      create: { playerDiscordUserId: id, handledAt },
    });

    // Saying a conversation needs no reply implies having read it, and an
    // unread badge sitting on a handled row would contradict itself.
    if (handled) {
      await prisma.conversationRead.upsert({
        where: {
          gmDiscordUserId_playerDiscordUserId: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: id },
        },
        update: { lastReadAt: now },
        create: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: id, lastReadAt: now },
      });
    }

    revalidatePath("/gm/players", "layout");
  });
}

// The desk-side mute. Purely a view on this desk: the player is not blocked,
// silenced or told anything, and their DMs still arrive and still read
// normally. A muted conversation leaves the rail (behind its "Show muted"
// toggle), renders greyed when shown, and stops counting toward unread and
// awaiting. Unlike setConversationHandled above this does not expire — a
// mute is a standing decision, so it holds until a GM lifts it.
export async function setConversationMuted({ playerDiscordUserId, muted }) {
  return guarded(async () => {
    await requireGm();
    const id = playerDiscordUserId?.toString().trim();
    if (!id) throw new UserError("No conversation specified.");

    const mutedAt = muted ? new Date() : null;

    await prisma.conversationMeta.upsert({
      where: { playerDiscordUserId: id },
      update: { mutedAt },
      create: { playerDiscordUserId: id, mutedAt },
    });

    revalidatePath("/gm/players", "layout");
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

    revalidatePath("/gm/players", "layout");
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

    revalidatePath("/gm/players", "layout");
  });
}

// The Canon tab's own load, per character on demand — the shared inspector
// can look at anyone, including somebody who is not the open conversation, the
// same way its Sheet/Tags/Archive/DMs tabs do.

export async function getPlayerCanon({ characterId }) {
  return guarded(async () => {
    await requireGm();
    const id = String(characterId ?? "");
    if (!id) throw new UserError("No character specified.");

    const character = await prisma.character.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!character) throw new UserError("That character no longer exists.");

    const openTurn = await getOpenTurn();
    const [action, pendingRecipients, pendingEffects] = await Promise.all([
      openTurn
        ? prisma.action.findUnique({
            where: { characterId_turnId: { characterId: character.id, turnId: openTurn.id } },
          })
        : null,
      prisma.stagedMessageRecipient.findMany({
        where: { characterId: character.id, stagedMessage: { sentAt: null } },
        include: { stagedMessage: true },
        orderBy: { stagedMessage: { createdAt: "desc" } },
      }),
      prisma.stagedEffect.findMany({
        where: { targetCharacterId: character.id, appliedAt: null },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const tagIds = [
      ...new Set(
        pendingEffects.flatMap((e) => (e.payload?.tagOps ?? []).map((op) => op.tagId).filter(Boolean)),
      ),
    ];
    const tags = tagIds.length
      ? await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, name: true } })
      : [];

    return {
      canon: {
        characterId: character.id,
        characterName: character.name,
        move: action
          ? {
              id: action.id,
              description: action.description,
              kindLabel: moveKindLabel(action.moveKind, action.gmNotes),
              rollLabel: rollLabel(action),
              reviewLabel: MOVE_REVIEW_LABELS[action.moveReviewStatus] ?? "Open",
              resultMessage: action.resultMessage,
            }
          : null,
        pendingMessages: pendingRecipients.map((r) => ({
          id: r.stagedMessage.id,
          content: r.stagedMessage.content,
          createdAt: r.stagedMessage.createdAt.toISOString(),
        })),
        pendingEffects: pendingEffects.map((e) => ({ id: e.id, payload: e.payload })),
        tagNames: Object.fromEntries(tags.map((t) => [t.id, t.name])),
      },
    };
  });
}

// The Canon tab: stage a DM as a turn-end message instead of sending it now.
// Mirrors createStagedMessageImpl's PRIVATE-kind validation shape
// (web/app/(desk)/gm/turns/actions.js) so a message staged from the inbox
// looks and behaves exactly like one staged from the adjudication desk.

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

    revalidatePath(`/gm/players/${character.discordUserId}`);
    revalidatePath(TURNS_PATH, "page");

    return { id: row.id, content: text, createdAt: row.createdAt.toISOString() };
  });
}

// BulkComposer broadcast. Same delivery discipline as the rest of the desk:
// sequential sends deferred to after() per ARCHITECTURE.md §5, never a
// fan-out against Discord's rate limiter.

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

    revalidatePath("/gm/players", "layout");
    revalidatePath(TURNS_PATH, "page");

    after(() =>
      deliverGmBroadcast(session.discordUserId, recipients, text).catch((err) =>
        console.error("GM broadcast delivery failed:", err),
      ),
    );

    return { recipientCount: recipients.length };
  });
}

// FactionsPanel's "Move ⬢" control — the fix for GMs having no way to touch
// a faction Silo at all. Full party-to-party: `fromKey`/`toKey` are each
// "character:<id>" or "faction:<id>", so this also covers Silo -> Silo,
// which has no staging model on the turn desk to fight and no reach gate to
// satisfy (a GM isn't standing anywhere). See web/lib/gmTransfer.js.
async function transferSiloResourcesImpl({ fromKey, toKey, amount, reason }) {
  const result = await gmTransferResources({ fromKey, toKey, amount, reason });
  revalidatePath("/gm/players", "layout");
  revalidatePath("/faction");
  return result;
}

export async function transferSiloResources(input) {
  return guarded(() => transferSiloResourcesImpl(input));
}
