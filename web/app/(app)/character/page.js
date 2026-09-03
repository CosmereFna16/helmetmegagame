import { redirect } from "next/navigation";
import { prisma, roleCapacity, isDynastyMember, presentedIdentity } from "@lifeweb/db";
import { accessibleRooms } from "@lifeweb/db/lib/roomAccess";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { takenCounts } from "@lifeweb/db/lib/roleReservation";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { auth } from "@/lib/auth";
import { dynastyLastName } from "@/lib/dynasty";
import { getOpenTurn } from "@/lib/turn";
import {
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  bottomSlotAddiction,
  unlockedBy,
} from "@lifeweb/db/lib/desireGates";
import { desireFamilies, desireFamilyGroups } from "@lifeweb/db/lib/desireFamilies";
import {
  projectDesireTemplateForGates,
  loadRoleBySlugForTemplates,
  computeHiddenDesireTagIds,
} from "@/lib/desireProjection";
import {
  getGuildMember,
  isApprovedPlayer,
  isCursed,
  isLeaderWhitelisted,
} from "@/lib/discordGuild";
import {
  isPlaytestLocked,
  isRoleSelectable,
  DEFAULT_MAX_DRAWBACK_TAGS,
} from "@/lib/characterCreation";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import { findOpenTurnAction } from "@/lib/moveEconomy";
import { isSuperadmin } from "@/lib/superadmin";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { isTradeable } from "@/lib/tagRequests";
import { canSendBird as holdsBirdAndLetters, birdZones as birdZonesOf, LITERATE_SLUG } from "@lifeweb/db/lib/bird";
import { describeTurn } from "@/lib/turnFormat";
import { INCAPACITATING_SLUGS, FINISHABLE_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { parseSelection } from "@/lib/portrait/catalog";
import {
  HEALABLE_CATEGORY,
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  isInflictable,
  missingSkillsFor,
  satisfiedSkillIds,
} from "@/lib/healRequests";
import CharacterSheet from "../../components/CharacterSheet";
import CreateCharacterWizard from "./CreateCharacterWizard";
import CreationClosed from "./CreationClosed";

// Everything the creation wizard needs, shaped as the Zone -> Faction -> Role
// tree it renders. Seat counts are computed here, not the client, so the
// numbers aren't stale-rendered from a cached page.
async function loadCreationData(discordUserId) {
  const [zones, tags, config, member, dynastyName] = await Promise.all([
    prisma.zone.findMany({
      orderBy: { name: "asc" },
      include: {
        factions: {
          orderBy: { sortOrder: "asc" },
          include: {
            roles: {
              orderBy: { sortOrder: "asc" },
              include: { startingLocation: { include: { zone: true } } },
            },
          },
        },
      },
    }),
    loadPointBuyCatalog([], { includeRoleStartingTags: true }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
    dynastyLastName(),
  ]);

  // Seated (ALIVE, plus DEAD on a seat that never reopens) plus anyone
  // else's live wizard-in-progress hold; excludes the viewer's own hold.
  const roleRows = zones.flatMap((zone) => zone.factions.flatMap((faction) => faction.roles));
  const takenByRole = await takenCounts(prisma, roleRows, discordUserId);

  const cursed = isCursed(member);
  // Presentation only; the server action re-checks regardless.
  const superadmin = isSuperadmin(discordUserId);
  const gate = {
    open: superadmin || config?.openToPlayers === true,
    approved: superadmin || isApprovedPlayer(member),
  };
  // `=== false`, not falsy: no config row means the gate stays enforced.
  const leaderWhitelisted =
    superadmin || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  const playtestMode = config?.playtestModeEnabled === true;
  const playerCount = config?.playerCount ?? 100;

  return {
    gate,
    cursed,
    dynastyName,
    playerCount,
    startingTagPoints: config?.startingTagPoints ?? 0,
    maxDrawbackTags: config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS,
    tags,
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
              // Locked roles stay in the tree; the card greys itself and says why.
              const playtestLocked =
                playtestMode && isPlaytestLocked({ role, zoneName: zone.name });
              return {
                id: role.id,
                name: role.name,
                intro: role.intro,
                slug: role.slug,
                // Null for ordinary seats; set on the four dynasty roles.
                lockedGender: role.lockedGender,
                difficulty: role.difficulty,
                factionName: faction.name,
                startingLocationName: role.startingLocation?.name ?? null,
                startingZoneName: role.startingLocation?.zone?.name ?? null,
                startingResources: role.startingResources,
                extraStartingPoints: role.extraStartingPoints,
                startingTagNames: role.startingTagSlugs,
                grantsLeader: role.grantsLeader,
                // Infinity doesn't serialize; uncapped roles cross as null -> "∞".
                cap: cap === Infinity ? null : cap,
                taken: takenByRole.get(role.id) ?? 0,
                selectable: isRoleSelectable({ role, cursed, leaderWhitelisted, playtestLocked }),
                playtestLocked,
                // Resolved server-side so a client component never drags
                // PrismaClient into the browser bundle.
                lastNameLocked: isDynastyMember(role.slug),
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
      role: { select: { slug: true } },
      // requirementSkills must be named explicitly: `include` doesn't pull
      // unnamed relations, and formatTagRequirement's `?.length` guard would
      // silently drop it rather than fail.
      tags: {
        include: {
          tag: { include: { group: true, requirementSkills: { select: { name: true } } } },
        },
      },
      defaultEffort: true,
    },
  });

  // No living character — this IS the create-a-character screen.
  if (!character) {
    const { gate, ...creation } = await loadCreationData(session.discordUserId);
    if (!gate.open || !gate.approved) return <CreationClosed open={gate.open} />;
    return <CreateCharacterWizard {...creation} />;
  }

  const [
    openTurn,
    otherCharacters,
    factions,
    tagCatalog,
    tierRows,
    desireHistory,
    desireTemplateRows,
    gameConfig,
    { action: currentAction },
  ] = await Promise.all([
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
      // getVisibleTags doesn't select purchasable/craftable, so this comes
      // down as its own props, same as the creation wizard.
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
          // addableTags' purchasable branch requires this or it reads
          // undefined and drops purchasable-only tags from the Add Tag menu.
          purchasableAfterStart: true,
          craftable: true,
          stackable: true,
          parentTagId: true,
          requiredTagId: true,
          requiredTag: { select: { name: true } },
          group: {
            select: {
              name: true,
              color: true,
              requiredTagId: true,
              requiredTag: { select: { name: true } },
            },
          },
          // Recipe skills are advice here, not a gate (TAGS.md §3b).
          requirementSkills: { select: { name: true, slug: true } },
          requirementTurns: true,
          conflictsWith: { select: { id: true } },
        },
      }),
      // id -> parentTagId for the whole catalog, to resolve a held tier back
      // down its chain to its gate.
      prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } }),
      // ALL statuses — the gate evaluator needs the whole history.
      prisma.desire.findMany({
        where: { characterId: character.id },
        select: {
          id: true,
          templateId: true,
          slotIndex: true,
          status: true,
          text: true,
          points: true,
          setTurnNumber: true,
          endedTurnNumber: true,
          template: { select: { tier: true, cooldownTurns: true, onceEver: true } },
        },
      }),
      // Gate fields db/lib/desireGates.js needs, projected through
      // web/lib/desireProjection.js below.
      prisma.desireTemplate.findMany({
        where: { retired: false },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          tier: true,
          families: true,
          onceEver: true,
          cooldownTurns: true,
          retired: true,
          requiresAnyOf: true,
          requiresAnyRoleSlugs: true,
          requiresNotRoleSlugs: true,
          requiresAnyTags: { select: { id: true, name: true } },
          requiresAllTags: { select: { id: true, name: true } },
          requiresNotTags: { select: { id: true, name: true } },
        },
      }),
      prisma.gameConfig.findUnique({
        where: { id: 1 },
        select: {
          equipSlots: true,
          avatarUploadsEnabled: true,
          portraitMakerEnabled: true,
          portraitFantasyPartsEnabled: true,
          desiresEnabled: true,
          desireSlots: true,
          desireSlotLockTurns: true,
          maxDrawbackTags: true,
          autoTurnAdvanceDisabled: true,
        },
      }),
      findOpenTurnAction(prisma, character.id),
    ]);

  // Desires. Every evaluation happens HERE, server-side — the client never
  // runs the gate logic or receives a hidden template.
  const desireSlots = gameConfig?.desireSlots ?? 2;
  const desireSlotLockTurns = gameConfig?.desireSlotLockTurns ?? 2;
  const heldDesireTagIds = new Set(character.tags.map((ct) => ct.tagId));
  const hiddenTagIds = await computeHiddenDesireTagIds(prisma, heldDesireTagIds);
  const roleBySlugForDesires = await loadRoleBySlugForTemplates(prisma, desireTemplateRows);
  const projectedDesireTemplates = desireTemplateRows.map((t) =>
    projectDesireTemplateForGates(roleBySlugForDesires, t),
  );
  const { visible: desireCatalogEvaluated } = evaluateDesireCatalog({
    templates: projectedDesireTemplates,
    heldTags: character.tags.map((ct) => ct.tag),
    hiddenTagIds,
    roleSlug: character.role?.slug ?? null,
    history: desireHistory,
    openTurnNumber: openTurn?.number ?? 0,
    desireSlots,
  });
  // The `hidden` half (db/lib/desireGates.js) never reaches this variable.
  // A "locked" entry (unmet requires, or a family a held tag shuts) is
  // dropped here too. Cooldown/once-ever-done rows stay, since those are
  // claimed already, just not claimable right now.
  const desireCatalog = desireCatalogEvaluated
    .filter(({ state }) => state !== "locked")
    .map(({ template, state, availableFromTurn, slotLocks }) => ({
      slug: template.slug,
      name: template.name,
      description: template.description,
      tier: template.tier,
      families: template.families,
      state,
      availableFromTurn,
      slotLocks,
      cooldownTurns: template.cooldownTurns ?? template.tier,
      onceEver: Boolean(template.onceEver),
      unlockedBy: unlockedBy(template, {
        heldTagIds: heldDesireTagIds,
        roleSlug: character.role?.slug ?? null,
      }),
    }));
  const desireLockNotes = describeDesireLocks(
    character.tags.map((ct) => ct.tag),
    new Map(desireFamilies().map((f) => [f.key, f.name])),
  );
  const desireSlotStates = slotStates({
    history: desireHistory,
    openTurnNumber: openTurn?.number ?? 0,
    desireSlots,
    lockTurns: desireSlotLockTurns,
  });
  const desireAddiction = bottomSlotAddiction(character.tags.map((ct) => ct.tag));

  // Held ids widen the store catalog so unpurchasable held tags (a
  // GM-granted item) still reach the client's byId map.
  const heldIds = character.tags.map((ct) => ct.tagId);
  const storeTags = await loadPointBuyCatalog(heldIds);
  const heldSet = new Set(heldIds);
  const storeHeldTags = storeTags
    .filter((t) => heldSet.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
  // Both ends of a transfer list every Silo and every living player,
  // including yourself. See REQUESTS.md §"the source can be anyone".
  const selfEntry = { id: character.id, name: character.name };
  // Plus every Room stash at this Location the character can get into
  // (CARRY.md) — with its contents, since pulling out of one means seeing
  // what's there. Filtered here, unlike the two lists above: a room you
  // can't enter isn't a scouting target, it's a locked door.
  const heldSlugsForRooms = new Set(character.tags.map((ct) => ct.tag.slug));
  const roomsHere = character.locationId
    ? await prisma.room.findMany({
        where: { locationId: character.locationId },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          kind: true,
          accessTagSlugs: true,
          resources: true,
          tags: {
            where: { quantity: { gt: 0 } },
            select: { tagId: true, quantity: true, tag: { select: { name: true, stackable: true } } },
          },
        },
      })
    : [];
  const rooms = accessibleRooms(roomsHere, heldSlugsForRooms).map((r) => ({
    id: r.id,
    name: r.name,
    resources: r.resources,
    tags: r.tags.map((rt) => ({ tagId: rt.tagId, name: rt.tag.name, quantity: rt.quantity, stackable: rt.tag.stackable })),
  }));
  const transferParties = {
    characters: [...otherCharacters, selfEntry].sort((a, b) => a.name.localeCompare(b.name)),
    factions,
    rooms,
  };
  const carry = carryStatus(character, gameConfig);
  // Healing. The medical gate is resolved here, server-side, so no
  // tier-chain math reaches the client bundle.
  const ancestry = buildSkillAncestry(tierRows);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = tierRows.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  const canHeal = Boolean(healSkillId && satisfied.has(healSkillId));

  // A fact about your own sheet, so this one may grey the button out.
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  const hasBird = holdsBirdAndLetters(character.tags);
  const isLiterate = heldSlugs.has(LITERATE_SLUG);
  // Compared against the in-game DAY (birdTurnId stores the day), not the
  // turn. Advisory only — the server's conditional claim is the real gate.
  const birdSentToday =
    Boolean(openTurn) && character.birdTurnId === String(describeTurn(openTurn).day);

  // Skipped for the majority who aren't medics, and for anyone unplaced.
  const coLocated =
    canHeal && character.zoneId
      ? await prisma.character.findMany({
          where: { status: "ALIVE", zoneId: character.zoneId },
          orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
          select: {
            id: true,
            name: true,
            // No `resources` — a balance stays behind Silo authority.
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

  // Filtered to treatable tags HERE, not the client, so nobody else's full
  // sheet crosses the wire.
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
          missingSkills: missingSkillsFor(tag, satisfied).map((s) => s.name),
        })),
    }))
    .filter((t) => t.healable.length > 0);

  // Everyone here, plus every faction Silo, per REQUESTS.md.
  const healParties = { characters: coLocated.map(({ id, name }) => ({ id, name })), factions };

  // ONE roster for every action on somebody standing here (Loot, Move,
  // Bind, Free, Harm), so the menus can't disagree.
  const zoneRoster = character.zoneId
    ? await prisma.character.findMany({
        where: {
          zoneId: character.zoneId,
          // A buried body has left the world (BURY_CHARACTER) and stops appearing.
          OR: [{ status: "ALIVE" }, { status: "DEAD", buriedAt: null }],
          id: { not: character.id },
        },
        orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
        select: {
          id: true,
          name: true,
          status: true,
          resources: true,
          tags: {
            select: {
              tagId: true,
              quantity: true,
              tag: { select: { name: true, slug: true, category: true, stackable: true, tradeable: true } },
            },
          },
        },
      })
    : [];

  // The catalog name of whichever incapacitating tag they hold.
  function conditionOf(c) {
    return c.tags.find((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))?.tag.name ?? null;
  }
  const helpless = zoneRoster.filter((c) => c.status === "DEAD" || conditionOf(c));

  // A body, or anyone who can't stop you. Only `tradeable` tags come off.
  const lootTargets = helpless.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    condition: conditionOf(c),
    resources: c.resources,
    tags: c.tags
      .filter((ct) => isTradeable(ct.tag))
      .map((ct) => ({
        tagId: ct.tagId,
        tagName: ct.tag.name,
        stackable: ct.tag.stackable,
        quantity: ct.quantity ?? 1,
      })),
  }));

  // Deliberately unfiltered: narrowing to who you may actually move would
  // give away who's tied up. The server's own gate rejects the rest.
  const moveTargets = zoneRoster.map(({ id, name, status }) => ({ id, name, status }));

  // Where you may walk someone: the neighbours of YOUR OWN location, the same
  // edge an ordinary walk uses. Each option carries its zone so the dialog can
  // warn that the hop crosses one.
  const moveLocations = character.locationId
    ? (
        (
          await prisma.location.findUnique({
            where: { id: character.locationId },
            select: {
              connectsTo: {
                select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
                orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
              },
            },
          })
        )?.connectsTo ?? []
      ).map((l) => ({
        id: l.id,
        name: l.name,
        zoneName: l.zone?.name ?? null,
        // The UI says "crosses into Fortress" only for an edge that leaves
        // the zone you're standing in.
        crossesZone: l.zoneId !== character.zoneId,
      }))
    : [];

  // Only fetched for someone who holds a bird. Recipient list is EVERY
  // character regardless of status; a letter to a dead name never arrives.
  const birdTargets = hasBird
    ? (
        await prisma.character.findMany({
          where: { id: { not: character.id } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      )
    : [];
  // Everywhere standable except the two deep cave levels (birdZones()).
  const birdZoneOptions = hasBird
    ? birdZonesOf(
        await prisma.zone.findMany({
          select: { id: true, name: true, slug: true, kind: true },
          orderBy: { sortOrder: "asc" },
        }),
      ).map((z) => ({ id: z.id, name: z.name }))
    : [];

  // Bind and Free split this one list on `bound`.
  const bindTargets = zoneRoster
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: c.name,
      bound: c.tags.some((ct) => ct.tag.slug === "bound"),
    }));

  // `finishable` is the narrower Dying-or-Bound gate on the lethal half.
  const harmTargets = helpless
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: c.name,
      condition: conditionOf(c),
      finishable: c.tags.some((ct) => FINISHABLE_SLUGS.has(ct.tag.slug)),
    }));

  // Not the whole Health category (TAGS.md §5c) — isInflictable narrows it
  // to wounds and maiming. Filtered in JS so this and the server action's
  // re-check share the same predicate.
  const harmTags = (
    await prisma.tag.findMany({
      where: { category: HEALABLE_CATEGORY, custom: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        category: true,
        custom: true,
        pointCost: true,
        stackable: true,
        group: { select: { slug: true, name: true, color: true } },
      },
    })
  ).filter(isInflictable);

  // A forced identity (Tag.forcedName — Apex Form's "Beast") shows the player
  // what the room sees: the forced name's letter plaque, not their own face.
  const forcedTag = character.tags.find((ct) => ct.tag.forcedName)?.tag ?? null;
  const forcedIdentity = forcedTag ? { name: forcedTag.forcedName, tagName: forcedTag.name } : null;
  const avatarSrc = forcedIdentity
    ? presentedIdentity(character, { forcedName: forcedIdentity.name }).avatarPath
    : `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`;

  // The Move cutoff for StatusPanel's "This turn" row.
  const openTurnWithWindow = openTurn
    ? { ...openTurn, moveWindow: moveWindow(openTurn, { autoTurnAdvanceDisabled: gameConfig?.autoTurnAdvanceDisabled ?? false }) }
    : openTurn;

  // A Gambit's die is rolled at submit but revealed only in the turn-end DM;
  // stripped here since currentAction crosses into a client component.
  const sheetAction = currentAction
    ? { ...currentAction, diceRoll: null, diceModifier: null }
    : currentAction;

  return (
    <CharacterSheet
      character={character}
      mode="self"
      openTurn={openTurnWithWindow}
      currentAction={sheetAction}
      avatarSrc={avatarSrc}
      forcedIdentity={forcedIdentity}
      transferParties={transferParties}
      carry={carry}
      tagCatalog={tagCatalog}
      otherCharacters={otherCharacters}
      desireSlots={desireSlots}
      desireSlotLockTurns={desireSlotLockTurns}
      desireAddiction={desireAddiction}
      desireSlotStates={desireSlotStates}
      desireCatalog={desireCatalog}
      desireFamilies={desireFamilies()}
      desireFamilyGroups={desireFamilyGroups()}
      desireLockNotes={desireLockNotes}
      desiresEnabled={gameConfig?.desiresEnabled ?? true}
      canHeal={canHeal}
      hasBird={hasBird}
      isLiterate={isLiterate}
      birdSentToday={birdSentToday}
      birdTargets={birdTargets}
      birdZones={birdZoneOptions}
      equipSlots={gameConfig?.equipSlots ?? 6}
      avatarUploadsEnabled={gameConfig?.avatarUploadsEnabled ?? false}
      portraitMakerEnabled={gameConfig?.portraitMakerEnabled ?? false}
      portraitFantasyPartsEnabled={gameConfig?.portraitFantasyPartsEnabled ?? false}
      // Re-validated here: a stored index can outlive a catalog change.
      portraitSelection={parseSelection(character.portrait, {
        allowFantasy: gameConfig?.portraitFantasyPartsEnabled ?? false,
      })}
      hasCustomAvatar={Boolean(character.avatarMimeType)}
      healTargets={healTargets}
      healParties={healParties}
      lootTargets={lootTargets}
      moveTargets={moveTargets}
      moveLocations={moveLocations}
      bindTargets={bindTargets}
      harmTargets={harmTargets}
      harmTags={harmTags}
      lastNameLocked={isDynastyMember(character.role?.slug)}
      storeTags={storeTags}
      storeHeldTags={storeHeldTags}
    />
  );
}
