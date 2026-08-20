"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";
import { syncCharacterNickname, setTurnPingRole, setRomanceOptOutRole, ensureCharacterRole } from "@/lib/discordGuild";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

export async function updateCharacterProfile(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character");

  const name = formData.get("name")?.toString().trim();
  const appearance =
    formData.get("appearance")?.toString().trim().slice(0, APPEARANCE_MAX_LENGTH) || null;
  const preferredNickname = formData.get("preferredNickname")?.toString().trim() || null;
  const turnPingOptIn = formData.get("turnPingOptIn") === "on";
  const romanceOptOut = formData.get("romanceOptOut") === "on";
  const avatar = formData.get("avatar");

  const data = { appearance, preferredNickname, turnPingOptIn, romanceOptOut };
  if (name) data.name = name;

  if (avatar && avatar.size > 0) {
    if (avatar.size > MAX_UPLOAD_BYTES) {
      throw new Error("Avatar image must be under 5MB.");
    }
    const buffer = Buffer.from(await avatar.arrayBuffer());
    data.avatarData = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 85 })
      .toBuffer();
    data.avatarMimeType = "image/webp";
  }

  const updated = await prisma.character.update({ where: { id: character.id }, data });
  await syncCharacterNickname(session.discordUserId, updated.name, updated.preferredNickname).catch(() => {});
  await setTurnPingRole(session.discordUserId, updated.turnPingOptIn).catch(() => {});
  await setRomanceOptOutRole(session.discordUserId, updated.romanceOptOut).catch(() => {});
  await ensureCharacterRole(updated).catch(() => {});
  revalidatePath("/character");
}

export async function setDefaultEffort(characterId, formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character");

  const description = formData.get("description")?.toString().trim();
  if (!description) return;

  const shareInSummary = formData.get("shareInSummary") === "on";
  const summaryMessage = formData.get("summaryMessage")?.toString().trim() || null;

  // A Location's plain channel IS its summary channel (see
  // bot/src/lib/channels.js#isSummaryChannel), so it's derived from where the
  // character stands rather than picked — the panel has no channel field.
  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { discordChannelId: true },
      })
    : null;
  const summaryChannelId = location?.discordChannelId ?? null;

  await prisma.defaultEffort.upsert({
    where: { characterId: character.id },
    create: {
      characterId: character.id,
      description,
      zoneId: character.zoneId,
      shareInSummary: shareInSummary && !!summaryChannelId,
      summaryChannelId: shareInSummary ? summaryChannelId : null,
      summaryMessage,
      setByCharacterId: character.id,
    },
    update: {
      description,
      zoneId: character.zoneId,
      shareInSummary: shareInSummary && !!summaryChannelId,
      summaryChannelId: shareInSummary ? summaryChannelId : null,
      summaryMessage,
      setByCharacterId: character.id,
    },
  });

  revalidatePath("/character");
}

export async function deleteDefaultEffort(characterId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { id: characterId, discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character");

  await prisma.defaultEffort.deleteMany({ where: { characterId: character.id } });

  revalidatePath("/character");
}
