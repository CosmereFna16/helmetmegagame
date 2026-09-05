import { redirect } from "next/navigation";
import { peopleHere } from "@/lib/peopleHere";
import {
  LESSON_CATALOG_SELECT,
  teachableSkills,
  isTeacher,
} from "@lifeweb/db/lib/lessons";
import {
  prisma,
  roleCapacity,
  isDynastyMember,
  presentedIdentity,
  startingTagNames,
} from "@lifeweb/db";
import {
  accessibleRooms,
  guestRoomIds as roomGuestIds,
} from "@lifeweb/db/lib/roomAccess";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import {
  BUTCHER_SLUG,
  WORKSHOP_EQUIPMENT_SLUG,
  PACKAGING_EQUIPMENT_SLUG,
} from "@lifeweb/db/lib/constants";
import {
  hasAttribute,
  GODFLESH_ATTRIBUTE,
} from "@lifeweb/db/lib/locationAttributes";
import { extractToolFor } from "@lifeweb/db/lib/godflesh";
import { hasEquipmentInReach } from "@lifeweb/db/lib/equipmentReach";
import { travelOptions } from "@lifeweb/db/lib/locationGraph";
import { carryStatus } from "@lifeweb/db/lib/carry";
import { examineBlock } from "@lifeweb/db/lib/examineVision";
import { canRead } from "@lifeweb/db/lib/reading";
import {
  PAPER_SLUG,
  BOOK_SHEETS,
  isBook,
  isPaper,
  isSeal,
  sealLabel,
  paperDescription,
} from "@lifeweb/db/lib/paper";
import {
  freeMovesLeft,
  freeZoneMovesReason,
} from "@lifeweb/db/lib/locationTravel";
import { takenCounts } from "@lifeweb/db/lib/roleReservation";
import { groupRoles } from "@lifeweb/db/lib/roleGroups";
import { moveWindow } from "@lifeweb/db/lib/turnClock";
import { auth } from "@/lib/auth";
import { dynastyLastName } from "@/lib/dynasty";
import { getOpenTurn } from "@/lib/turn";
import { MEDICAL_TIER_CAPS } from "@/lib/requests";
import {
  evaluateDesireCatalog,
  slotStates,
  describeDesireLocks,
  bottomSlotAddiction,
  unlockedBy,
} from "@lifeweb/db/lib/desireGates";
import {
  desireFamilies,
  desireFamilyGroups,
} from "@lifeweb/db/lib/desireFamilies";
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
  DEFAULT_MAX_DRAWBACK_POINTS,
} from "@/lib/characterCreation";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import { findOpenTurnAction } from "@/lib/moveEconomy";
import { isSuperadmin } from "@/lib/superadmin";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { isTradeable } from "@/lib/tagRequests";
import { canBuildHere, structuresAt } from "@lifeweb/db/lib/structures";
import {
  canSendBird as holdsBirdAndLetters,
  birdZones as birdZonesOf,
} from "@lifeweb/db/lib/bird";
import { describeTurn } from "@/lib/turnFormat";
import {
  INCAPACITATING_SLUGS,
  FINISHABLE_SLUGS,
} from "@lifeweb/db/lib/incapacitation";
import { parseSelection } from "@/lib/portrait/catalog";
import {
  HEALABLE_CATEGORY,
  HEAL_SKILL_SLUG,
  buildSkillAncestry,
  healCost,
  isHealable,
  isInflictable,
  isGambitHeal,
  countsAgainstHealCap,
  healCapFor,
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
  const roleRows = zones.flatMap((zone) =>
    zone.factions.flatMap((faction) => faction.roles),
  );
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
    superadmin ||
    config?.leaderWhitelistEnabled === false ||
    isLeaderWhitelisted(member);
  const playtestMode = config?.playtestModeEnabled === true;
  const playerCount = config?.playerCount ?? 100;

  return {
    gate,
    cursed,
    dynastyName,
    playerCount,
    startingTagPoints: config?.startingTagPoints ?? 0,
    maxDrawbackTags: config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS,
    maxDrawbackPoints: config?.maxDrawbackPoints ?? DEFAULT_MAX_DRAWBACK_POINTS,
    tags,
    // Seven social buckets, not five zones — db/lib/roleGroups.js says which
    // faction lands where (and which single role overrides its faction), and
    // the zone a role starts in is printed on its own card instead of being a
    // heading over it.
    groups: groupRoles(
      zones.flatMap((zone) =>
        zone.factions.map((f) => ({ ...f, zoneName: zone.name })),
      ),
    )
      .map((group) => ({
        slug: group.slug,
        name: group.name,
        roles: group.roles.map((role) => {
          const { faction } = role;
          const cap = roleCapacity(role, playerCount);
          // Locked roles stay in the tree; the card greys itself and says why.
          const playtestLocked =
            playtestMode &&
            isPlaytestLocked({ role, zoneName: faction.zoneName });
          return {
            id: role.id,
            name: role.name,
            intro: role.intro,
            slug: role.slug,
            // Null for ordinary seats; set on the four dynasty roles.
            lockedGender: role.lockedGender,
            difficulty: role.difficulty,
            // Printed on the card itself, now that the faction is no longer
            // a heading over it.
            factionName: faction.name,
            startingLocationName: role.startingLocation?.name ?? null,
            startingZoneName: role.startingLocation?.zone?.name ?? null,
            startingResources: role.startingResources,
            extraStartingPoints: role.extraStartingPoints,
            // Parsed, because the wizard matches these against catalog tag names
            // and an entry may carry a count ("Obol x5").
            startingTagNames: startingTagNames(role.startingTagSlugs),
            grantsLeader: role.grantsLeader,
            // Drives the "Whitelist only" hover on a greyed card. Separate
            // from grantsLeader, which now only means faction Leader.
            requiresWhitelist: role.requiresWhitelist,
            whitelistBlocked: role.requiresWhitelist && !leaderWhitelisted,
            // Infinity doesn't serialize; uncapped roles cross as null -> "∞".
            cap: cap === Infinity ? null : cap,
            taken: takenByRole.get(role.id) ?? 0,
            selectable: isRoleSelectable({
              role,
              cursed,
              leaderWhitelisted,
              playtestLocked,
            }),
            playtestLocked,
            // Resolved server-side so a client component never drags
            // PrismaClient into the browser bundle.
            lastNameLocked: isDynastyMember(role.slug),
          };
        }),
      }))
      .filter((g) => g.roles.length > 0),
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
      // The Location's own zone kind rides along so canBuildHere() can judge
      // this ground without a second round-trip (db/lib/structures.js) — the
      // character's own `zone` above is their presence zone, not the
      // Location's, and building is a fact about the ground.
      location: { include: { zone: { select: { kind: true } } } },
      role: { select: { slug: true } },
      // requirementSkills must be named explicitly: `include` doesn't pull
      // unnamed relations, and formatTagRequirement's `?.length` guard would
      // silently drop it rather than fail.
      tags: {
        include: {
          tag: {
            include: {
              group: true,
              requirementSkills: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  // No living character — this IS the create-a-character screen.
  if (!character) {
    const { gate, ...creation } = await loadCreationData(session.discordUserId);
    if (!gate.open || !gate.approved)
      return <CreationClosed open={gate.open} />;
    return <CreateCharacterWizard {...creation} />;
  }

  const [
    openTurn,
    tagCatalog,
    tierRows,
    desireHistory,
    desireTemplateRows,
    gameConfig,
    { action: currentAction },
  ] = await Promise.all([
    getOpenTurn(),
    // getVisibleTags doesn't select purchasable/craftable, so this comes
    // down as its own props, same as the creation wizard.
    prisma.tag.findMany({
      where: { OR: [{ purchasable: true }, { craftable: true }] },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        // slug so needsWorkshop() can exempt workshop-equipment itself
        // (web/lib/tagRequests.js) — you build your first forge in the open.
        slug: true,
        description: true,
        category: true,
        pointCost: true,
        purchasable: true,
        // addableTags' purchasable branch requires this or it reads
        // undefined and drops purchasable-only tags from the Add Tag menu.
        purchasableAfterStart: true,
        craftable: true,
        // A craftable carrying `placement` is raised on the ground instead
        // of landing in a pocket (db/lib/structures.js). The whole JSON
        // crosses rather than a boolean: the menu needs `unique` too, and
        // the column is three or four small keys.
        placement: true,
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
        // Craft enforces recipe skills (CRAFTING.md); `knownRecipeIds`
        // below is the server's verdict per recipe.
        requirementSkills: { select: { id: true, name: true, slug: true } },
        requirementTurns: true,
        requirementResources: true,
        requirementPerTurn: true,
        // So the Craft menu can say what a piece of armour is worth before
        // somebody spends two turns and 26 ⬢ finding out.
        meleeArmor: true,
        ballisticArmor: true,
        conflictsWith: { select: { id: true } },
      },
    }),
    // id -> parentTagId for the whole catalog, to resolve a held tier back
    // down its chain to its gate.
    prisma.tag.findMany({
      select: { id: true, slug: true, parentTagId: true },
    }),
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
        template: {
          select: { tier: true, cooldownTurns: true, onceEver: true },
        },
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
        maxDrawbackPoints: true,
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
  const hiddenTagIds = await computeHiddenDesireTagIds(
    prisma,
    heldDesireTagIds,
  );
  const roleBySlugForDesires = await loadRoleBySlugForTemplates(
    prisma,
    desireTemplateRows,
  );
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
  const desireAddiction = bottomSlotAddiction(
    character.tags.map((ct) => ct.tag),
  );

  // Held ids widen the store catalog so unpurchasable held tags (a
  // GM-granted item) still reach the client's byId map.
  const heldIds = character.tags.map((ct) => ct.tagId);
  const storeTags = await loadPointBuyCatalog(heldIds);
  const heldSet = new Set(heldIds);
  const storeHeldTags = storeTags
    .filter((t) => heldSet.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
  // The people a sheet can act on: standing at this Location, alive and
  // unconcealed (web/lib/peopleHere.js). One roster for every picker, so
  // the menus can't disagree — and the server re-checks the same predicate.
  // `here` carries what Heal and Learn need; `bodiesAndHelpless` is the
  // roster for the actions that also work on a corpse.
  const here = await peopleHere(character, {
    select: {
      id: true,
      name: true,
      // No `resources` — a balance is nobody else's business.
      tags: {
        select: {
          tagId: true,
          tag: {
            select: {
              id: true,
              name: true,
              slug: true,
              healable: true,
              requirementTurns: true,
              requirementResources: true,
              requirementGambit: true,
              requirementSkills: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  const selfEntry = { id: character.id, name: character.name };
  const peopleParties = [
    selfEntry,
    ...here.map(({ id, name }) => ({ id, name })),
  ];

  // Plus every Room stash at this Location the character can get into
  // (CARRY.md) — with its contents, since pulling out of one means seeing
  // what's there. A room you can't enter isn't listed: it's a locked door.
  const heldSlugsForRooms = new Set(character.tags.map((ct) => ct.tag.slug));
  // Rooms somebody let this character into by hand — the other half of the
  // door, and the reason this page and the Transfer gate agree (CARRY.md).
  const guestRoomIds = await roomGuestIds(prisma, character.id);
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
            select: {
              tagId: true,
              quantity: true,
              // weightLbs/category ride along so the Transfer dialog can
              // project what pulling a stash out would do to your load.
              tag: {
                select: {
                  name: true,
                  stackable: true,
                  weightLbs: true,
                  category: true,
                },
              },
            },
          },
        },
      })
    : [];
  const rooms = accessibleRooms(roomsHere, heldSlugsForRooms, guestRoomIds).map(
    (r) => ({
      id: r.id,
      name: r.name,
      resources: r.resources,
      tags: r.tags.map((rt) => ({
        tagId: rt.tagId,
        name: rt.tag.name,
        quantity: rt.quantity,
        stackable: rt.tag.stackable,
        weightLbs: rt.tag.category === "Assets" ? 0 : (rt.tag.weightLbs ?? 0),
      })),
    }),
  );
  // Every body in reach, for Butcher and Bury (docs/systemdocs/CORPSES.md).
  // Handed the ALREADY-FILTERED room list so it costs no second round-trip and
  // — more importantly — so the menu is built from exactly the rooms the
  // server-side re-check will use. A locked door is not a scouting target.
  const corpses = await corpsesInReach(prisma, character, {
    rooms: accessibleRooms(roomsHere, heldSlugsForRooms, guestRoomIds),
  });
  // A fact about your own sheet, so the button may grey on it. Resolved here
  // rather than in the client so no slug matching reaches the browser.
  const canButcher = character.tags.some((ct) => ct.tag.slug === BUTCHER_SLUG);

  // From is you or a room; To is anyone here or a room (TransferDialog.js).
  const transferParties = { characters: peopleParties, rooms };
  // Your faction's silo, if it has one and you are standing in its zone: a
  // deposit-only destination pinned above the rooms here (FACTIONS.md). The
  // `here` flag says whether it is already in `rooms` above, so the dialog
  // doesn't list the same room twice; `canOpen` is what decides whether the
  // dialog warns that this is a one-way trip.
  const siloFaction = character.factionId
    ? await prisma.faction.findFirst({
        where: { id: character.factionId, siloRoomId: { not: null } },
        select: {
          siloRoom: {
            select: {
              id: true,
              name: true,
              kind: true,
              accessTagSlugs: true,
              locationId: true,
              location: { select: { name: true, zoneId: true } },
            },
          },
        },
      })
    : null;
  const siloRoom = siloFaction?.siloRoom ?? null;
  const transferSilo =
    siloRoom &&
    character.zoneId &&
    siloRoom.location.zoneId === character.zoneId
      ? {
          id: siloRoom.id,
          name: siloRoom.name,
          locationName: siloRoom.location.name,
          here: siloRoom.locationId === character.locationId,
          canOpen:
            accessibleRooms(
              [
                {
                  id: siloRoom.id,
                  kind: siloRoom.kind,
                  accessTagSlugs: siloRoom.accessTagSlugs,
                },
              ],
              heldSlugsForRooms,
              guestRoomIds,
            ).length === 1,
        }
      : null;
  // Is a forge within reach? Resolved server-side so the Craft dialog can say
  // so before a player commits, and re-checked by craftRequest either way.
  const hasWorkshop = await hasEquipmentInReach(
    prisma,
    character,
    WORKSHOP_EQUIPMENT_SLUG,
  );
  // The Godard Factory's two buttons (docs/systemdocs/FACTORY.md). Both HIDE
  // where the place is wrong rather than greying — a fact about where this
  // character is standing, which is theirs already, so nothing about the room
  // leaks the way the metagaming rule in actionRegistry.js guards against.
  const canSeeExtract = hasAttribute(character.location, GODFLESH_ATTRIBUTE);
  const extractTool = canSeeExtract ? extractToolFor(character.tags) : null;
  const canExtract = Boolean(extractTool);
  const extractBlocked =
    canSeeExtract && !canExtract
      ? "You need a hatchet, a battle-axe or a chainsaw in your hands. ‡"
      : null;
  const canSeePackage = await hasEquipmentInReach(
    prisma,
    character,
    PACKAGING_EQUIPMENT_SLUG,
  );
  const carry = carryStatus(character, gameConfig);
  // Free zone crossings left this turn (CARRY.md §2). Resolved server-side so
  // no allowance math reaches the client bundle.
  const zoneMoves = freeMovesLeft(character, gameConfig, openTurn);
  const zoneMovesReason = freeZoneMovesReason(character);
  // Whether their eyes are good enough to look anybody over — Nearsighted
  // without spectacles on, Sun Sensitivity in daylight. Resolved server-side
  // so the sentence the grid shows and the one examineActions.js refuses with
  // are the same sentence.
  const examineBlocked = examineBlock(character.tags, {
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  });
  // Healing. The medical gate is resolved here, server-side, so no
  // tier-chain math reaches the client bundle.
  const ancestry = buildSkillAncestry(tierRows);
  const satisfied = satisfiedSkillIds(
    character.tags.map((ct) => ct.tagId),
    ancestry,
  );
  const healSkillId = tierRows.find((t) => t.slug === HEAL_SKILL_SLUG)?.id;
  const canHeal = Boolean(healSkillId && satisfied.has(healSkillId));

  // Craft (CRAFTING.md): the recipes whose every skill this character holds
  // (or a higher tier of), decided here and re-checked by craftRequest. The
  // client filters its picker to these ids and nothing else.
  const knownRecipeIds = tagCatalog
    .filter(
      (t) =>
        t.craftable &&
        (t.requirementSkills ?? []).every((skill) => satisfied.has(skill.id)),
    )
    .map((t) => t.id);
  const craftProjects = (
    await prisma.craftProject.findMany({
      where: { characterId: character.id, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        quantity: true,
        turnsNeeded: true,
        turnsDone: true,
        resourcesCost: true,
        payerName: true,
        lastTurnId: true,
        tag: { select: { id: true, name: true } },
      },
    })
  ).map((p) => ({
    id: p.id,
    tagId: p.tag.id,
    tagName: p.tag.name,
    quantity: p.quantity,
    turnsNeeded: p.turnsNeeded,
    turnsDone: p.turnsDone,
    resourcesCost: p.resourcesCost,
    payerName: p.payerName,
    // Advanced this turn already — Continue greys until the next one.
    workedThisTurn: Boolean(openTurn && p.lastTurnId === openTurn.id),
  }));

  // Building (db/lib/structures.js). EVERY status comes down: the standing-
  // here panel lists a ruin as readily as a finished wall, and the Craft
  // dialog narrows to UNDER_CONSTRUCTION itself. Projected rather than passed
  // whole — the Prisma row carries Dates and a payer key that no client
  // surface has any business with.
  const sitesHere = (await structuresAt(prisma, character.locationId)).map(
    (s) => ({
      id: s.id,
      typeSlug: s.typeSlug,
      typeName: s.typeName,
      status: s.status,
      turnsDone: s.turnsDone,
      turnsNeeded: s.turnsNeeded,
      // Only the opener may call a site off, and cancelBuildSite re-checks it.
      mine: s.builderCharacterId === character.id,
    }),
  );
  // Whether this ground takes a structure at all, so the Craft menu can drop
  // the placements rather than offer a refusal. craftRequest judges the same
  // ground again with the same function.
  const buildable = canBuildHere(character.location).ok;

  // A fact about your own sheet, so this one may grey the button out.
  const heldSlugs = new Set(character.tags.map((ct) => ct.tag.slug));
  const hasBird = holdsBirdAndLetters(character.tags);
  // Paperwork (docs/systemdocs/PAPERWORK.md). Letters AND eyes — the same
  // predicate the tag chips, the noticeboard and paperActions.js all use, so
  // the button, the chip and the server's refusal can never disagree.
  const canReadNow = canRead(character.tags, {
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  });
  // Something to write ON: a blank sheet, or a note already started. A sealed
  // letter does not count — you would have to break the seal first.
  const writables = character.tags.filter(
    (ct) => ct.tag.slug === PAPER_SLUG || ct.tag.paperKind === "PAPER",
  );
  const canWrite = canReadNow && writables.length > 0;
  // Wax stamps in hand, and letters worth closing. Both are facts about your
  // own sheet, so both may hide or grey the button.
  const seals = character.tags.filter((ct) => isSeal(ct.tag));
  const hasSeal = seals.length > 0;
  const sealables = character.tags.filter(
    (ct) => ct.tag.paperKind === "PAPER" && (ct.tag.paperText ?? "").trim(),
  );
  const canSeal = hasSeal && sealables.length > 0;

  // Binding and tearing up (docs/systemdocs/PAPERWORK.md). Both are facts about
  // your own sheet — a stack of ten, or a book in your hands — so both may grey
  // or hide their button. Binding needs letters as well, because you write the
  // whole thing in one pass; tearing one up needs none at all.
  const blankStock = character.tags.find((ct) => ct.tag.slug === PAPER_SLUG);
  const sheetsHeld = blankStock?.quantity ?? 0;
  const canBindBook = canReadNow && sheetsHeld >= BOOK_SHEETS;
  // Why the button is dead, so a player reads it off the tooltip instead of
  // writing a whole book into the box and finding out at the submit.
  const bindBlocked = canBindBook
    ? null
    : `You have ${sheetsHeld} of the ${BOOK_SHEETS} blank sheets a book takes. ‡`;
  const books = character.tags.filter((ct) => isBook(ct.tag));

  // What the two dialogs list. The TEXT is deliberately not sent — the dialog
  // asks for it on demand (paperActions.js#readMyPaper) so an unreadable sheet
  // never has its contents sitting in a client payload waiting to be read out
  // of the page source. The excerpt below is the same one the chip shows and
  // is already gated by canReadNow.
  const paperOptions = writables.map((ct) => ({
    tagId: ct.tagId,
    name: ct.tag.name,
    blank: ct.tag.slug === PAPER_SLUG,
    quantity: ct.quantity,
    // Enough to tell two notes apart in a dropdown, and only for a reader.
    excerpt:
      canReadNow && ct.tag.paperKind === "PAPER"
        ? (ct.tag.paperText ?? "").trim().slice(0, 60)
        : null,
  }));
  // Everything a bird could carry. Sealed letters included — a courier does
  // not have to be able to read what they are carrying, which is rather the
  // use of an illiterate one.
  const letterOptions = character.tags
    .filter(
      (ct) => ct.tag.paperKind === "PAPER" || ct.tag.paperKind === "SEALED",
    )
    .map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      excerpt:
        canReadNow && ct.tag.paperKind === "PAPER"
          ? (ct.tag.paperText ?? "").trim().slice(0, 60)
          : null,
    }));
  // Books in hand, for the Tear Up picker. No excerpt: a book's NAME is its
  // title and already says which one it is, unlike a note's waybill code.
  const bookOptions = books.map((ct) => ({
    tagId: ct.tagId,
    name: ct.tag.name,
  }));
  const sealOptions = {
    stamps: seals.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      label: sealLabel(ct.tag),
    })),
    letters: sealables.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      excerpt: canReadNow ? (ct.tag.paperText ?? "").trim().slice(0, 60) : null,
    })),
  };

  // The sheet itself goes to a client component, so the raw text of every
  // paper on it would otherwise sit in the page source — readable straight out
  // of DevTools by a holder who is blind, drunk or illiterate, which is the
  // one thing this whole system exists to prevent. Strip it here and compose
  // the description the same way getVisibleTags does.
  //
  // Holding a letter is not the same as being able to read it. That is the
  // entire point of an illiterate courier.
  const viewer = {
    tags: character.tags,
    phase: openTurn?.phase ?? null,
    indoors: character.location?.indoors ?? true,
  };
  const sheetCharacter = {
    ...character,
    tags: character.tags.map((ct) => {
      if (!isPaper(ct.tag)) return ct;
      const { paperText, ...tag } = ct.tag;
      return {
        ...ct,
        tag: { ...tag, description: paperDescription(ct.tag, viewer) },
      };
    }),
  };
  // Compared against the in-game DAY (birdTurnId stores the day), not the
  // turn. Advisory only — the server's conditional claim is the real gate.
  const birdSentToday =
    Boolean(openTurn) &&
    character.birdTurnId === String(describeTurn(openTurn).day);

  // Patients: yourself and everyone here, filtered to treatable tags HERE,
  // not the client, so nobody else's full sheet crosses the wire. Skipped for
  // the majority who aren't medics.
  const selfAsPatient = {
    id: character.id,
    name: character.name,
    tags: character.tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })),
  };
  const healTargets = (canHeal ? [selfAsPatient, ...here] : [])
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
          // Above your tier, or the ladder's top rung, and it's a roll rather
          // than a refusal — so the picker offers it, labelled, instead of
          // greying it out (docs/systemdocs/TAGS.md §5c).
          gambit: isGambitHeal(tag, satisfied),
          // A 0-turn cure is a free action and never counts against the day's
          // allowance (web/lib/requests.js MEDICAL_TIER_CAPS).
          counts: countsAgainstHealCap(tag),
        })),
    }))
    .filter((t) => t.healable.length > 0);

  // Routine cures left in the medic's day (web/lib/requests.js
  // MEDICAL_TIER_CAPS). The predicate MUST match routineHealsThisTurn in
  // requestActions.js exactly — a first-aid cure and a Gambit both cost
  // nothing here, and a number that disagreed with the one the action
  // enforces would grey out a treatment the server would have accepted.
  // Resolved server-side; the action re-checks under a row lock either way.
  const heldSlugSet = new Set(character.tags.map((ct) => ct.tag.slug));
  const healsLeft = canHeal
    ? Math.max(
        0,
        healCapFor(heldSlugSet, MEDICAL_TIER_CAPS) -
          (openTurn
            ? (
                await prisma.request.findMany({
                  where: {
                    characterId: character.id,
                    turnId: openTurn.id,
                    type: "HEAL_CHARACTER",
                    status: { not: "UNDONE" },
                  },
                  select: { effect: true },
                })
              ).filter(
                (r) =>
                  !r.effect?.gambit && (r.effect?.requirement?.turns ?? 0) > 0,
              ).length
            : 0),
      )
    : 0;

  // Who can pay: you, anyone here, or a room stash here (same as Craft).
  const healParties = { characters: peopleParties, rooms };

  // ONE roster for every action on somebody standing here (Loot, Move,
  // Bind, Free, Harm), including the unburied dead.
  const zoneRoster = await peopleHere(character, {
    includeDead: true,
    select: {
      id: true,
      name: true,
      status: true,
      resources: true,
      tags: {
        select: {
          tagId: true,
          quantity: true,
          tag: {
            select: {
              name: true,
              slug: true,
              category: true,
              stackable: true,
              tradeable: true,
            },
          },
        },
      },
    },
  });

  // Lessons (LESSONS.md). `teachers`: everyone here who can teach, each with
  // the skills they could teach ME — computed server-side so only skills I
  // could learn cross the wire, never their sheet. `learners`: when I hold
  // Teaching, everyone here with what I could teach them. Both empty lists
  // otherwise. `pendingOffers`: the handshakes I'm part of this turn.
  const lessonCatalog = await prisma.tag.findMany({
    select: LESSON_CATALOG_SELECT,
  });
  const meForLessons = {
    id: character.id,
    tags: character.tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })),
  };
  const hereForLessons = here.map((c) => ({
    id: c.id,
    name: c.name,
    tags: c.tags,
  }));
  const teachers = hereForLessons
    .filter((c) => isTeacher(c))
    .map((c) => ({
      id: c.id,
      name: c.name,
      skills: teachableSkills(c, meForLessons, lessonCatalog).map((t) => ({
        id: t.id,
        name: t.name,
      })),
    }))
    .filter((c) => c.skills.length > 0);
  const canTeach = isTeacher(meForLessons);
  const learners = canTeach
    ? hereForLessons
        .map((c) => ({
          id: c.id,
          name: c.name,
          skills: teachableSkills(meForLessons, c, lessonCatalog).map((t) => ({
            id: t.id,
            name: t.name,
          })),
        }))
        .filter((c) => c.skills.length > 0)
    : [];
  // Confession (CONFESSION.md). Only the penitent gets a menu: `confessors`
  // is everyone here holding the Chaplain tag, `mySins` my own psychological
  // tags. There is deliberately NO list built for a chaplain — one would show
  // them everybody's addictions before they had agreed to hear a word.
  const confessors = here
    .filter((c) => c.tags.some((ct) => ct.tag.slug === "chaplain"))
    .map((c) => ({ id: c.id, name: c.name }));
  const mySins = (
    await prisma.characterTag.findMany({
      where: { characterId: character.id, tag: { psychological: true } },
      select: { tag: { select: { id: true, name: true } } },
    })
  )
    .map((ct) => ct.tag)
    .sort((a, b) => a.name.localeCompare(b.name));

  const pendingOffers = openTurn
    ? (
        await prisma.offer.findMany({
          where: {
            turnId: openTurn.id,
            status: "PENDING",
            OR: [{ initiatorId: character.id }, { responderId: character.id }],
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            kind: true,
            initiatorId: true,
            responderId: true,
            tag: { select: { name: true } },
          },
        })
      ).map((o) => {
        const otherId =
          o.initiatorId === character.id ? o.responderId : o.initiatorId;
        const other = [...here, ...zoneRoster].find((c) => c.id === otherId);
        return {
          id: o.id,
          kind: o.kind,
          mine: o.initiatorId === character.id,
          otherName: other?.name ?? "someone",
          // A chaplain waiting on a confession is not told what it is about,
          // here or anywhere else. The penitent sees their own.
          tagName:
            o.kind === "CONFESSION" && o.responderId === character.id
              ? null
              : (o.tag?.name ?? null),
        };
      })
    : [];

  // The catalog name of whichever incapacitating tag they hold.
  function conditionOf(c) {
    return (
      c.tags.find((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))?.tag.name ??
      null
    );
  }
  const helpless = zoneRoster.filter(
    (c) => c.status === "DEAD" || conditionOf(c),
  );

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

  // Everyone here, not just who you may move: the server's own gate says
  // who follows, and a menu that narrowed to the bound would announce them.
  const moveTargets = zoneRoster.map(({ id, name, status }) => ({
    id,
    name,
    status,
  }));

  // Where you may walk someone: the neighbours of YOUR OWN location, the same
  // edge an ordinary walk uses, gated the same way. travelOptions drops the
  // hidden ways this character holds no key to, and `passable` drops the
  // locked and the shut — a walk-someone dialog has no room to explain a
  // refusal, so it only ever offers a hop that will actually work. Each
  // option carries its zone so the dialog can warn that the hop crosses one.
  const moveLocations = character.locationId
    ? (await travelOptions(prisma, character, character.locationId))
        .filter((row) => row.passable)
        .map((row) => ({
          id: row.location.id,
          name: row.location.name,
          zoneName: row.location.zone?.name ?? null,
          // The UI says "crosses into Fortress" only for an edge that leaves
          // the zone you're standing in.
          crossesZone: row.crossesZone,
        }))
    : [];

  // Only fetched for someone who holds a bird. Recipient list is EVERY
  // character regardless of status; a letter to a dead name never arrives.
  const birdTargets = hasBird
    ? await prisma.character.findMany({
        where: { id: { not: character.id } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      })
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
  const forcedIdentity = forcedTag
    ? { name: forcedTag.forcedName, tagName: forcedTag.name }
    : null;
  // And what is over their face, which decides whether the conceal switch is
  // usable at all (PROXYING.md §5). Named here rather than in AvatarField so
  // the refusal can say WHICH thing is doing it.
  const concealingTag =
    character.tags
      .filter((ct) => ct.equipped && ct.tag.concealsIdentity)
      .sort((a, b) => (b.tag.equipLayer ?? 0) - (a.tag.equipLayer ?? 0))[0]
      ?.tag ?? null;
  const concealGear = concealingTag
    ? {
        tagName: concealingTag.name,
        forced: Boolean(concealingTag.forcesConceal),
      }
    : null;
  const avatarSrc = forcedIdentity
    ? presentedIdentity(character, { forcedName: forcedIdentity.name })
        .avatarPath
    : `/api/avatar/${character.id}?v=${character.updatedAt.getTime()}`;

  // The Move cutoff for StatusPanel's "This turn" row.
  const openTurnWithWindow = openTurn
    ? {
        ...openTurn,
        moveWindow: moveWindow(openTurn, {
          autoTurnAdvanceDisabled: gameConfig?.autoTurnAdvanceDisabled ?? false,
        }),
      }
    : openTurn;

  // A Gambit's die is rolled at submit but revealed only in the turn-end DM;
  // stripped here since currentAction crosses into a client component.
  const sheetAction = currentAction
    ? { ...currentAction, diceRoll: null, diceModifier: null }
    : currentAction;

  return (
    <CharacterSheet
      character={sheetCharacter}
      mode="self"
      openTurn={openTurnWithWindow}
      currentAction={sheetAction}
      avatarSrc={avatarSrc}
      forcedIdentity={forcedIdentity}
      concealGear={concealGear}
      transferParties={transferParties}
      transferSilo={transferSilo}
      carry={carry}
      zoneMoves={zoneMoves}
      zoneMovesReason={zoneMovesReason}
      examineBlocked={examineBlocked}
      hasWorkshop={hasWorkshop}
      tagCatalog={tagCatalog}
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
      healsLeft={healsLeft}
      hasMoved={Boolean(currentAction)}
      canTeach={canTeach}
      knownRecipeIds={knownRecipeIds}
      craftProjects={craftProjects}
      sitesHere={sitesHere}
      buildable={buildable}
      teachers={teachers}
      learners={learners}
      confessors={confessors}
      mySins={mySins}
      pendingOffers={pendingOffers}
      hasBird={hasBird}
      canRead={canReadNow}
      canWrite={canWrite}
      hasSeal={hasSeal}
      canSeal={canSeal}
      paperOptions={paperOptions}
      letterOptions={letterOptions}
      sealOptions={sealOptions}
      canBindBook={canBindBook}
      bindBlocked={bindBlocked}
      bookOptions={bookOptions}
      birdSentToday={birdSentToday}
      birdTargets={birdTargets}
      birdZones={birdZoneOptions}
      equipSlots={gameConfig?.equipSlots ?? 6}
      avatarUploadsEnabled={gameConfig?.avatarUploadsEnabled ?? false}
      portraitMakerEnabled={gameConfig?.portraitMakerEnabled ?? false}
      portraitFantasyPartsEnabled={
        gameConfig?.portraitFantasyPartsEnabled ?? false
      }
      // Re-validated here: a stored index can outlive a catalog change.
      portraitSelection={parseSelection(character.portrait, {
        allowFantasy: gameConfig?.portraitFantasyPartsEnabled ?? false,
      })}
      hasCustomAvatar={Boolean(character.avatarMimeType)}
      healTargets={healTargets}
      healParties={healParties}
      corpses={corpses}
      canButcher={canButcher}
      canSeeExtract={canSeeExtract}
      canExtract={canExtract}
      extractBlocked={extractBlocked}
      canSeePackage={canSeePackage}
      lootTargets={lootTargets}
      moveTargets={moveTargets}
      moveLocations={moveLocations}
      bindTargets={bindTargets}
      harmTargets={harmTargets}
      harmTags={harmTags}
      lastNameLocked={isDynastyMember(character.role?.slug)}
      storeTags={storeTags}
      storeHeldTags={storeHeldTags}
      storeRoleSlug={character.role?.slug ?? null}
    />
  );
}
