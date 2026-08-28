import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import MessagesIndexClient from "./MessagesIndexClient";

// Empty right pane — shown at /gm/messages itself, before a GM picks a
// conversation from the list layout.js renders alongside it. This is also
// where the BulkComposer opens from, and where the last-broadcast banner
// lives — both need their own data, so this page owns that load and hands
// it to a small client wrapper.
export default async function MessagesIndexPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [characters, lastSent] = await Promise.all([
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      include: { faction: true, zone: true },
      take: 1000,
    }),
    prisma.auditLog.findFirst({
      where: { actionType: "gm_message_sent" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  let lastBroadcast = null;
  if (lastSent) {
    const delivered = await prisma.auditLog.findFirst({
      where: {
        actionType: { in: ["gm_message_delivered", "gm_message_delivery_failed"] },
        actorDiscordUserId: lastSent.actorDiscordUserId,
        createdAt: { gte: lastSent.createdAt },
      },
      orderBy: { createdAt: "asc" },
    });
    lastBroadcast = {
      sentAt: lastSent.createdAt.toISOString(),
      total: lastSent.details?.recipientCount ?? 0,
      failedCount: delivered?.details?.failedCount ?? 0,
      failedNames: (delivered?.details?.failed ?? []).map((f) => f.name),
      // "delivered" summary row not written yet — after() hasn't run.
      pending: !delivered,
    };
  }

  return (
    <MessagesIndexClient
      characters={characters.map((c) => ({
        id: c.id,
        name: c.name,
        roleName: c.roleTitle ?? "",
        factionName: c.faction?.name ?? "",
        zoneName: c.zone?.name ?? "",
      }))}
      lastBroadcast={lastBroadcast}
    />
  );
}
