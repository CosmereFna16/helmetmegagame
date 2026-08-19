"use server";

import { revalidatePath } from "next/cache";
import { prisma, advanceTurn as advanceTurnInDb, runFullChannelWipe } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import {
  ensureCharacterRole,
  createGuildChannel,
  CHANNEL_TYPE_CATEGORY,
  syncCharacterLocationAccess,
  sortLocationCategories,
  deleteCharacterRole,
  updateGuildNickname,
} from "@/lib/discordGuild";
import { getFactionAncestorIds } from "@/lib/factionPermissions";

async function requireSuperadmin() {
  const session = await auth();
  if (!session?.discordUserId || !isSuperadmin(session.discordUserId)) {
    throw new Error("Not authorized.");
  }
  return session;
}

function str(formData, key) {
  const v = formData.get(key);
  return v == null ? "" : v.toString();
}

function intOrNull(formData, key) {
  const v = str(formData, key).trim();
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function intOrZero(formData, key) {
  return intOrNull(formData, key) ?? 0;
}

function floatOrDefault(formData, key, fallback) {
  const v = str(formData, key).trim();
  if (v === "") return fallback;
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? fallback : n;
}

export async function updateGameConfig(formData) {
  await requireSuperadmin();

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      moodDurationTurns: intOrZero(formData, "moodDurationTurns"),
      moodMovePenalty: intOrZero(formData, "moodMovePenalty"),
      moodMoveBonus: intOrZero(formData, "moodMoveBonus"),
      lifewebBlood: Math.max(0, Math.min(100, intOrZero(formData, "lifewebBlood"))),
      lifewebDecayPerTurn: intOrZero(formData, "lifewebDecayPerTurn"),
      lifewebDrainedDurationTurns: intOrZero(formData, "lifewebDrainedDurationTurns"),
      messageWipeEnabled: formData.get("messageWipeEnabled") === "on",
      productionCoefficient: floatOrDefault(formData, "productionCoefficient", 1),
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/lifeweb");
}

// Directly overrides the current turn's day/phase (creating one if none is
// open) rather than routing through Needs resolution — a raw superadmin
// correction, not a normal turn advance.
export async function updateCurrentTurn(formData) {
  await requireSuperadmin();

  const day = intOrNull(formData, "day");
  const phase = str(formData, "phase") || "DAWN";
  const weather = str(formData, "weather") || "CLEAR";
  if (day == null || day < 1) return;

  const number = (day - 1) * 2 + (phase === "DAWN" ? 1 : 2);

  const openTurnRecord = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (openTurnRecord) {
    await prisma.turn.update({ where: { id: openTurnRecord.id }, data: { number, phase, weather } });
  } else {
    await prisma.turn.create({ data: { number, phase, weather, status: "OPEN", gameDate: new Date() } });
  }

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

// Sets the pending weather/note for the *next* turn, consumed by
// advanceTurn() in @lifeweb/db when the turn actually advances. Leaving
// weather unset (empty string -> null) means "roll randomly" there.
export async function updateNextTurn(formData) {
  await requireSuperadmin();

  const weather = str(formData, "weather").trim() || null;
  const note = str(formData, "note").trim() || null;

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1, nextWeather: weather, nextTurnNote: note },
    update: { nextWeather: weather, nextTurnNote: note },
  });

  revalidatePath("/gm/dev");
}

// advanceTurnInDb() now owns every Discord side effect itself (turn
// announcement, and the Dawn message wipe if GameConfig.messageWipeEnabled
// is on) — REST-based, so this needs nothing gateway-specific. With the
// wipe enabled this can take a while to resolve (fetching/archiving/
// deleting across every Location's channels), so it may take a few minutes
// on a Dawn turn.
export async function forceAdvanceTurn() {
  const session = await requireSuperadmin();

  const { previousTurn, newTurn } = await advanceTurnInDb();

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_turn_forced",
      details: { previousTurnId: previousTurn?.id ?? null, newTurnId: newTurn.id, number: newTurn.number, phase: newTurn.phase, weather: newTurn.weather },
    },
  });

  revalidatePath("/gm/dev");
  revalidatePath("/", "layout");
}

// Matches GameConfig's schema @default values for the balance-knob fields
// surfaced on the "Game Config" form above — deliberately excludes
// nextWeather/nextTurnNote (handled separately, "Next Turn" section) and the
// Discord provisioning pointers (turnsAnnouncementChannelId/MessageId,
// locationPromptChannelId/MessageId): those self-heal on their own.
const DEFAULT_GAME_CONFIG = {
  moodDurationTurns: 2,
  moodMovePenalty: -1,
  moodMoveBonus: 1,
  lifewebBlood: 100,
  lifewebDecayPerTurn: 10,
  lifewebDrainedDurationTurns: 4,
  messageWipeEnabled: false,
  productionCoefficient: 1,
};

// Full game restart for dev/testing: wipes every player- and turn-scoped
// row (characters, tags-on-characters, Moves, default efforts, notes, DM
// log, audit log, silo history), resets GameConfig's balance knobs to their
// schema defaults, clears every Discord channel this game has actually
// written to (#archive, #turns, and every Location's plain/public/private
// channel — messages, forum posts, and threads, public or private), and
// opens a fresh Turn 1/DAWN. Leaves untouched: Faction/Zone/Location rows
// and their Discord provisioning (channels/categories themselves are never
// deleted, only emptied), and the Tag catalog. Faction silos reset to 0,
// same "back to day one" treatment as the Turn counter, rather than
// carrying over stale economy numbers.
//
// Requires typing the literal string "WIPE" in the confirm field — this is
// the most destructive action in the Dev Panel and has no undo.
export async function wipeGameData(formData) {
  const session = await requireSuperadmin();

  if (str(formData, "confirm").trim() !== "WIPE") {
    throw new Error('Type "WIPE" (all caps) to confirm.');
  }

  const characters = await prisma.character.findMany({
    select: { discordUserId: true, discordRoleId: true },
  });

  // Best-effort Discord cleanup first, while the Character rows (and their
  // discordRoleId/discordUserId) still exist to look up. Channel wiping is
  // its own slow, sequential pass (see fullWipe.js) so it runs alongside
  // the per-character role/nickname cleanup rather than blocking it.
  await Promise.all([
    ...characters.flatMap((c) => [
      c.discordRoleId ? deleteCharacterRole(c.discordRoleId).catch(() => {}) : null,
      updateGuildNickname(c.discordUserId, null).catch(() => {}),
    ]).filter(Boolean),
    runFullChannelWipe(prisma).catch((err) => console.error("Full channel wipe failed:", err)),
  ]);

  // Deletes ordered so dependents go before the Character/Turn rows they
  // reference (Prisma doesn't cascade by default here).
  await prisma.$transaction([
    prisma.note.deleteMany({}),
    prisma.defaultEffort.deleteMany({}),
    prisma.action.deleteMany({}),
    prisma.characterTag.deleteMany({}),
    prisma.auditLog.deleteMany({}),
    prisma.character.deleteMany({}),
    prisma.turn.deleteMany({}),
    prisma.siloTransaction.deleteMany({}),
    prisma.directMessage.deleteMany({}),
    prisma.faction.updateMany({ data: { silo: 0 } }),
    prisma.gameConfig.update({
      where: { id: 1 },
      data: { ...DEFAULT_GAME_CONFIG, nextWeather: null, nextTurnNote: null },
    }),
  ]);

  await prisma.turn.create({
    data: { number: 1, phase: "DAWN", weather: "CLEAR", status: "OPEN", gameDate: new Date() },
  });

  await prisma.auditLog.create({
    data: { actorDiscordUserId: session.discordUserId, actionType: "superadmin_game_wipe" },
  });

  revalidatePath("/", "layout");
}

export async function updateCharacterRaw(formData) {
  await requireSuperadmin();

  const characterId = str(formData, "characterId");
  if (!characterId) return;

  const existing = await prisma.character.findUnique({ where: { id: characterId } });

  const factionId = str(formData, "factionId").trim() || null;
  const locationId = str(formData, "locationId").trim() || null;
  const moodNote = str(formData, "moodNote").trim() || null;
  const appearance = str(formData, "appearance").trim() || null;
  const roleTitle = str(formData, "roleTitle").trim() || null;

  // zoneId mirrors location.zoneId whenever a Location is set (see the
  // Location model comment in schema.prisma) — a raw zoneId field is only
  // meaningful for a character with no specific Location yet.
  let zoneId = str(formData, "zoneId").trim() || null;
  if (locationId) {
    const location = await prisma.location.findUnique({ where: { id: locationId } });
    zoneId = location?.zoneId ?? zoneId;
  }

  const updated = await prisma.character.update({
    where: { id: characterId },
    data: {
      name: str(formData, "name").trim(),
      roleTitle,
      factionId,
      zoneId,
      locationId,
      isLeader: formData.get("isLeader") === "on",
      status: str(formData, "status"),
      resources: intOrZero(formData, "resources"),
      moodState: str(formData, "moodState"),
      moodExpiresTurn: intOrNull(formData, "moodExpiresTurn"),
      moodNote,
      appearance,
    },
  });
  await ensureCharacterRole(updated).catch(() => {});
  if (existing?.locationId !== locationId) {
    await syncCharacterLocationAccess(updated.discordRoleId, existing?.locationId ?? null, locationId).catch(() => {});
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: (await auth()).discordUserId,
      actionType: "superadmin_character_edit",
      targetCharacterId: characterId,
    },
  });

  revalidatePath("/gm/dev/characters");
  revalidatePath(`/gm/dev/characters/${characterId}`);
  revalidatePath("/gm/players");
  revalidatePath("/character");
}

export async function grantTag(formData) {
  const session = await requireSuperadmin();

  const characterId = str(formData, "characterId");
  const tagId = str(formData, "tagId");
  if (!characterId || !tagId) return;

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  if (!tag) return;

  await prisma.characterTag.create({ data: { characterId, tagId, source: "GM_GRANT" } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_tag_grant",
      targetCharacterId: characterId,
      details: { tagId, tagName: tag.name },
    },
  });

  revalidatePath(`/gm/dev/characters/${characterId}`);
  revalidatePath("/character");
}

export async function revokeTag(formData) {
  const session = await requireSuperadmin();

  const characterTagId = str(formData, "characterTagId");
  const characterId = str(formData, "characterId");
  if (!characterTagId) return;

  const ct = await prisma.characterTag.delete({ where: { id: characterTagId } }).catch(() => null);
  if (!ct) return;

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_tag_revoke",
      targetCharacterId: characterId || ct.characterId,
      details: { tagId: ct.tagId },
    },
  });

  revalidatePath(`/gm/dev/characters/${characterId || ct.characterId}`);
  revalidatePath("/character");
}

export async function updateFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const before = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!before) return;

  const newSilo = intOrZero(formData, "silo");
  const siloDelta = newSilo - before.silo;

  const parentFactionId = str(formData, "parentFactionId").trim() || null;
  if (parentFactionId) {
    if (parentFactionId === factionId) return;
    // Reject a cycle: the faction being edited can't already be an ancestor
    // of the faction it's about to be parented under.
    const ancestorIds = await getFactionAncestorIds(parentFactionId);
    if (ancestorIds.includes(factionId)) return;
  }

  await prisma.faction.update({
    where: { id: factionId },
    data: {
      name: str(formData, "name").trim(),
      silo: newSilo,
      parentFactionId,
    },
  });

  if (siloDelta !== 0) {
    const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    await prisma.siloTransaction.create({
      data: {
        factionId,
        amount: siloDelta,
        actorDiscordUserId: session.discordUserId,
        actorName: "GM (Dev Panel)",
        note: "Manual Dev Panel adjustment",
        turnNumber: openTurn?.number ?? null,
        turnPhase: openTurn?.phase ?? null,
      },
    });
  }

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
}

// Reassigns the faction's members to "Unaffiliated" (same pattern as
// removeCharacterFromFaction in faction/actions.js) before deleting the row.
export async function deleteFaction(formData) {
  const session = await requireSuperadmin();

  const factionId = str(formData, "factionId");
  if (!factionId) return;

  const faction = await prisma.faction.findUnique({ where: { id: factionId } });
  if (!faction || faction.name === "Unaffiliated") return;

  const unaffiliated = await prisma.faction.findFirst({ where: { name: "Unaffiliated" } });
  if (unaffiliated) {
    await prisma.character.updateMany({
      where: { factionId },
      data: { factionId: unaffiliated.id, isLeader: false },
    });
  }

  await prisma.faction.delete({ where: { id: factionId } });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "faction_deleted",
      details: { factionId, name: faction.name },
    },
  });

  revalidatePath("/gm/dev/factions");
  revalidatePath("/faction");
}

// Discord permission bit flags used below. Combined via addition (not `|`,
// which truncates to 32 bits in JS) since none of these overlap; sent to the
// API as decimal strings per Discord's permission-bitfield contract.
const PERM_VIEW_CHANNEL = 1024;
const PERM_SEND_MESSAGES = 2048;
const PERM_CREATE_PUBLIC_THREADS = 34359738368;
const PERM_CREATE_PRIVATE_THREADS = 68719476736;

// One-time, explicitly GM-triggered creation of a Location's Discord layout
// (1 category + plain/public/private channels) — see the Location model
// comment in schema.prisma. Deliberately not auto-synced: re-running this
// for an already-provisioned Location is a no-op so edits here never risk
// deleting/recreating live channels or their message history. The category
// is named "{Zone} / {Location}" (e.g. "Town / Church"); the three channels
// underneath stay named after the Location alone.
export async function provisionLocationChannels(locationId) {
  await requireSuperadmin();

  const location = await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } });
  if (!location) throw new Error("Location not found.");
  if (location.discordCategoryId) return;

  const everyoneId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;

  const category = await createGuildChannel({
    name: `${location.zone.name} / ${location.name}`,
    type: CHANNEL_TYPE_CATEGORY,
    permission_overwrites: [
      { id: everyoneId, type: 0, deny: String(PERM_VIEW_CHANNEL) },
      ...(gmRoleId ? [{ id: gmRoleId, type: 0, allow: String(PERM_VIEW_CHANNEL) }] : []),
    ],
  });

  const plainChannel = await createGuildChannel({
    name: location.name,
    type: 0,
    parent_id: category.id,
    rate_limit_per_user: 60,
  });

  const publicChannel = await createGuildChannel({
    name: `${location.name}-public`,
    type: 15,
    parent_id: category.id,
    // Posts (threads) auto-archive — hidden from the active list, not
    // deleted — after 24h of inactivity. 1440 is minutes; Discord only
    // accepts 60/1440/4320/10080 here.
    default_auto_archive_duration: 1440,
    // Players tag a post "Persistent" to exempt it from the Dawn message
    // wipe (db/lib/dawnWipe.js) — the post survives, only its messages get
    // cleared. Looked up by name at wipe-time, not stored anywhere.
    available_tags: [{ name: "Persistent", emoji_name: "⏰" }],
  });

  const privateChannel = await createGuildChannel({
    name: `${location.name}-private`,
    type: 0,
    parent_id: category.id,
    permission_overwrites: [
      {
        id: everyoneId,
        type: 0,
        // ViewChannel is already denied by the category overwrite above, so
        // this bit is redundant in principle — set explicitly anyway so the
        // Discord permissions UI shows it as an explicit deny on this
        // channel rather than "inherited/neutral", which reads as
        // unrestricted at a glance.
        deny: String(PERM_VIEW_CHANNEL + PERM_SEND_MESSAGES + PERM_CREATE_PUBLIC_THREADS),
        allow: String(PERM_CREATE_PRIVATE_THREADS),
      },
    ],
  });

  await prisma.location.update({
    where: { id: locationId },
    data: {
      discordCategoryId: category.id,
      discordChannelId: plainChannel.id,
      discordPublicChannelId: publicChannel.id,
      discordPrivateChannelId: privateChannel.id,
    },
  });

  await sortLocationCategories().catch(() => {});

  revalidatePath("/gm/dev/zones");
}

export async function updateLocation(formData) {
  await requireSuperadmin();

  const locationId = str(formData, "locationId").trim();
  const name = str(formData, "name").trim();
  if (!locationId || !name) return;

  // DB-only rename — deliberately does not touch already-provisioned Discord
  // channel/category names, so editing this after provisioning can't
  // accidentally disrupt live channels or message history.
  await prisma.location.update({ where: { id: locationId }, data: { name } });
  revalidatePath("/gm/dev/zones");
}

export async function createLocation(formData) {
  await requireSuperadmin();

  const zoneId = str(formData, "zoneId").trim();
  const name = str(formData, "name").trim();
  if (!zoneId || !name) return;

  await prisma.location.create({ data: { zoneId, name } });
  revalidatePath("/gm/dev/zones");
}

export async function updateZone(formData) {
  await requireSuperadmin();

  const zoneId = str(formData, "zoneId");
  if (!zoneId) return;

  const discordChannelIds = str(formData, "discordChannelIds")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await prisma.zone.update({
    where: { id: zoneId },
    data: {
      name: str(formData, "name").trim(),
      discordChannelIds,
    },
  });

  revalidatePath("/gm/dev/zones");
}
