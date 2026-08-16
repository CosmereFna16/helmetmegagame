import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { TAG_STORE_CATEGORY_NAMES } from "@/lib/tagStore";
import { listGuildChannels, isSummaryChannel } from "@/lib/discordGuild";
import CharacterSheet from "../../components/CharacterSheet";

export default async function CharacterPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      faction: true,
      zone: true,
      tags: { include: { tag: true } },
      desires: { orderBy: { createdAt: "desc" }, take: 1 },
      defaultEffort: true,
    },
  });

  if (!character) redirect("/character/new");

  const [openTurn, otherCharacters, factions, storeTags, guildChannels] = await Promise.all([
    getOpenTurn(),
    prisma.character.findMany({
      where: { status: "ALIVE", id: { not: character.id } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.faction.findMany({
      where: { name: { not: "Unaffiliated" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.tag.findMany({ where: { category: { in: TAG_STORE_CATEGORY_NAMES } } }),
    listGuildChannels(),
  ]);

  const summaryChannels = guildChannels
    .filter(isSummaryChannel)
    .map((c) => ({ id: c.id, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const avatarSrc = character.avatarMimeType
    ? `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`
    : null;

  return (
    <CharacterSheet
      character={character}
      mode="self"
      openTurn={openTurn}
      avatarSrc={avatarSrc}
      transferTargets={{ characters: otherCharacters, factions }}
      storeTags={storeTags}
      summaryChannels={summaryChannels}
    />
  );
}
