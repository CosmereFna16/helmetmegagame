"use server";

import { revalidatePath } from "next/cache";
import { prisma, advanceTurn as advanceTurnInDb, buildTurnAnnouncement, HUNGERLESS_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import {
  postMessage,
  deleteMessage,
  listGuildChannels,
  isTurnsChannel,
  ensureCharacterRole,
  createGuildChannel,
  CHANNEL_TYPE_CATEGORY,
  syncCharacterLocationAccess,
  sortLocationCategories,
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

export async function updateGameConfig(formData) {
  await requireSuperadmin();

  await prisma.gameConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {
      startingTagPoints: intOrZero(formData, "startingTagPoints"),
      resourceConsumptionPerTurn: intOrZero(formData, "resourceConsumptionPerTurn"),
      moodDurationTurns: intOrZero(formData, "moodDurationTurns"),
      hungerMovePenalty: intOrZero(formData, "hungerMovePenalty"),
      moodMovePenalty: intOrZero(formData, "moodMovePenalty"),
      moodMoveBonus: intOrZero(formData, "moodMoveBonus"),
      alcoholCost: intOrZero(formData, "alcoholCost"),
      alcoholShieldDurationTurns: intOrZero(formData, "alcoholShieldDurationTurns"),
      lifewebBlood: Math.max(0, Math.min(100, intOrZero(formData, "lifewebBlood"))),
      lifewebDecayPerTurn: intOrZero(formData, "lifewebDecayPerTurn"),
      lifewebDrainedDurationTurns: intOrZero(formData, "lifewebDrainedDurationTurns"),
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

export async function forceAdvanceTurn() {
  const session = await requireSuperadmin();

  const { previousTurn, newTurn, note } = await advanceTurnInDb();

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "superadmin_turn_forced",
      details: { previousTurnId: previousTurn?.id ?? null, newTurnId: newTurn.id, number: newTurn.number, phase: newTurn.phase, weather: newTurn.weather },
    },
  });

  const text = buildTurnAnnouncement(newTurn, note);
  const channels = await listGuildChannels();
  const turnsChannel = channels.find(isTurnsChannel);

  if (turnsChannel) {
    const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
    if (config?.turnsAnnouncementChannelId === turnsChannel.id && config.turnsAnnouncementMessageId) {
      await deleteMessage(turnsChannel.id, config.turnsAnnouncementMessageId).catch(() => {});
    }
    const sent = await postMessage(turnsChannel.id, text).catch(() => null);
    if (sent) {
      await prisma.gameConfig.update({
        where: { id: 1 },
        data: { turnsAnnouncementChannelId: turnsChannel.id, turnsAnnouncementMessageId: sent.id },
      });
    }
  }

  revalidatePath("/gm/dev");
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
      tagPoints: intOrZero(formData, "tagPoints"),
      moodState: str(formData, "moodState"),
      moodExpiresTurn: intOrNull(formData, "moodExpiresTurn"),
      moodNote,
      isHungry: formData.get("isHungry") === "on",
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

  await prisma.$transaction([
    prisma.characterTag.create({ data: { characterId, tagId, source: "GM_GRANT" } }),
    ...(tag.slug === HUNGERLESS_SLUG
      ? [prisma.character.update({ where: { id: characterId }, data: { isHungry: false } })]
      : []),
  ]);

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
      discordRoleId: str(formData, "discordRoleId").trim(),
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
// removeCharacterFromFaction in faction/actions.js) before deleting the row
// — for stray factions auto-synced from a Discord role that was never meant
// to be a game faction (e.g. an opt-in notification role), not for factions
// with real in-game meaning.
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
// is named "{Zone} » {Location}" (e.g. "Town » Church"); the three channels
// underneath stay named after the Location alone.
export async function provisionLocationChannels(locationId) {
  await requireSuperadmin();

  const location = await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } });
  if (!location) throw new Error("Location not found.");
  if (location.discordCategoryId) return;

  const everyoneId = process.env.DISCORD_GUILD_ID;
  const gmRoleId = process.env.DISCORD_GM_ROLE_ID;

  const category = await createGuildChannel({
    name: `${location.zone.name} » ${location.name}`,
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
