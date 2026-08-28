import { redirect } from "next/navigation";
import { prisma, roleCapacity, isDynastyMember } from "@lifeweb/db";
import { takenCounts } from "@lifeweb/db/lib/roleReservation";
import { auth } from "@/lib/auth";
import { dynastyLastName } from "@/lib/dynasty";
import { getOpenTurn } from "@/lib/turn";
import {
  getGuildMember,
  isApprovedPlayer,
  isCursed,
  isLeaderWhitelisted,
} from "@/lib/discordGuild";
import {
  isPlaytestLocked,
  isRoleSelectable,
  DEFAULT_MAX_NEGATIVE_TAGS,
} from "@/lib/characterCreation";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import { isSuperadmin } from "@/lib/superadmin";
import { formatTagRequirement } from "@/lib/formatTagRequirement";
import { TRANSFERABLE_CATEGORIES } from "@/lib/tagRequests";
import { INCAPACITATING_SLUGS, FINISHABLE_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { parseSelection } from "@/lib/portrait/catalog";
import {
  HEALABLE_CATEGORY,
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
// tree it renders. Seat counts (ALIVE characters + live reservations, see
// takenCounts) are computed here rather than in the client so the numbers
// can't be stale-rendered from a cached page. This is still only advisory —
// createActions.js takes the actual lock inside the create transaction.
async function loadCreationData(discordUserId) {
  const [zones, tags, config, member, dynastyName] = await Promise.all([
    prisma.zone.findMany({
      orderBy: { name: "asc" },
      include: {
        factions: {
          orderBy: { sortOrder: "asc" },
          include: {
            roles: { orderBy: { sortOrder: "asc" }, include: { startingZone: true } },
          },
        },
      },
    }),
    loadPointBuyCatalog(),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    getGuildMember(discordUserId),
    // Shown on the (locked) last-name input if a family seat is picked.
    dynastyLastName(),
  ]);

  // ALIVE characters plus anyone else's live wizard-in-progress hold — see
  // db/lib/roleReservation.js. Excludes the viewer's own hold, so a role
  // they're mid-reserving on renders taken to everyone but them.
  const roleIds = zones.flatMap((zone) => zone.factions.flatMap((faction) => faction.roles.map((r) => r.id)));
  const takenByRole = await takenCounts(prisma, roleIds, discordUserId);

  const cursed = isCursed(member);
  // Mirrors the bypass in createCharacter so the host sees the wizard rather
  // than the locked-out screen. The server action re-checks regardless — this
  // is presentation, that is enforcement.
  const superadmin = isSuperadmin(discordUserId);
  const gate = {
    open: superadmin || config?.openToPlayers === true,
    approved: superadmin || isApprovedPlayer(member),
  };
  // The whitelist gate itself is a Dev Panel switch (GameConfig). `=== false`
  // rather than a falsy check on purpose: no config row means the gate stays
  // enforced, matching the fail-closed posture in db/lib/roleIds.js.
  const leaderWhitelisted =
    superadmin || config?.leaderWhitelistEnabled === false || isLeaderWhitelisted(member);
  // No superadmin bypass here, unlike the two gates above: this one holds back
  // an unfinished role, so the host wants it locked too (characterCreation.js).
  const playtestMode = config?.playtestModeEnabled === true;
  const playerCount = config?.playerCount ?? 100;

  return {
    gate,
    cursed,
    dynastyName,
    playerCount,
    startingTagPoints: config?.startingTagPoints ?? 0,
    maxNegativeTags: config?.maxNegativeTags ?? DEFAULT_MAX_NEGATIVE_TAGS,
    // Already flattened to PointBuy's shape by loadPointBuyCatalog — shared
    // with /store so the two menus can never disagree.
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
              // Locked roles stay in the tree rather than being filtered out,
              // so a player can still read the charter of a role that's simply
              // shut for this run. The card greys itself and says why.
              const playtestLocked =
                playtestMode && isPlaytestLocked({ role, zoneName: zone.name });
              return {
                id: role.id,
                name: role.name,
                intro: role.intro,
                // Some titles are earned by role rather than by tag, and
                // db/lib/titles.js keys on the slug (see the Identity step).
                slug: role.slug,
                // Null for every ordinary seat; set on the four dynasty roles,
                // which fix their holder's gender the same way they hand down
                // the surname. The wizard renders the picker disabled at this
                // value, and createCharacter stamps it regardless.
                lockedGender: role.lockedGender,
                difficulty: role.difficulty,
                factionName: faction.name,
                startingZoneName: role.startingZone?.name ?? null,
                startingResources: role.startingResources,
                extraStartingPoints: role.extraStartingPoints,
                startingTagNames: role.startingTagSlugs,
                grantsLeader: role.grantsLeader,
                // Infinity doesn't survive serialization to the client, so
                // uncapped roles cross the boundary as null and render "∞".
                cap: cap === Infinity ? null : cap,
                taken: takenByRole.get(role.id) ?? 0,
                // ^ ALIVE characters + everyone else's live wizard-in-progress
                // hold on this seat (db/lib/roleReservation.js#takenCounts) —
                // the viewer's own hold is excluded so their held role never
                // renders as full to them.
                selectable: isRoleSelectable({ role, cursed, leaderWhitelisted, playtestLocked }),
                playtestLocked,
                // The Baron's family don't choose a surname (db/lib/dynasty.js).
                // Resolved here rather than in the wizard so a client component
                // never imports the barrel and drags PrismaClient into the
                // browser bundle.
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
      // Only the slug, and only so the Bio panel can grey out the last name
      // for the Baron's family (db/lib/dynasty.js).
      role: { select: { slug: true } },
      // group comes along so TagChip can tint the chip and label its
      // group/category — /gm/turns and referenceData.js share the same
      // TAG_CHIP_FIELDS select for the same reason.
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
      // The Add Tag menu needs purchasable/craftable, which getVisibleTags (lib/referenceData.js) doesn't
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
          // addableTags' purchasable branch requires purchasableAfterStart;
          // without this select it read undefined and silently dropped every
          // purchasable-only tag from the Add Tag menu.
          purchasableAfterStart: true,
          craftable: true,
          stackable: true,
          // Both gates the Add Tag menu enforces — the per-tag prerequisite and
          // the whole-group one behind a hidden category. parentTagId comes
          // along because requirementSatisfied walks the tier chain.
          parentTagId: true,
          requiredTagId: true,
          // The gates' NAMES, for the picker's "Requires: …" line. Safe:
          // gated tags only render for viewers who hold the gate.
          requiredTag: { select: { name: true } },
          group: {
            select: {
              name: true,
              color: true,
              requiredTagId: true,
              requiredTag: { select: { name: true } },
            },
          },
        },
      }),
      // id -> parentTagId for the whole catalog, so a held Medical (Expert)
      // resolves back down its chain to the Medical (Basic) gate. Four columns
      // over a few hundred rows — cheaper than nesting three parentTag includes.
      prisma.tag.findMany({ select: { id: true, slug: true, parentTagId: true } }),
      prisma.desire.findFirst({ where: { characterId: character.id, status: "ACTIVE" } }),
      prisma.desire.findFirst({
        where: { characterId: character.id, status: { in: ["FULFILLED", "CANCELLED"] } },
        orderBy: { updatedAt: "desc" },
        select: { endedTurnNumber: true },
      }),
      prisma.gameConfig.findUnique({
        where: { id: 1 },
        select: {
          equipSlots: true,
          avatarUploadsEnabled: true,
          portraitMakerEnabled: true,
          portraitFantasyPartsEnabled: true,
          // Read here too, for the Spend Tag Points modal folded in from the
          // old /store page — see store below.
          maxNegativeTags: true,
        },
      }),
    ]);

  // The mid-game tag store, folded into the sheet as a modal (see
  // StorePanel.js). Held ids widen the catalog so unpurchasable held tags (a
  // GM-granted Demoness, a crafted item) still reach the client's byId map —
  // chain discounts and hidden-category gates key off them. This reuses
  // character.tags, already loaded above, rather than re-querying the sheet.
  const heldIds = character.tags.map((ct) => ct.tagId);
  const storeTags = await loadPointBuyCatalog(heldIds);
  const heldSet = new Set(heldIds);
  const storeHeldTags = storeTags
    .filter((t) => heldSet.has(t.id))
    .map((t) => ({ id: t.id, name: t.name }));
  // Drawbacks already spent, for PointBuy's counter. Every negative tag is
  // purchasableAfterStart: false, so the store can't sell one and this number
  // can't move here — it is shown so a player knows where they stand, not to
  // gate the cart. Only POINT_BUY counts: a GM-inflicted wound is not a
  // choice the player made with their points.
  const storeCostById = new Map(storeTags.map((t) => [t.id, t.pointCost]));
  const storeNegativeHeld = character.tags.filter(
    (ct) => ct.source === "POINT_BUY" && (storeCostById.get(ct.tagId) ?? 0) < 0,
  ).length;

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
  // a GM hasn't placed yet. Character.zoneId is the authoritative "where are
  // you" field since the zone rework — always a presence zone, never the
  // Caves group row.
  const coLocated =
    canHeal && character.zoneId
      ? await prisma.character.findMany({
          where: { status: "ALIVE", zoneId: character.zoneId },
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

  // ONE roster for every action that acts on somebody standing here — Loot,
  // Move Player, Bind, Free and Harm. They used to be (or would have been)
  // five separate queries with five slightly different WHERE clauses, which is
  // five chances for two menus to disagree about who is in the room.
  //
  // Everything is derived and trimmed here rather than in the client, so
  // nobody else's full sheet crosses the wire — only a name, a status, the
  // condition that makes them a valid target, and their Items/Assets.
  //
  // These lists reveal who is standing here and who among them is helpless.
  // That disclosure is the feature: a player has to open a dialog to see it,
  // and the alternative — greying the buttons out — would leak the same fact
  // passively, to everyone, on every page load. See ActionGrid.js.
  const zoneRoster = character.zoneId
    ? await prisma.character.findMany({
        where: {
          zoneId: character.zoneId,
          status: { in: ["ALIVE", "DEAD"] },
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
              tag: { select: { name: true, slug: true, category: true, stackable: true } },
            },
          },
        },
      })
    : [];

  // The catalog name of whichever incapacitating tag they hold, so the target
  // lists read "Mira Solt — Bound" rather than making a player guess why
  // somebody is on the menu. db/lib/incapacitation.js owns the set.
  function conditionOf(c) {
    return c.tags.find((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))?.tag.name ?? null;
  }
  const helpless = zoneRoster.filter((c) => c.status === "DEAD" || conditionOf(c));

  // A body, or anyone who can't stop you. Only Items and Assets come off —
  // the same category gate the transfer system enforces. Someone carrying
  // nothing still appears: the dialog says so, and hiding them would make an
  // empty menu mean two different things.
  const lootTargets = helpless.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    condition: conditionOf(c),
    resources: c.resources,
    tags: c.tags
      .filter((ct) => TRANSFERABLE_CATEGORIES.includes(ct.tag.category))
      .map((ct) => ({
        tagId: ct.tagId,
        tagName: ct.tag.name,
        stackable: ct.tag.stackable,
        quantity: ct.quantity ?? 1,
      })),
  }));

  // Deliberately unfiltered: everyone here, led or bound or neither, plus the
  // bodies. Narrowing it to who you may actually move would turn the menu into
  // a readout of who is tied up — the server's own gate rejects the rest with
  // wording that explains itself.
  const moveTargets = zoneRoster.map(({ id, name, status }) => ({ id, name, status }));
  const moveZones = character.zoneId
    ? (
        await prisma.zone.findUnique({
          where: { id: character.zoneId },
          select: {
            connectsTo: {
              where: { kind: { not: "CAVE_GROUP" } },
              select: { id: true, name: true },
              orderBy: { name: "asc" },
            },
          },
        })
      )?.connectsTo ?? []
    : [];

  // Bind and Free split this one list on `bound`, so the two menus can never
  // disagree about the same person.
  const bindTargets = zoneRoster
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: c.name,
      bound: c.tags.some((ct) => ct.tag.slug === "bound"),
    }));

  // Harm needs someone already helpless, and `finishable` is the narrower
  // Dying-or-Bound gate on the lethal half. Both re-derived server-side.
  const harmTargets = helpless
    .filter((c) => c.status === "ALIVE")
    .map((c) => ({
      id: c.id,
      name: c.name,
      condition: conditionOf(c),
      finishable: c.tags.some((ct) => FINISHABLE_SLUGS.has(ct.tag.slug)),
    }));

  // The injuries that can be inflicted: the same Health category the cure
  // ladder treats (TAGS.md §5c), minus anything a GM or a player invented.
  const harmTags = await prisma.tag.findMany({
    where: { category: HEALABLE_CATEGORY, custom: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      pointCost: true,
      stackable: true,
      group: { select: { name: true, color: true } },
    },
  });

  // What is lying on the ground here. No owner, so no filtering — anyone
  // standing in the zone sees the same pile.
  const groundItems = character.zoneId
    ? (
        await prisma.zoneCache.findMany({
          where: { zoneId: character.zoneId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            quantity: true,
            droppedByName: true,
            tag: { select: { name: true, stackable: true } },
          },
        })
      ).map((g) => ({
        id: g.id,
        tagName: g.tag.name,
        stackable: g.tag.stackable,
        quantity: g.quantity,
        droppedByName: g.droppedByName,
      }))
    : [];

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
      avatarUploadsEnabled={gameConfig?.avatarUploadsEnabled ?? false}
      portraitMakerEnabled={gameConfig?.portraitMakerEnabled ?? false}
      portraitFantasyPartsEnabled={gameConfig?.portraitFantasyPartsEnabled ?? false}
      // Re-validated here rather than trusted from the column: a stored index
      // can outlive a catalog change, and a fantasy part can outlive the
      // switch that allowed it.
      portraitSelection={parseSelection(character.portrait, {
        allowFantasy: gameConfig?.portraitFantasyPartsEnabled ?? false,
      })}
      hasCustomAvatar={Boolean(character.avatarMimeType)}
      healTargets={healTargets}
      healParties={healParties}
      lootTargets={lootTargets}
      moveTargets={moveTargets}
      moveZones={moveZones}
      bindTargets={bindTargets}
      harmTargets={harmTargets}
      harmTags={harmTags}
      groundItems={groundItems}
      lastNameLocked={isDynastyMember(character.role?.slug)}
      storeTags={storeTags}
      storeHeldTags={storeHeldTags}
      storeNegativeCap={gameConfig?.maxNegativeTags ?? DEFAULT_MAX_NEGATIVE_TAGS}
      storeNegativeHeld={storeNegativeHeld}
    />
  );
}
