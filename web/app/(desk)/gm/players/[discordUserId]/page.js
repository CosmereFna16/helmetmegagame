import { redirect, notFound } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession, listGuildMembers } from "@/lib/discordGuild";
import { getGmProfiles } from "@/lib/gmProfiles";
import { getOpenTurn } from "@/lib/turn";
import { MOVE_REVIEW_LABELS, moveKindLabel, rollLabel } from "@/lib/moves";
import PersonShell from "./PersonShell";

const TAKE = 100;

export default async function PlayerDeskPersonPage({ params }) {
  const { discordUserId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  // take one more than the page size so "there is older history" is a fact
  // rather than a guess, the same trick the old bounded query used.
  const [recent, guildMembers, character, aliveCharacter, gmProfiles, claim, openTurn] = await Promise.all([
    prisma.directMessage.findMany({
      where: { discordUserId },
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
  ]);
  const hasMore = recent.length > TAKE;
  const messages = recent.slice(0, TAKE).reverse();
  if (messages.length === 0 && !character) notFound();

  const username = guildMembers.find((m) => m.id === discordUserId)?.username;
  const label = character?.name ?? username ?? discordUserId;

  // The Canon panel — everything a GM would otherwise have to hop to
  // /gm/turns to see about this player's current turn: their Move, any
  // pending staged messages/effects. Empty (null) whenever the player has no
  // living character, which is also when there's nothing "canon" to show.
  let canon = null;
  if (aliveCharacter) {
    const [action, pendingRecipients, pendingEffects] = await Promise.all([
      openTurn
        ? prisma.action.findUnique({
            where: { characterId_turnId: { characterId: aliveCharacter.id, turnId: openTurn.id } },
          })
        : null,
      prisma.stagedMessageRecipient.findMany({
        where: { characterId: aliveCharacter.id, stagedMessage: { sentAt: null } },
        include: { stagedMessage: true },
        orderBy: { stagedMessage: { createdAt: "desc" } },
      }),
      prisma.stagedEffect.findMany({
        where: { targetCharacterId: aliveCharacter.id, appliedAt: null },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const tagIds = [
      ...new Set(pendingEffects.flatMap((e) => (e.payload?.tagOps ?? []).map((op) => op.tagId).filter(Boolean))),
    ];
    const tags = tagIds.length ? await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, name: true } }) : [];
    const tagNames = new Map(tags.map((t) => [t.id, t.name]));

    canon = {
      characterId: aliveCharacter.id,
      characterName: aliveCharacter.name,
      move: action
        ? {
            id: action.id,
            description: action.description,
            kindLabel: moveKindLabel(action.moveKind),
            rollLabel: rollLabel(action),
            reviewLabel: MOVE_REVIEW_LABELS[action.moveReviewStatus] ?? "Open",
            resultMessage: action.resultMessage,
          }
        : null,
      pendingMessages: pendingRecipients.map((r) => ({
        id: r.stagedMessage.id,
        content: r.stagedMessage.content,
        createdAt: r.stagedMessage.createdAt.toISOString(),
      })),
      pendingEffects: pendingEffects.map((e) => ({
        id: e.id,
        payload: e.payload,
      })),
      tagNames: Object.fromEntries(tagNames),
    };
  }

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
      statusLabel={character && character.status !== "ALIVE" ? character.status.toLowerCase() : null}
      initialMessages={messages}
      initialHasMore={hasMore}
      gmProfiles={gmProfiles}
      myDiscordUserId={session.discordUserId}
      claimedByDiscordUserId={claim?.claimedByDiscordUserId ?? null}
      canon={canon}
      currentTurnNumber={openTurn?.number ?? null}
    />
  );
}
