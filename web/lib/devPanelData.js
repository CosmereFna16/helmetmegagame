import { prisma, isDynastyMember, gambitModifierTotal } from "@lifeweb/db";
import { evaluateDesireCatalog, slotStates } from "@lifeweb/db/lib/desireGates";
import { desireFamilies } from "@lifeweb/db/lib/desireFamilies";
import { getGuildMember, isCursed } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { isHealable } from "@/lib/healRequests";
import { DEFAULT_MAX_DRAWBACK_TAGS } from "@/lib/characterCreation";
import { projectDesireTemplateForGates, loadRoleBySlugForTemplates } from "@/lib/desireProjection";
import { HUNGER_SLUG, ATE_MEAL_SLUG } from "@lifeweb/db/lib/constants";

// The whole data-assembly behind the Dev Character Panel, extracted so it can
// be shared by the standalone page (/gm/dev/characters/[characterId]) and the
// modal mount over /gm/turns (web/app/(desk)/gm/turns/devPanelActions.js).
// Everything the panel needs to OPEN is loaded here, in one Promise.all, and
// handed back as plain DTOs. The Record tab's four history lists are the
// exception — they live in loadDevPanelRecord below and are fetched only when
// a GM opens that tab. DevPanel is a client component (it holds the
// staged-edit state), so nothing Prisma-shaped may cross the boundary: dates
// become ISO strings and only the columns actually rendered come along.
//
// Returns null when the character doesn't exist, so callers can 404/UserError
// as fits their own surface.
export async function loadDevPanelProps(characterId, actingDiscordUserId) {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    include: { role: true, faction: true, zone: true, location: true },
  });
  if (!character) return null;

  const [
    locations,
    roles,
    allTags,
    heldTags,
    config,
    openTurn,
    desires,
    openTurnAction,
    desireTemplates,
    member,
    pendingStaged,
    transferRoster,
  ] = await Promise.all([
    // The place picker's options. A character stands in a Location, never on
    // a zone row, so this is the whole Location table grouped by zone.
    // Authoring order both ways, so the list reads like docs/zones.yaml
    // rather than the alphabet.
    prisma.location.findMany({
      orderBy: [{ zone: { sortOrder: "asc" } }, { sortOrder: "asc" }],
      select: { id: true, name: true, zoneId: true, zone: { select: { name: true } } },
    }),
    prisma.role.findMany({
      orderBy: [{ sortOrder: "asc" }],
      select: { id: true, name: true, slug: true, faction: { select: { name: true } } },
    }),
    // The whole catalog, gates and all: a GM grant deliberately ignores
    // requiredTag and the TagGroup gate (TAGS.md), so unlike getVisibleTags (lib/referenceData.js) this
    // withholds nothing — including the hidden Demoness group.
    prisma.tag.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      // An explicit select, not an include: this is the whole catalog, and
      // every column fetched is a column serialised across to a client
      // component. These are exactly the fields the projection below maps,
      // plus the four the isHealable predicate reads (it only checks
      // requirementSkills for length, hence ids alone).
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        pointCost: true,
        stackable: true,
        equippable: true,
        consumable: true,
        removable: true,
        healable: true,
        teachable: true,
        custom: true,
        defaultDurationTurns: true,
        parentTagId: true,
        requiredTagId: true,
        // The treated-wound aftermath (TAGS.md §5c). The Dev Panel's Holds
        // row needs it to warn before an IMMEDIATE removal: removing a Broken
        // Bone leaves Splinted behind, and re-adding the Broken Bone does not
        // clear it, so that one gesture is the one that can't be undone by
        // repeating its inverse.
        removesInto: true,
        requirementTurns: true,
        requirementResources: true,
        requirementGambit: true,
        requirementSkills: { select: { id: true } },
        group: { select: { name: true, color: true } },
      },
    }),
    prisma.characterTag.findMany({ where: { characterId }, include: { tag: true } }),
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" } }),
    prisma.desire.findMany({
      where: { characterId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { template: { select: { name: true, tier: true, slug: true } } },
    }),
    // This turn's Move, for the state strip's "Acted" fact and the Turn tab.
    // It used to be found inside the 100-row Moves list — but that list moved
    // to loadDevPanelRecord, and refetching 100 rows to read one is not worth
    // it. Only the columns the DTO below actually maps.
    prisma.action.findFirst({
      where: { characterId, turn: { status: "OPEN" } },
      select: {
        id: true,
        description: true,
        moveKind: true,
        moveReviewStatus: true,
        resourceDelta: true,
        diceRoll: true,
        diceModifier: true,
        gmNotes: true,
      },
    }),
    // The full catalog for the GM's picker — retired rows included AND
    // marked (a GM grant bypasses gates entirely, see awardDesireGmImpl), so
    // this is a separate, wider select than the player-facing one in
    // character/page.js.
    prisma.desireTemplate.findMany({
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
    // Cursed is a live Discord role, not a DB field — read the account's
    // current guild roles rather than the Character row.
    getGuildMember(character.discordUserId).catch(() => null),
    // What the adjudication workspace has queued against this sheet for the
    // turn-end push. A GM live-editing resources here and a staged effect are
    // additive and can't corrupt each other — but a GM WILL double-grant
    // without the StateStrip hint this feeds. It depends on nothing above it,
    // so it rides along here rather than costing a second round trip.
    prisma.stagedEffect.findMany({
      where: { targetCharacterId: characterId, appliedAt: null },
      select: { payload: true },
    }),
    // The Transfer dialog's party picker — every other ALIVE character, so a
    // GM can move ⬢ between any two characters, not just this one. Same
    // ALIVE filter resolveParty applies.
    prisma.character.findMany({
      where: { status: "ALIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  // A staged transfer this character is the "to" end of is a pending credit;
  // the "from" end is a pending debit. Folded into the same ⬢ figure as a
  // plain staged `resources` mint/burn so a GM sees the whole pending change
  // to the sheet at once.
  function transferDelta(e) {
    const t = e.payload?.transfer;
    if (!t) return 0;
    if (t.to?.kind === "character" && t.to.id === characterId) return t.amount;
    if (t.from?.kind === "character" && t.from.id === characterId) return -t.amount;
    return 0;
  }

  const stagedForPush = pendingStaged.length
    ? {
        resources: pendingStaged.reduce((sum, e) => sum + (e.payload?.resources ?? 0) + transferDelta(e), 0),
        tagPoints: pendingStaged.reduce((sum, e) => sum + (e.payload?.tagPoints ?? 0), 0),
        tagOps: pendingStaged.reduce((sum, e) => sum + (e.payload?.tagOps?.length ?? 0), 0),
      }
    : null;

  // The GM-facing Desire read-outs for GoalsTab. Two different shapes off the
  // same `desireTemplates` fetch:
  //   - desireCatalog: the full picker list, retired rows included and
  //     flagged — a GM grant bypasses every gate (see awardDesireGmImpl),
  //     so nothing here is filtered the way the player catalog is.
  //   - desireCooldowns: the read-only "what is this character locked out
  //     of" list, run through the SAME evaluator the player catalog uses.
  //     hiddenTagIds is an empty Set on purpose — this is a superadmin-only
  //     page, so nothing is withheld from the GM's own view (constraint:
  //     never let this projection reach a player payload).
  const desireSlotsConfig = config?.desireSlots ?? 2;
  const desireSlotLockTurns = config?.desireSlotLockTurns ?? 2;
  const roleBySlugForDesires = await loadRoleBySlugForTemplates(prisma, desireTemplates);
  const projectedDesireTemplates = desireTemplates.map((t) =>
    projectDesireTemplateForGates(roleBySlugForDesires, t),
  );
  const { visible: desireStatesEvaluated } = evaluateDesireCatalog({
    templates: projectedDesireTemplates,
    heldTags: heldTags.map((ct) => ct.tag),
    hiddenTagIds: new Set(),
    roleSlug: character.role?.slug ?? null,
    history: desires,
    openTurnNumber: openTurn?.number ?? 0,
    desireSlots: desireSlotsConfig,
  });
  const desireCooldowns = desireStatesEvaluated
    .filter((e) => e.state === "cooldown" || e.state === "spent")
    .map((e) => ({
      slug: e.template.slug,
      name: e.template.name,
      tier: e.template.tier,
      state: e.state,
      availableFromTurn: e.availableFromTurn,
    }));
  // Per-slot cooldown + last claim, the same read the player panel gets. A GM
  // award ignores the cooldown, but seeing it is what stops one being handed
  // out by accident into a slot the player is still locked out of.
  const desireSlotStates = slotStates({
    history: desires,
    openTurnNumber: openTurn?.number ?? 0,
    desireSlots: desireSlotsConfig,
    lockTurns: desireSlotLockTurns,
  }).map((slot) => ({
    slotIndex: slot.slotIndex,
    lockedUntilTurn: slot.lockedUntilTurn,
    lastEnded: slot.lastEnded
      ? { id: slot.lastEnded.id, text: slot.lastEnded.text, points: slot.lastEnded.points }
      : null,
  }));
  const desireCatalog = desireTemplates.map((t) => ({
    slug: t.slug,
    name: t.name,
    tier: t.tier,
    families: t.families,
    retired: t.retired,
  }));

  return {
    character: {
      id: character.id,
      discordUserId: character.discordUserId,
      updatedAt: character.updatedAt.toISOString(),
      name: character.name,
      honorific: character.honorific,
      firstName: character.firstName,
      title: character.title,
      lastName: character.lastName,
      gender: character.gender,
      age: character.age,
      appearance: character.appearance,
      roleId: character.roleId,
      roleTitle: character.roleTitle,
      factionId: character.factionId,
      factionName: character.faction?.name ?? null,
      locationId: character.locationId,
      locationName: character.location?.name ?? null,
      zoneId: character.zoneId,
      zoneName: character.zone?.name ?? null,
      status: character.status,
      isLeader: character.isLeader,
      isTreasurer: character.isTreasurer,
      resources: character.resources,
      tagPoints: character.tagPoints,
      turnPingOptIn: character.turnPingOptIn,
      discordRoleId: character.discordRoleId,
      avatarMimeType: character.avatarMimeType,
      hasAvatar: Boolean(character.avatarMimeType),
    },
    discord: {
      username: member?.user?.username ?? null,
      nickname: member?.nick ?? null,
      cursed: isCursed(member),
      present: Boolean(member),
    },
    // lastNameLocked is read off the already-loaded role rather than a
    // second query. The dynasty name is changed by editing the Baron,
    // which propagates to all three of his family.
    lastNameLocked: isDynastyMember(character.role?.slug),
    canDelete: isSuperadmin(actingDiscordUserId),
    transferRoster,
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      zoneId: l.zoneId,
      zoneName: l.zone?.name ?? null,
    })),
    roles: roles.map((r) => ({ id: r.id, name: r.name, factionName: r.faction?.name ?? null })),
    tags: allTags.map((t) => ({
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
      teachable: t.teachable,
      custom: t.custom,
      defaultDurationTurns: t.defaultDurationTurns,
      parentTagId: t.parentTagId,
      requiredTagId: t.requiredTagId,
      // Slugs, resolved to names client-side against this same list.
      removesInto: t.removesInto,
      group: t.group,
      // Precomputed server-side so the Heal-all and Inflict-wound
      // staging buttons and the server action agree on what an
      // affliction is — isHealable is the shared predicate.
      healable: isHealable(t),
    })),
    held: heldTags.map((ct) => ({
      tagId: ct.tagId,
      name: ct.tag.name,
      quantity: ct.quantity,
      equipped: ct.equipped,
      expiresTurn: ct.expiresTurn,
      source: ct.source,
      // For the state strip's drawback point total — a negative pointCost is
      // what makes a tag a drawback (TAGS.md §4a).
      pointCost: ct.tag.pointCost,
    })),
    feed: { dropSlug: HUNGER_SLUG, grantSlug: ATE_MEAL_SLUG },
    // computeBudget subtracts CURSED_POINT_PENALTY, so the Refund-points
    // button needs to know — otherwise a re-rolled cursed character is
    // handed back 3 points creation never gave them.
    cursed: isCursed(member),
    equipSlots: config?.equipSlots ?? 6,
    maxDrawbackTags: config?.maxDrawbackTags ?? DEFAULT_MAX_DRAWBACK_TAGS,
    startingTagPoints: config?.startingTagPoints ?? 12,
    openTurn: openTurn ? { id: openTurn.id, number: openTurn.number, phase: openTurn.phase } : null,
    gambitModifier: gambitModifierTotal(heldTags, { hungerStreak: character.hungerStreak }),
    stagedForPush,
    openTurnAction: openTurnAction
      ? {
          id: openTurnAction.id,
          description: openTurnAction.description,
          moveKind: openTurnAction.moveKind,
          moveReviewStatus: openTurnAction.moveReviewStatus,
          resourceDelta: openTurnAction.resourceDelta,
          diceRoll: openTurnAction.diceRoll,
          diceModifier: openTurnAction.diceModifier,
          gmNotes: openTurnAction.gmNotes,
        }
      : null,
    desires: desires.map((d) => ({
      id: d.id,
      text: d.text,
      points: d.points,
      status: d.status,
      setTurnNumber: d.setTurnNumber,
      endedTurnNumber: d.endedTurnNumber,
      templateId: d.templateId,
      slotIndex: d.slotIndex,
      templateName: d.template?.name ?? null,
      templateTier: d.template?.tier ?? null,
    })),
    desireSlots: desireSlotsConfig,
    desireSlotStates,
    desireCatalog,
    desireFamilies: desireFamilies(),
    desireCooldowns,
  };
}

// The Record tab's four history lists, split out of loadDevPanelProps above.
// They are 350 rows nobody sees until a GM clicks the fifth tab — and most
// visits to the panel are "grant a tag, close it", so they were the biggest
// thing the panel paid for and the least likely thing it used. DevPanel fetches
// this on the first switch to Record and caches it for the life of the mount.
//
// `discordUserId` is passed in rather than derived here, so the DM list keys
// off a value the caller resolved from the character row server-side — never
// off anything the client sent alongside the id.
export async function loadDevPanelRecord(characterId, discordUserId) {
  const [moves, requests, auditLog, messages] = await Promise.all([
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
      where: { discordUserId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return {
    moves: moves.map((m) => ({
      id: m.id,
      turn: m.turn ? `${m.turn.number} ${m.turn.phase}` : "—",
      description: m.description,
      moveKind: m.moveKind,
      gmNotes: m.gmNotes,
      status: m.moveReviewStatus,
      resourceDelta: m.resourceDelta,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      turn: r.turn ? `${r.turn.number} ${r.turn.phase}` : "—",
      type: r.type,
      status: r.status,
      reason: r.reason,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    })),
    auditLog: auditLog.map((a) => ({
      id: a.id,
      actionType: a.actionType,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
