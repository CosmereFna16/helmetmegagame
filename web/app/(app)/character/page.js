import { redirect } from "next/navigation";
import { prisma, roleCapacity } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { getGuildMember, isApprovedPlayer, isCursed } from "@/lib/discordGuild";
import { isRoleSelectable } from "@/lib/characterCreation";
import CharacterSheet from "../../components/CharacterSheet";
import CreateCharacterWizard from "./CreateCharacterWizard";
import CreationClosed from "./CreationClosed";

// Everything the creation wizard needs, shaped as the Zone -> Faction -> Role
// tree it renders. Seat counts are computed here rather than in the client so
// the numbers can't be stale-rendered from a cached page; the server action
// re-counts inside its transaction anyway, since this is only advisory.
async function loadCreationData(discordUserId) {
  const [zones, tags, config, member, takenRows] = await Promise.all([
    prisma.zone.findMany({
      orderBy: { name: "asc" },
      include: {
        factions: {
          orderBy: { sortOrder: "asc" },
          include: {
            roles: { orderBy: { sortOrder: "asc" }, include: { startingLocation: true } },
          },
        },
      },
    }),
    prisma.tag.findMany({
      where: { purchasable: true },
      include: {
        // requiredTagId comes along because a group carrying one is the
        // hidden-category gate (docs/systemdocs/TAGS.md §3). Drop it and
        // every gated category silently opens for everyone.
        group: { select: { slug: true, name: true, color: true, requiredTagId: true } },
        requirementSkills: { select: { id: true, slug: true, name: true } },
      },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
    prisma.character.groupBy({ by: ["roleId"], where: { status: "ALIVE" }, _count: true }),
  ]);

  const cursed = isCursed(member);
  const gate = {
    open: config?.openToPlayers === true,
    approved: isApprovedPlayer(member),
  };
  const playerCount = config?.playerCount ?? 100;
  const takenByRole = new Map(takenRows.map((r) => [r.roleId, r._count]));

  return {
    gate,
    cursed,
    playerCount,
    startingTagPoints: config?.startingTagPoints ?? 0,
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      pointCost: t.pointCost,
      purchasable: t.purchasable,
      purchasableAfterStart: t.purchasableAfterStart,
      parentTagId: t.parentTagId,
      requiredTagId: t.requiredTagId,
      group: t.group,
      removable: t.removable,
      craftable: t.craftable,
      requirementTurns: t.requirementTurns,
      requirementResources: t.requirementResources,
      requirementGambit: t.requirementGambit,
      requirementSkills: t.requirementSkills,
    })),
    zones: zones
      .map((zone) => ({
        id: zone.id,
        name: zone.name,
        factions: zone.factions
          .map((faction) => ({
            id: faction.id,
            name: faction.name,
            roles: faction.roles.map((role) => {
              const cap = roleCapacity(role, playerCount);
              return {
                id: role.id,
                name: role.name,
                intro: role.intro,
                difficulty: role.difficulty,
                factionName: faction.name,
                startingLocationName: role.startingLocation?.name ?? null,
                startingResources: role.startingResources,
                extraStartingPoints: role.extraStartingPoints,
                startingTagNames: role.startingTagSlugs,
                grantsLeader: role.grantsLeader,
                // Infinity doesn't survive serialization to the client, so
                // uncapped roles cross the boundary as null and render "∞".
                cap: cap === Infinity ? null : cap,
                taken: takenByRole.get(role.id) ?? 0,
                selectable: isRoleSelectable({ role, cursed }),
              };
            }),
          }))
          .filter((f) => f.roles.length > 0),
      }))
      .filter((z) => z.factions.length > 0),
  };
}

export default async function CharacterPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      faction: true,
      zone: true,
      location: true,
      // group comes along so TagChip can tint the chip, same as
      // /gm/turns does it — otherwise every Item renders uncoloured.
      tags: { include: { tag: { include: { group: true } } } },
      defaultEffort: true,
    },
  });

  // No living character — this IS the create-a-character screen. Rendered
  // inline rather than redirecting to a separate route, so a player who just
  // died lands somewhere that explains itself instead of bouncing.
  if (!character) {
    const { gate, ...creation } = await loadCreationData(session.discordUserId);
    // Both halves have to hold before the wizard is worth rendering; the
    // server action re-checks them regardless.
    if (!gate.open || !gate.approved) return <CreationClosed open={gate.open} />;
    return <CreateCharacterWizard {...creation} />;
  }

  const [openTurn, otherCharacters, factions, tagCatalog, desire, lastEndedDesire] = await Promise.all([
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
    // The Add Tag menu needs purchasable/craftable, which /api/tags doesn't
    // select (and which that unauthenticated route shouldn't grow just to
    // serve a picker) — so the catalog comes down as props, same as the
    // creation wizard does it.
    prisma.tag.findMany({
      where: { OR: [{ purchasable: true }, { craftable: true }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        pointCost: true,
        purchasable: true,
        craftable: true,
        stackable: true,
        // Both gates the Add Tag menu enforces — the per-tag prerequisite and
        // the whole-group one behind a hidden category. parentTagId comes
        // along because requirementSatisfied walks the tier chain.
        parentTagId: true,
        requiredTagId: true,
        group: { select: { name: true, color: true, requiredTagId: true } },
      },
    }),
    prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } }),
    prisma.desire.findFirst({
      where: { characterId: character.id, status: { in: ["FULFILLED", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" },
      select: { endedTurnNumber: true },
    }),
  ]);

  // Both ends of a transfer list every Silo and every living player,
  // INCLUDING yourself — pulling ⬢ out of a Silo into your own pocket is the
  // common case, and self -> self is already refused by the same-party guard
  // in transferResourcesRequest. See REQUESTS.md §"the source can be anyone".
  const selfEntry = { id: character.id, name: character.name };
  const transferParties = {
    characters: [...otherCharacters, selfEntry].sort((a, b) => a.name.localeCompare(b.name)),
    factions,
  };
  const avatarSrc = `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`;

  return (
    <CharacterSheet
      character={character}
      mode="self"
      openTurn={openTurn}
      avatarSrc={avatarSrc}
      transferParties={transferParties}
      tagCatalog={tagCatalog}
      otherCharacters={otherCharacters}
      desire={desire}
      desireCooldownUntilTurn={lastEndedDesire?.endedTurnNumber ?? null}
    />
  );
}
