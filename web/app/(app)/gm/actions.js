"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGmSession, sendDm, syncCharacterNarrowcastAccess } from "@/lib/discordGuild";
import { UserError, guarded } from "@/lib/actionResult";
import { addToStack, dropCharacterTag } from "@/lib/requestEffects";
import { expiryFor } from "@/lib/turnFormat";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";

async function requireGm() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) throw new Error("Not authenticated.");
  if (!gm) throw new Error("Not authorized.");
  return session;
}

// A GM broadcast is the one place in the app that DMs a crowd, and each DM is
// two REST requests (open the channel, post to it). This used to be one
// Promise.all over every recipient with a `.catch(() => null)` on each: 100
// players meant 200 concurrent requests, and every failure — a 429 most of
// all — was swallowed, so a GM saw "sent" for messages nobody received.
//
// Now the sends are sequential, per the rate-limit discipline in
// ARCHITECTURE.md §5, and deferred to after() the way forceAdvanceTurn defers
// its side effects: 100 recipients is a minute or two of Discord round-trips,
// and awaiting that inside a server action holds the action open, which blocks
// client-side navigation and freezes the panel.
//
// Because the response has flushed by then, the audit log is the only place a
// result can land. Two rows, deliberately: the intent is recorded inline so a
// broadcast is on the record even if the process dies mid-delivery, and a
// second row is written only when something actually failed, naming who — that
// list is what a GM needs to retry by hand.
async function deliverGmMessage(actorDiscordUserId, recipients, message) {
  const failed = [];

  for (const recipient of recipients) {
    try {
      await sendDm(recipient.discordUserId, message);
    } catch (err) {
      console.error(`GM message to ${recipient.name} (${recipient.discordUserId}) failed:`, err);
      failed.push({ characterId: recipient.id, name: recipient.name, discordUserId: recipient.discordUserId });
    }
  }

  if (failed.length === 0) return;

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId,
        actionType: "gm_message_delivery_failed",
        details: { failed, failedCount: failed.length, totalCount: recipients.length, message },
      },
    })
    .catch((err) => console.error("Could not record GM message delivery failures:", err));
}

export async function sendGmMessage(formData) {
  const session = await requireGm();

  const characterIds = formData.getAll("characterId").map(String).filter(Boolean);
  const message = formData.get("message")?.toString().trim();
  if (!message || characterIds.length === 0) return;
  // The textarea's maxLength is a hint; this is the lock. Over-length used to
  // mean every recipient's send failed identically inside after(), after the
  // GM had already been told it went.
  if (message.length > GM_MESSAGE_MAX_LENGTH) return;

  const recipients = await prisma.character.findMany({
    where: { id: { in: characterIds } },
    select: { id: true, name: true, discordUserId: true },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_message_sent",
      details: { characterIds, message, recipientCount: recipients.length },
    },
  });

  revalidatePath("/gm/players");
  revalidatePath("/gm/turns");

  after(() =>
    deliverGmMessage(session.discordUserId, recipients, message).catch((err) =>
      console.error("GM message delivery failed:", err),
    ),
  );
}

export async function sendDmReply(formData) {
  const session = await requireGm();

  const discordUserId = formData.get("discordUserId")?.toString().trim();
  const message = formData.get("message")?.toString().trim();
  if (!discordUserId || !message) return;
  if (message.length > GM_MESSAGE_MAX_LENGTH) return;

  await sendDm(discordUserId, message);

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "gm_dm_reply",
      details: { discordUserId, message },
    },
  });

  revalidatePath("/gm/messages");
  revalidatePath(`/gm/messages/${discordUserId}`);
}

// ── bulk tagging from /gm/players ──────────────────────────────────────────

// Grants or revokes one tag across every selected character.
//
// ONE TRANSACTION PER CHARACTER, never one across the whole batch. A
// hundred-character transaction would hold a row lock against each of those
// players' own equip toggles for its entire duration, and one bad character
// would roll back ninety-nine good ones. Sequential, partial success
// reported, one audit row for the batch.
export async function bulkTagCharacters({ characterIds, tagId, mode }) {
  return guarded(async () => {
    const { session, isGm: gm } = await getGmSession();
    if (!session?.discordUserId || !gm) throw new UserError("Not authorized.");

    const ids = [...new Set(characterIds ?? [])];
    if (!ids.length) throw new UserError("Select at least one character.");
    if (ids.length > 200) throw new UserError("That's more than 200 characters at once.");

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new UserError("That tag no longer exists.");

    const openTurn = await prisma.turn.findFirst({
      where: { status: "OPEN" },
      select: { number: true },
    });

    const failed = [];
    let applied = 0;

    for (const characterId of ids) {
      try {
        await prisma.$transaction(async (tx) => {
          if (mode === "revoke") {
            // One unit off a stack, the whole row otherwise — a GM
            // correcting an over-grant shouldn't wipe a player's larder.
            await dropCharacterTag(tx, characterId, tagId, tag.stackable ? 1 : null);
          } else {
            // expiryFor is not optional: resolveNeeds()'s sweep matches on
            // expiresTurn, so a timed tag granted with a null there never
            // expires at all.
            await addToStack(tx, characterId, tagId, 1, {
              source: "GM_GRANT",
              stackable: tag.stackable,
              expiresTurn: expiryFor(tag, openTurn),
            });
          }
        });
        applied += 1;
      } catch (err) {
        console.error(`Bulk ${mode} of ${tag.slug} failed for ${characterId}:`, err);
        failed.push(characterId);
      }
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: mode === "revoke" ? "gm_bulk_tag_revoke" : "gm_bulk_tag_grant",
        details: { tagId, tagName: tag.name, characterIds: ids, applied, failed },
      },
    });

    // A granted or revoked tag may change narrowcast access (#watch,
    // #intercom). Sequential and after the writes, per ARCHITECTURE.md §5 —
    // never a fan-out of REST calls at Discord's rate limiter.
    after(async () => {
      for (const characterId of ids) {
        await syncCharacterNarrowcastAccess(characterId).catch(() => {});
      }
    });

    revalidatePath("/gm/players");
    revalidatePath("/character");
    return { applied, failed: failed.length, tagName: tag.name };
  });
}
