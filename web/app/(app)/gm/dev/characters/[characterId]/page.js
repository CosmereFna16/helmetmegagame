import { redirect, notFound } from "next/navigation";
import { prisma, isDynastyMember, gambitModifierTotal } from "@lifeweb/db";
import { getGmSession, getGuildMember, isCursed } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { isHealable } from "@/lib/healRequests";
import { HUNGER_SLUG, ATE_MEAL_SLUG } from "@lifeweb/db/lib/constants";
import PageShell from "@/app/components/PageShell";
import DevPanel from "./DevPanel";

// The GM's one-stop character editor. Gated on GM membership rather than
// superadmin, because it is where every CharacterLink in the app points and
// an in-game GM is meant to use it — only the Delete microaction narrows to
// superadmin, and it does that in the action itself.
//
// Everything the panel could need is loaded here, in one Promise.all, and
// handed down as plain DTOs. The panel is a client component (it holds the
// staged-edit state), so nothing Prisma-shaped may cross the boundary: dates
// become ISO strings and only the columns actually rendered come along.
export default async function DevCharacterPanelPage({ params }) {
  const { characterId } = await params;
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");
  if (!gm) redirect("/character");

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { role: true, faction: true, location: true, zone: true },
  });
  if (!character) notFound();

  const [
    factions,
    zones,
    roles,
    allTags,
    heldTags,
    config,
    openTurn,
    desires,
    moves,
    requests,
    auditLog,
    messages,
    defaultEffort,
    member,
  ] = await Promise.all([
    prisma.faction.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.zone.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, locations: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
    }),
    prisma.role.findMany({
      orderBy: [{ sortOrder: "asc" }],
      select: { id: true, name: true, slug: true, faction: { select: { name: true } } },
    }),
    // The whole catalog, gates and all: a GM grant deliberately ignores
    // requiredTag and the TagGroup gate (TAGS.md), so unlike /api/tags this
    // withholds nothing — including the hidden Demoness and Bacchus groups.
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { group: { select: { name: true, color: true } }, requirementSkills: { select: { id: true, name: true } } },
    }),
    prisma.characterTag.findMany({ where: { characterId }, include: { tag: true } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    prisma.desire.findMany({ where: { characterId }, orderBy: { id: "desc" } }),
    prisma.action.findMany({
      where: { characterId },
      orderBy: { id: "desc" },
      take: 100,
      include: { turn: { select: { number: true, phase: true } } },
    }),
    prisma.request.findMany({
      where: { characterId },
      orderBy: { id: "desc" },
      take: 100,
      include: { turn: { select: { number: true, phase: true } } },
    }),
    prisma.auditLog.findMany({ where: { targetCharacterId: characterId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.directMessage.findMany({
      where: { discordUserId: character.discordUserId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.defaultEffort.findFirst({ where: { characterId } }),
    // Cursed is a live Discord role, not a DB field — read the account's
    // current guild roles rather than the Character row.
    getGuildMember(character.discordUserId).catch(() => null),
  ]);

  const openTurnAction = openTurn ? moves.find((m) => m.turnId === openTurn.id) ?? null : null;

  return (
    <PageShell width="wide">
      <DevPanel
        character={{
          id: character.id,
          discordUserId: character.discordUserId,
          updatedAt: character.updatedAt.toISOString(),
          name: character.name,
          honorific: character.honorific,
          firstName: character.firstName,
          title: character.title,
          lastName: character.lastName,
          age: character.age,
          preferredNickname: character.preferredNickname,
          appearance: character.appearance,
          roleId: character.roleId,
          roleTitle: character.roleTitle,
          factionId: character.factionId,
          factionName: character.faction?.name ?? null,
          zoneId: character.zoneId,
          zoneName: character.zone?.name ?? null,
          locationId: character.locationId,
          locationName: character.location?.name ?? null,
          status: character.status,
          isLeader: character.isLeader,
          isTreasurer: character.isTreasurer,
          resources: character.resources,
          tagPoints: character.tagPoints,
          turnPingOptIn: character.turnPingOptIn,
          romanceOptOut: character.romanceOptOut,
          worstFear: character.worstFear,
          worstFearSetTurnNumber: character.worstFearSetTurnNumber,
          worstFearLastFulfilledTurn: character.worstFearLastFulfilledTurn,
          discordRoleId: character.discordRoleId,
          avatarMimeType: character.avatarMimeType,
          hasAvatar: Boolean(character.avatarData),
        }}
        discord={{
          username: member?.user?.username ?? null,
          nickname: member?.nick ?? null,
          cursed: isCursed(member),
          present: Boolean(member),
        }}
        // lastNameLocked is read off the already-loaded role rather than a
        // second query. The dynasty name is changed by editing the Baron,
        // which propagates to all three of his family.
        lastNameLocked={isDynastyMember(character.role?.slug)}
        canDelete={isSuperadmin(session.discordUserId)}
        factions={factions}
        zones={zones}
        roles={roles.map((r) => ({ id: r.id, name: r.name, factionName: r.faction?.name ?? null }))}
        tags={allTags.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          category: t.category,
          description: t.description,
          pointCost: t.pointCost,
          stackable: t.stackable,
          equippable: t.equippable,
          consumable: t.consumable,
          removable: t.removable,
          custom: t.custom,
          defaultDurationTurns: t.defaultDurationTurns,
          parentTagId: t.parentTagId,
          requiredTagId: t.requiredTagId,
          group: t.group,
          // Precomputed server-side so the Heal-all and Inflict-wound
          // staging buttons and the server action agree on what an
          // affliction is — isHealable is the shared predicate.
          healable: isHealable(t),
        }))}
        held={heldTags.map((ct) => ({
          tagId: ct.tagId,
          name: ct.tag.name,
          quantity: ct.quantity,
          equipped: ct.equipped,
          expiresTurn: ct.expiresTurn,
          source: ct.source,
        }))}
        feed={{ dropSlug: HUNGER_SLUG, grantSlug: ATE_MEAL_SLUG }}
        // computeBudget subtracts CURSED_POINT_PENALTY, so the Refund-points
        // button needs to know — otherwise a re-rolled cursed character is
        // handed back 3 points creation never gave them.
        cursed={isCursed(member)}
        equipSlots={config?.equipSlots ?? 6}
        startingTagPoints={config?.startingTagPoints ?? 12}
        openTurn={openTurn ? { id: openTurn.id, number: openTurn.number, phase: openTurn.phase } : null}
        gambitModifier={gambitModifierTotal(heldTags)}
        openTurnAction={
          openTurnAction
            ? {
                id: openTurnAction.id,
                description: openTurnAction.description,
                moveKind: openTurnAction.moveKind,
                opposed: openTurnAction.opposed,
                moveReviewStatus: openTurnAction.moveReviewStatus,
                resourceDelta: openTurnAction.resourceDelta,
                diceRoll: openTurnAction.diceRoll,
                diceModifier: openTurnAction.diceModifier,
                gmNotes: openTurnAction.gmNotes,
              }
            : null
        }
        defaultEffort={
          defaultEffort
            ? { description: defaultEffort.description, resourceDelta: defaultEffort.resourceDelta }
            : null
        }
        desires={desires.map((d) => ({
          id: d.id,
          text: d.text,
          points: d.points,
          status: d.status,
          setTurnNumber: d.setTurnNumber,
          endedTurnNumber: d.endedTurnNumber,
        }))}
        moves={moves.map((m) => ({
          id: m.id,
          turn: m.turn ? `${m.turn.number} ${m.turn.phase}` : "—",
          description: m.description,
          moveKind: m.moveKind,
          status: m.moveReviewStatus,
          resourceDelta: m.resourceDelta,
        }))}
        requests={requests.map((r) => ({
          id: r.id,
          turn: r.turn ? `${r.turn.number} ${r.turn.phase}` : "—",
          type: r.type,
          status: r.status,
          reason: r.reason,
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
        }))}
        auditLog={auditLog.map((a) => ({
          id: a.id,
          actionType: a.actionType,
          reason: a.reason,
          createdAt: a.createdAt.toISOString(),
        }))}
        messages={messages.map((m) => ({
          id: m.id,
          direction: m.direction,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    </PageShell>
  );
}
