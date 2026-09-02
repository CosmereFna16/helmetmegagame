import { redirect, notFound } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { getOpenTurn } from "@/lib/turn";
import { withoutDmNoise } from "@/lib/dmThread";
import PersonShell from "./PersonShell";

const TAKE = 100;

export default async function PlayerDeskPersonPage({ params }) {
  const { discordUserId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  // take one more than the page size so "there is older history" is a fact
  // rather than a guess, the same trick the old bounded query used.
  const [recent, guildMembers, character, aliveCharacter, gmProfiles, claim, openTurn, readCursor] = await Promise.all([
    prisma.directMessage.findMany({
      where: withoutDmNoise({ discordUserId }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TAKE + 1,
    }),
    listGuildMembers(),
    prisma.character.findFirst({ where: { discordUserId }, orderBy: { createdAt: "desc" } }),
    prisma.character.findFirst({
      where: { discordUserId, status: "ALIVE" },
      orderBy: { createdAt: "desc" },
      include: { zone: { select: { name: true } } },
    }),
    getGmProfiles(),
    prisma.conversationMeta.findUnique({ where: { playerDiscordUserId: discordUserId } }),
    getOpenTurn(),
    // This GM's read cursor, for the thread's NEW line. Read here, before the
    // pane's mark-read effect moves it.
    prisma.conversationRead.findUnique({
      where: {
        gmDiscordUserId_playerDiscordUserId: { gmDiscordUserId: session.discordUserId, playerDiscordUserId: discordUserId },
      },
      select: { lastReadAt: true },
    }),
  ]);
  const hasMore = recent.length > TAKE;
  const messages = recent.slice(0, TAKE).reverse();
  const username = guildMembers.find((m) => m.id === discordUserId)?.username;
  // Unknown id → 404. A guild member with no character and no conversation
  // yet is not unknown — they are exactly who a GM opens this page to
  // message first. Additive on purpose: listGuildMembers() returns [] when
  // Discord is unreachable, and the old two-part test still holds then.
  if (messages.length === 0 && !character && !username) notFound();
  const label = character?.name ?? username ?? discordUserId;

  // Everything that used to be the Canon panel's payload now loads inside the
  // inspector's Canon tab (players/actions.js#getPlayerCanon), because the
  // inspector can be pointed at somebody who is not this conversation. All
  // this route still needs from the open turn is whether there is a Move to
  // link to from the conversation header.
  const openMove =
    aliveCharacter && openTurn
      ? await prisma.action.findUnique({
          where: { characterId_turnId: { characterId: aliveCharacter.id, turnId: openTurn.id } },
          select: { id: true },
        })
      : null;

  return (
    <PersonShell
      // Keying on the conversation makes a navigation between people a
      // remount, which is what resets the pane's local page/claim state —
      // simpler and safer than an effect that syncs state to a changed prop.
      key={discordUserId}
      discordUserId={discordUserId}
      label={label}
      characterId={aliveCharacter?.id ?? character?.id ?? null}
      avatarVersion={(aliveCharacter ?? character)?.updatedAt.getTime() ?? null}
      zoneName={aliveCharacter?.zone?.name ?? null}
      status={character && character.status !== "ALIVE" ? character.status : null}
      initialMessages={messages}
      initialHasMore={hasMore}
      gmProfiles={gmProfiles}
      myDiscordUserId={session.discordUserId}
      claimedByDiscordUserId={claim?.claimedByDiscordUserId ?? null}
      moveId={openMove?.id ?? null}
      lastReadAtMs={readCursor?.lastReadAt ? readCursor.lastReadAt.getTime() : 0}
    />
  );
}
