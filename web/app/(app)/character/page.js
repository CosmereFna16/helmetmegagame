import { redirect } from "next/navigation";
import { prisma, roleCapacity } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { getGuildMember, isApprovedPlayer, isCursed } from "@/lib/discordGuild";
import { isRoleSelectable } from "@/lib/characterCreation";
import { isSuperadmin } from "@/lib/superadmin";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import {
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  missingSkillsFor,
  satisfiedSkillIds,
} from "@/lib/healRequests";
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
  // Mirrors the bypass in createCharacter so the host sees the wizard rather
  // than the locked-out screen. The server action re-checks regardless — this
  // is presentation, that is enforcement.
  const superadmin = isSuperadmin(discordUserId);
  const gate = {
    open: superadmin || config?.openToPlayers === true,
    approved: superadmin || isApprovedPlayer(member),
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
      // requirementSkills has to be named explicitly: `include` returns every
      // scalar but no unnamed relation, and formatTagRequirement guards with
      // `?.length`, so leaving it off silently drops the skill from the
      // tooltip's cost line rather than failing.
      tags: {
        include: {
          tag: { include: { group: true, requirementSkills: { select: { name: true } } } },
        },
      },
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

  const [openTurn, otherCharacters, factions, tagCatalog, tierRows, desire, lastEndedDesire, gameConfig] =
    await Promise.all([
      getOpenTurn(),
      prisma.character.findMany({
        where: { status: "ALIVE", id: { not: character.id } },
        orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
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
      // id -> parentTagId for the whole catalog, so a held Medical (Excellent)
      // resolves back down its chain to the Medical (Basic) gate. Four columns
      // over a few hundred rows — cheaper than nesting three parentTag includes.
      prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } }),
      prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } }),
      prisma.desire.findFirst({
        where: { characterId: character.id, status: { in: ["FULFILLED", "CANCELLED"] } },
        orderBy: { updatedAt: "desc" },
        select: { endedTurnNumber: true },
      }),
      prisma.gameConfig.findUnique({ where: { id: 1 }, select: { equipSlots: true } }),
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
  // Healing. The medical gate is resolved here, server-side, so no tier-chain
  // math (and no other character's full sheet) reaches the client bundle —
  // TagRequestButtons gets a finished, presentational shape.
  const ancestry = buildSkillAncestry(tierRows);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = tierRows.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  const canHeal = Boolean(healSkillId && satisfied.has(healSkillId));

  // Skipped entirely for the great majority who aren't medics, and for anyone
  // a GM hasn't placed yet. locationId is the authoritative "where are you"
  // field; zoneId is only a mirror.
  const coLocated =
    canHeal && character.locationId
      ? await prisma.character.findMany({
          where: { status: "ALIVE", locationId: character.locationId },
          orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
          select: {
            id: true,
            name: true,
            // Deliberately no `resources` — a member's balance stays behind
            // Silo authority (see CLAUDE.md), and the payer menu never shows
            // balances anyway. Affordability is re-checked server-side.
            tags: {
              select: {
                tag: {
                  select: {
                    id: true,
                    name: true,
                    category: true,
                    requirementTurns: true,
                    requirementResources: true,
                    requirementGambit: true,
                    requirementSkills: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        })
      : [];

  // Filtered down to treatable tags HERE rather than in the client, so nobody
  // else's full sheet crosses the wire. A target with nothing to treat drops
  // out of the menu entirely.
  const healTargets = coLocated
    .map((t) => ({
      id: t.id,
      name: t.name,
      healable: t.tags
        .map((ct) => ct.tag)
        .filter(isHealable)
        .map((tag) => ({
          tagId: tag.id,
          tagName: tag.name,
          cost: healCost(tag),
          requirementLabel: formatTagRequirement(tag),
          // Empty means this medic may treat it; otherwise the names the
          // disabled row shows. Re-derived server-side on submit.
          missingSkills: missingSkillsFor(tag, satisfied).map((s) => s.name),
        })),
    }))
    .filter((t) => t.healable.length > 0);

  // Everyone standing here, plus EVERY faction Silo regardless of authority —
  // the same reach TRANSFER_RESOURCES has, per REQUESTS.md.
  const healParties = { characters: coLocated.map(({ id, name }) => ({ id, name })), factions };

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
      canHeal={canHeal}
      equipSlots={gameConfig?.equipSlots ?? 6}
      healTargets={healTargets}
      healParties={healParties}
    />
  );
}
