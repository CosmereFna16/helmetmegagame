// Spawning a threat: turning an offer into a character.
//
// The GM presses SPAWN on /gm/dev?s=assignments, which writes a ThreatSpawn
// row and DMs the target a blurb with Accept / Decline buttons. The click
// lands in the BOT (a DM has no guild), so the work that both faces need
// lives here and the bot handler stays thin — bot/src/lib/threatSpawn.js.
//
// This module does the DATABASE half only and RETURNS what the caller must
// then do to Discord (ARCHITECTURE.md's returned-side-effects pattern). It
// cannot do that half itself: creating the personal role and placing the
// character are REST calls the two faces already own differently.
//
// The transaction deliberately mirrors createCharacter's
// (web/app/(app)/character/createActions.js), which until now was the only
// code that had ever written a Character row. Where it differs, it is because
// nobody is picking: the name is rolled, the gender comes from the seat, and
// there is no point-buy cart to validate.
const { parseStartingTag } = require("./startingTags");
const { roleCapacity, seatHolderStatuses } = require("./roleCapacity");
const { formatCharacterName, formatBareName } = require("./characterName");
const { expiryForGrant } = require("./grantExpiry");
const { createGuildRole, removeMemberRole } = require("./discordRest");
const { characterRoleAppearance } = require("./characterRoleAppearance");
const { applyLocationMoveSideEffects } = require("./locationMove");
const {
  threatBySlug,
  randomSpawnName,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
} = require("./threats");

// The two buttons on an offer DM. Raw component JSON rather than discord.js
// builders, because the web sends this one and only the bot has the library —
// same shape as the Bird's Reply button (db/lib/bird.js).
function spawnOfferComponents(spawnId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: `${THREAT_SPAWN_ACCEPT_PREFIX}${spawnId}`, label: "Accept" },
        { type: 2, style: 2, custom_id: `${THREAT_SPAWN_DECLINE_PREFIX}${spawnId}`, label: "Decline" },
      ],
    },
  ];
}

// A seat's tag list is written as SLUGS with an optional count — "obol x4".
// parseStartingTag splits the count off; a role's own startingTagSlugs are
// display NAMES despite the column's name, so the two are looked up
// differently and merged after.
function parseSlugEntries(entries = []) {
  const wanted = new Map();
  for (const entry of entries) {
    const { name: slug, quantity } = parseStartingTag(entry);
    wanted.set(slug, (wanted.get(slug) ?? 0) + quantity);
  }
  return wanted;
}

// Every tag a spawn hands over: the seat's own grant (the Demoness tag and
// Hungerless), its starting kit (a dagger, four obols), and whatever the role
// it lands in grants anyone. Resolved in one pass so a missing slug is a clean
// refusal rather than a half-granted character.
async function resolveSpawnTags(db, threat, role) {
  const bySlug = parseSlugEntries([
    ...(threat.assign?.tagSlugs ?? []),
    ...(threat.spawn?.tagSlugs ?? []),
  ]);
  const byName = new Map();
  for (const entry of role?.startingTagSlugs ?? []) {
    const { name, quantity } = parseStartingTag(entry);
    byName.set(name, (byName.get(name) ?? 0) + quantity);
  }

  const [slugTags, nameTags] = await Promise.all([
    bySlug.size ? db.tag.findMany({ where: { slug: { in: [...bySlug.keys()] } } }) : [],
    byName.size ? db.tag.findMany({ where: { name: { in: [...byName.keys()] } } }) : [],
  ]);

  const missing = [...bySlug.keys()].filter((s) => !slugTags.some((t) => t.slug === s));
  if (missing.length) {
    return { error: `The ${threat.name} seat names tags that aren't in the catalog: ${missing.join(", ")}.` };
  }

  // Union, largest count wins where a tag arrives from two directions at once.
  const merged = new Map();
  for (const tag of slugTags) merged.set(tag.id, { tag, quantity: bySlug.get(tag.slug) ?? 1 });
  for (const tag of nameTags) {
    const want = byName.get(tag.name) ?? 1;
    const held = merged.get(tag.id);
    merged.set(tag.id, { tag, quantity: Math.max(want, held?.quantity ?? 0) });
  }
  return { tags: [...merged.values()] };
}

// The tags an ASSIGN hands to an existing character — the seat's grant only,
// never the spawn kit. Returns [{ tag, quantity }].
async function resolveAssignTags(db, threat) {
  const bySlug = parseSlugEntries(threat.assign?.tagSlugs ?? []);
  if (!bySlug.size) return { tags: [] };
  const tags = await db.tag.findMany({ where: { slug: { in: [...bySlug.keys()] } } });
  const missing = [...bySlug.keys()].filter((s) => !tags.some((t) => t.slug === s));
  if (missing.length) {
    return { error: `The ${threat.name} seat names tags that aren't in the catalog: ${missing.join(", ")}.` };
  }
  return { tags: tags.map((tag) => ({ tag, quantity: bySlug.get(tag.slug) ?? 1 })) };
}

// Accepts an offer. Returns { ok, line, character, sideEffects } or
// { ok: false, reason } — never throws for a refusal a player caused, because
// the caller writes the reason under their own DM.
async function acceptThreatSpawn(prisma, spawnId, discordUserId) {
  const spawn = await prisma.threatSpawn.findUnique({
    where: { id: spawnId },
    include: {
      role: { include: { faction: { include: { zone: true } } } },
      location: { include: { zone: true } },
    },
  });
  if (!spawn) return { ok: false, reason: "That offer's gone. ‡" };
  if (spawn.discordUserId !== discordUserId) return { ok: false, reason: "That's not yours to answer. ‡" };
  if (spawn.status !== "PENDING") return { ok: false, reason: "That offer has already been answered. ‡" };

  const threat = threatBySlug(spawn.threatSlug);
  if (!threat?.spawn) return { ok: false, reason: "That seat can no longer be spawned into. ‡" };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    return { ok: false, reason: "You already have a character. ‡" };
  }

  const [config, openTurn, resolved] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }),
    resolveSpawnTags(prisma, threat, spawn.role),
  ]);
  if (resolved.error) return { ok: false, reason: `${resolved.error} ‡` };

  // A spawned character's location may be overridden by the GM; the role's
  // own start is the fallback. The denormalization contract says zoneId is
  // written from the SAME location in the same statement.
  const locationId = spawn.locationId ?? spawn.role.startingLocationId ?? null;
  const location =
    spawn.locationId && spawn.location
      ? spawn.location
      : locationId
        ? await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } })
        : null;

  const firstName = randomSpawnName(threat.spawn.gender);
  const name = formatCharacterName({ honorific: null, firstName, title: null, lastName: null });

  // Stamped before the transaction: a tag with a catalog duration must arrive
  // already carrying expiresTurn, since nothing backfills it later.
  const tagRows = [];
  for (const { tag, quantity } of resolved.tags) {
    tagRows.push({
      tagId: tag.id,
      source: "GM_GRANT",
      expiresTurn: await expiryForGrant(prisma, tag, openTurn, { where: "acceptThreatSpawn" }),
      quantity: tag.stackable ? quantity : 1,
    });
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // The lock that actually closes the seat race — Prisma runs READ
      // COMMITTED, so counting without it can seat two people at once.
      await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${spawn.roleId} FOR UPDATE`;
      const taken = await tx.character.count({
        where: { roleId: spawn.roleId, status: { in: seatHolderStatuses(spawn.role) } },
      });
      if (taken >= roleCapacity(spawn.role, config?.playerCount ?? 100)) throw new Error("ROLE_FULL");

      // Re-read under the lock: two clicks on the same button race here, and
      // the status check above is only an early out.
      const fresh = await tx.threatSpawn.findUnique({ where: { id: spawn.id }, select: { status: true } });
      if (fresh?.status !== "PENDING") throw new Error("ALREADY_ANSWERED");

      const character = await tx.character.create({
        data: {
          discordUserId,
          honorific: null,
          firstName,
          title: null,
          lastName: null,
          name,
          gender: threat.spawn.gender,
          age: null,
          roleId: spawn.role.id,
          roleTitle: spawn.role.name,
          factionId: spawn.role.factionId,
          locationId: location?.id ?? null,
          zoneId: location?.zoneId ?? null,
          resources: threat.spawn.resources ?? spawn.role.startingResources,
          tagPoints: threat.spawn.tagPoints ?? 0,
          isLeader: spawn.role.grantsLeader,
          isTreasurer: spawn.role.grantsTreasurer,
        },
      });

      if (tagRows.length) {
        await tx.characterTag.createMany({
          data: tagRows.map((row) => ({ characterId: character.id, ...row })),
        });
      }

      await tx.threatSpawn.update({
        where: { id: spawn.id },
        data: { status: "ACCEPTED", characterId: character.id, resolvedAt: new Date() },
      });

      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") {
      return { ok: false, reason: `There's no ${spawn.role.name} seat left. Tell a GM. ‡` };
    }
    if (err.message === "ALREADY_ANSWERED") {
      return { ok: false, reason: "That offer has already been answered. ‡" };
    }
    throw err;
  }

  return {
    ok: true,
    character: created,
    threat,
    // What the caller must do to Discord, in order. Each is best-effort and
    // none of them may cost the create — same posture as createCharacter's
    // tail.
    sideEffects: {
      characterId: created.id,
      discordUserId,
      bareName: formatBareName({ firstName, lastName: null }),
      toLocationId: created.locationId,
    },
    turn: openTurn,
    line: created.locationId
      ? `You are now the ${threat.name}. You wake as ${name}, in ${location?.name ?? "the dark"}. ‡`
      : `You are now the ${threat.name}. You wake as ${name}. ‡`,
  };
}

async function declineThreatSpawn(prisma, spawnId, discordUserId) {
  const spawn = await prisma.threatSpawn.findUnique({ where: { id: spawnId } });
  if (!spawn) return { ok: false, reason: "That offer's gone. ‡" };
  if (spawn.discordUserId !== discordUserId) return { ok: false, reason: "That's not yours to answer. ‡" };
  if (spawn.status !== "PENDING") return { ok: false, reason: "That offer has already been answered. ‡" };

  await prisma.threatSpawn.update({
    where: { id: spawn.id },
    data: { status: "DECLINED", resolvedAt: new Date() },
  });
  return { ok: true, line: "You turned the seat down. ‡" };
}


// The Discord half of an accept, run post-commit and entirely best-effort:
// none of it may cost a character that already exists. Lives here rather than
// on either face because the accept happens in the BOT (a DM has no guild)
// while everything it needs is REST, which db/lib/discordRest.js already owns.
//
// The personal role is a MENTIONABLE NAME TOKEN held by nobody — channel
// access rides the zone role and the Location overwrite instead
// (CHANNELS.md §3), which is what applyLocationMoveSideEffects hands out.
async function applySpawnSideEffects(prisma, sideEffects) {
  const { characterId, discordUserId, bareName, toLocationId } = sideEffects;

  try {
    const { name, color } = characterRoleAppearance(bareName);
    // permissions: "0" is NOT the API default — the create-role endpoint
    // copies @everyone's bits when the field is omitted, which makes the role
    // look like a real access role to db:prune-orphan-roles.
    const role = await createGuildRole({ name, color, hoist: false, mentionable: true, permissions: "0" });
    await prisma.character.update({ where: { id: characterId }, data: { discordRoleId: role.id } });
  } catch (err) {
    console.error("Spawn role creation failed:", err);
  }

  if (toLocationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId,
      fromLocationId: null,
      toLocationId,
    }).catch((err) => console.error("Spawn placement failed:", err));
  }

  // A spawned threat is alive again, so the ghost seat comes off.
  const cursedRoleId = process.env.DISCORD_CURSED_ROLE_ID;
  if (cursedRoleId) {
    await removeMemberRole(discordUserId, cursedRoleId).catch(() => {});
  }
}

module.exports = {
  applySpawnSideEffects,
  spawnOfferComponents,
  acceptThreatSpawn,
  declineThreatSpawn,
  resolveSpawnTags,
  resolveAssignTags,
};
