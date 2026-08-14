"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

export async function updateCharacterProfile(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const name = formData.get("name")?.toString().trim();
  const appearance = formData.get("appearance")?.toString().trim() || null;
  const avatar = formData.get("avatar");

  const data = { appearance };
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

  await prisma.character.update({ where: { id: character.id }, data });
  revalidatePath("/character");
}

export async function submitAction(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character/new");

  const type = formData.get("type")?.toString();
  const description = formData.get("description")?.toString().trim();
  if (type !== "EFFORT" && type !== "MOVE") return;
  if (!description) return;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!openTurn) return;

  const existing = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
  });
  if (existing) return;

  const action = await prisma.action.create({
    data: {
      characterId: character.id,
      turnId: openTurn.id,
      type,
      description,
      zoneId: character.zoneId,
      status: "PENDING",
    },
  });

  const kind = type === "MOVE" ? "Move" : "Effort";
  const dm = await sendDm(
    character.discordUserId,
    `**${kind} submitted:** ${description}\n\nReact with ✅ on this message to confirm and lock it in.`,
  ).catch(() => null);

  if (dm) {
    await prisma.action.update({
      where: { id: action.id },
      data: { confirmDmMessageId: dm.id },
    });
  }

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "action_submitted",
      targetCharacterId: character.id,
      details: { actionId: action.id, type, dmSent: !!dm },
    },
  });

  revalidatePath("/character");
}
