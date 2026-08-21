import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import MessagesToolbar from "./MessagesToolbar";
import ConversationsTable from "./ConversationsTable";
import PageShell, { PageHeader } from "@/app/components/PageShell";

export default async function MessagesPage() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [messages, guildMembers, aliveCharacters] = await Promise.all([
    prisma.directMessage.findMany({ orderBy: { createdAt: "desc" }, take: 1000 }),
    listGuildMembers(),
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: { id: true, discordUserId: true, name: true },
    }),
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

  // Flattened to plain serializable fields — the table is a client component,
  // and it sorts on `lastAtMs` rather than on a Date it can't receive.
  const rows = [...conversations.values()].map((row) => ({
    discordUserId: row.discordUserId,
    name:
      characterNameById.get(row.discordUserId) ??
      usernameById.get(row.discordUserId) ??
      row.discordUserId,
    preview: `${row.lastMessage.direction === "OUTBOUND" ? "You: " : ""}${row.lastMessage.content}`,
    lastAtMs: row.lastMessage.createdAt.getTime(),
    count: row.count,
  }));

  return (
    <PageShell>
      <PageHeader
        title="Messages"
        subtitle="Every direct message the bot has sent or received, grouped by player."
      />

      <MessagesToolbar characters={aliveCharacters} />

      <ConversationsTable conversations={rows} />
    </PageShell>
  );
}
