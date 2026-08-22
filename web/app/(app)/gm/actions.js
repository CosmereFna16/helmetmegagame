"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGmSession, sendDm } from "@/lib/discordGuild";

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
