"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma, isDynastyHead, isDynastyMember } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";
import {
  AGE_MIN,
  AGE_MAX,
  NAME_LIMITS,
  formatCharacterName,
  formatBareName,
  normalizeHonorific,
} from "@/lib/characterName";
import { syncCharacterNickname, setTurnPingRole, setRomanceOptOutRole, ensureCharacterRole } from "@/lib/discordGuild";
import { propagateDynastyLastName } from "@/lib/dynasty";
import { normalizeSelection } from "@/lib/portrait/catalog";
import { renderPortrait } from "@/lib/portrait/render";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

export async function updateCharacterProfile(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    // The role slug decides whether this player owns their last name at all —
    // the Baron's family does not (see db/lib/dynasty.js).
    include: { role: { select: { slug: true } } },
  });
  if (!character) redirect("/character");

  const part = (key, limit) => formData.get(key)?.toString().trim().slice(0, limit) || null;
  // `title` is GM-granted and never read from this form — the input on the
  // character sheet is disabled and submits nothing. It still has to be fed
  // back into formatCharacterName below, or a player saving their bio would
  // silently strip a title a GM had granted them.
  const honorific = normalizeHonorific(formData.get("honorific"));
  const firstName = part("firstName", NAME_LIMITS.firstName);
  // A Baroness/Heir/Successor wears the Baron's last name, so their own form
  // is never read for it — their existing value is carried through untouched,
  // and only propagateDynastyLastName below ever changes it. The greyed input
  // on the sheet is the hint; this is the lock, same as `title` above.
  const dynastyMember = isDynastyMember(character.role?.slug);
  const lastName = dynastyMember
    ? character.lastName
    : part("lastName", NAME_LIMITS.lastName);
  const appearance =
    formData.get("appearance")?.toString().trim().slice(0, APPEARANCE_MAX_LENGTH) || null;
  const preferredNickname = formData.get("preferredNickname")?.toString().trim() || null;
  const turnPingOptIn = formData.get("turnPingOptIn") === "on";
  const romanceOptOut = formData.get("romanceOptOut") === "on";
  const avatar = formData.get("avatar");

  // Age is set once and then fixed. The input renders `disabled` after the
  // first save so it submits nothing, but that is only the UI half — this is
  // the lock: a non-null age is never overwritten, however the form is posted.
  // A GM can still change it from /gm/dev/characters/[characterId].
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;

  const data = { appearance, preferredNickname, turnPingOptIn, romanceOptOut };
  if (age !== null && character.age === null) data.age = age;
  if (firstName) {
    Object.assign(data, {
      honorific,
      firstName,
      lastName,
      name: formatCharacterName({ honorific, firstName, title: character.title, lastName }),
    });
  }

  // The UI hides the file input while GameConfig.avatarUploadsEnabled is off
  // (see AvatarField.js), but that's presentation only — a server action is
  // a public endpoint, so this is the actual gate. Off means everyone falls
  // through to their letter plaque (see "Character proxying" in CLAUDE.md).
  const gameConfig = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { avatarUploadsEnabled: true },
  });
  if (gameConfig?.avatarUploadsEnabled && avatar && avatar.size > 0) {
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
  await syncCharacterNickname(session.discordUserId, formatBareName(updated), updated.preferredNickname).catch(() => {});
  await setTurnPingRole(session.discordUserId, updated.turnPingOptIn).catch(() => {});
  await setRomanceOptOutRole(session.discordUserId, updated.romanceOptOut).catch(() => {});
  await ensureCharacterRole(updated).catch(() => {});
  // The Baron renaming himself renames his whole house.
  if (isDynastyHead(character.role?.slug)) {
    await propagateDynastyLastName(updated.lastName).catch((err) =>
      console.error("propagateDynastyLastName failed:", err),
    );
  }
  revalidatePath("/character");
}

// Builds and stores a portrait from a selection the modal posted. The
// selection is indices only — the picture is rendered here, from the committed
// sprite sheets, so nothing the client sends can become arbitrary avatar
// bytes. See docs/systemdocs/PORTRAITS.md.
export async function setPortraitAvatar(rawSelection) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) redirect("/character");

  // Both switches re-read here rather than trusted from the props the modal
  // rendered against: the button not existing is presentation, this is the
  // lock. Same posture as the avatarUploadsEnabled gate above.
  const gameConfig = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { portraitMakerEnabled: true, portraitFantasyPartsEnabled: true },
  });
  if (!gameConfig?.portraitMakerEnabled) {
    return { ok: false, error: "The portrait maker is closed right now." };
  }

  // Anything invalid, out of range, or fantasy-while-gated silently becomes
  // the default for that slot, so this cannot throw on a malformed post.
  const selection = normalizeSelection(rawSelection, {
    allowFantasy: gameConfig.portraitFantasyPartsEnabled,
  });

  const avatarData = await renderPortrait(selection);

  await prisma.character.update({
    where: { id: character.id },
    data: {
      avatarData,
      avatarMimeType: "image/webp",
      portrait: JSON.stringify(selection),
    },
  });

  revalidatePath("/character");
  return { ok: true };
}

// Drops whatever picture is set — a built portrait or an uploaded one — and
// falls back to the letter plaque. Nothing is stored for the default: the
// avatar route derives it from firstName at read time, so clearing these three
// columns IS the reset.
export async function resetAvatarToDefault() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true },
  });
  if (!character) redirect("/character");

  await prisma.character.update({
    where: { id: character.id },
    data: { avatarData: null, avatarMimeType: null, portrait: null },
  });

  revalidatePath("/character");
  return { ok: true };
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
