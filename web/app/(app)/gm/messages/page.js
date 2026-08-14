import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";

export default async function MessagesPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [messages, guildMembers] = await Promise.all([
    prisma.directMessage.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
    listGuildMembers(),
  ]);

  const conversations = new Map();
  for (const m of messages) {
    if (!conversations.has(m.discordUserId)) {
      conversations.set(m.discordUserId, { discordUserId: m.discordUserId, lastMessage: m, count: 0 });
    }
    conversations.get(m.discordUserId).count += 1;
  }

  const usernameById = new Map(guildMembers.map((mem) => [mem.id, mem.username]));
  const discordUserIds = [...conversations.keys()];
  const characters = await prisma.character.findMany({
    where: { discordUserId: { in: discordUserIds } },
    select: { discordUserId: true, name: true, status: true },
  });
  const characterNameById = new Map();
  for (const c of characters) {
    const existing = characterNameById.get(c.discordUserId);
    if (!existing || c.status === "ALIVE") characterNameById.set(c.discordUserId, c.name);
  }

  const rows = [...conversations.values()].sort(
    (a, b) => b.lastMessage.createdAt - a.lastMessage.createdAt,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 sm:p-8">
      <h1 className="text-2xl font-bold">Messages</h1>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Every direct message the bot has sent or received, grouped by player.
      </p>

      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Last message</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.discordUserId}>
                <td className="whitespace-nowrap">
                  {characterNameById.get(row.discordUserId) ??
                    usernameById.get(row.discordUserId) ??
                    row.discordUserId}
                </td>
                <td className="max-w-md truncate">
                  {row.lastMessage.direction === "OUTBOUND" ? "You: " : ""}
                  {row.lastMessage.content}
                </td>
                <td>
                  <Link href={`/gm/messages/${row.discordUserId}`} className="menu-item">
                    Open ({row.count})
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center" style={{ color: "var(--muted)" }}>
                  No direct messages yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
