import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import CharacterSheet from "../../../../components/CharacterSheet";
import { sendGmMessage } from "../../actions";

export default async function PlayerDetailPage({ params }) {
  const { characterId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: {
      faction: true,
      zone: true,
      tags: { include: { tag: true } },
    },
  });
  if (!character) notFound();

  const openTurn = await getOpenTurn();
  const currentAction = openTurn
    ? await prisma.action.findFirst({ where: { characterId: character.id, turnId: openTurn.id } })
    : null;

  const avatarSrc = character.avatarMimeType
    ? `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`
    : null;

  return (
    <div>
      <div className="mx-auto max-w-2xl px-6 pt-6 sm:px-8">
        <Link href="/gm/players" className="btn-quiet">
          &larr; Back to Players
        </Link>
      </div>
      <CharacterSheet
        character={character}
        mode="readonly"
        currentAction={currentAction}
        openTurn={openTurn}
        avatarSrc={avatarSrc}
      />
      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-6 pb-8 sm:px-8">
        <section className="panel p-4">
          <h2 className="mb-3 font-bold">GM Tools</h2>
          <form action={sendGmMessage} className="mb-4 flex flex-col gap-3">
            <input type="hidden" name="characterId" value={character.id} />
            <label className="field">
              <span className="field-label">Message this character (from Lifeweb)</span>
              <textarea name="message" rows={2} required />
            </label>
            <button type="submit" className="btn self-start">
              Send
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
