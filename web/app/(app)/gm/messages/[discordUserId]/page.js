import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { sendDmReply } from "../../actions";
import MessageList from "./MessageList";

export default async function MessageThreadPage({ params }) {
  const { discordUserId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const [messages, guildMembers, character] = await Promise.all([
    prisma.directMessage.findMany({ where: { discordUserId }, orderBy: { createdAt: "asc" } }),
    listGuildMembers(),
    prisma.character.findFirst({ where: { discordUserId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (messages.length === 0 && !character) notFound();

  const username = guildMembers.find((m) => m.id === discordUserId)?.username;
  const label = character?.name ?? username ?? discordUserId;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6 sm:p-8">
      <Link href="/gm/messages" className="btn-quiet">
        &larr; Back to Messages
      </Link>
      <h1 className="text-2xl font-bold">{label}</h1>

      <MessageList messages={messages} />

      <form action={sendDmReply} className="panel flex flex-col gap-3 p-4">
        <input type="hidden" name="discordUserId" value={discordUserId} />
        <label className="field">
          <span className="field-label">Reply (from Lifeweb)</span>
          <textarea name="message" rows={3} required />
        </label>
        <button type="submit" className="btn self-start">
          Send
        </button>
      </form>
    </div>
  );
}
