import SubmitButton from "@/app/components/SubmitButton";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { sendDmReply } from "../../actions";
import MessageList from "./MessageList";
import PageShell, { PageHeader } from "@/app/components/PageShell";

// The whole thread is rarely what a GM wants; the tail always is. Older
// messages remain in /archive and in the DirectMessage table either way.
const THREAD_LIMIT = 200;

export default async function MessageThreadPage({ params }) {
  const { discordUserId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  // Bounded, and bounded from the RECENT end: this used to be an unbounded
  // findMany, and the move-submission flow puts every declaration through DMs,
  // so a chatty player's thread is four figures by the end of a month. Read
  // one more than the cap so "there is older history" is a fact rather than a
  // guess, then flip back to chronological for the conversation view.
  const [recent, guildMembers, character] = await Promise.all([
    prisma.directMessage.findMany({
      where: { discordUserId },
      orderBy: { createdAt: "desc" },
      take: THREAD_LIMIT + 1,
    }),
    listGuildMembers(),
    prisma.character.findFirst({ where: { discordUserId }, orderBy: { createdAt: "desc" } }),
  ]);
  const truncated = recent.length > THREAD_LIMIT;
  const messages = recent.slice(0, THREAD_LIMIT).reverse();
  if (messages.length === 0 && !character) notFound();

  const username = guildMembers.find((m) => m.id === discordUserId)?.username;
  const label = character?.name ?? username ?? discordUserId;

  return (
    <PageShell width="narrow">
      <Link href="/gm/messages" className="btn-quiet">
        &larr; Back to Messages
      </Link>
      <PageHeader title={label} />

      {truncated ? (
        <p className="text-sm opacity-70">
          Showing the most recent {THREAD_LIMIT} messages. Older ones are in the transcript.
        </p>
      ) : null}

      <MessageList messages={messages} />

      <form action={sendDmReply} className="panel flex flex-col gap-3 p-4">
        <input type="hidden" name="discordUserId" value={discordUserId} />
        <label className="field">
          <span className="field-label">Reply (from Bascinet)</span>
          <textarea name="message" rows={3} required />
        </label>
        <SubmitButton className="btn self-start" pendingLabel="Sending…">
          Send
        </SubmitButton>
      </form>
    </PageShell>
  );
}
