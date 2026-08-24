"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";
import { AGE_MIN, AGE_MAX, formatBareName } from "@/lib/characterName";
import { syncCharacterNickname, setTurnPingRole, setRomanceOptOutRole, ensureCharacterRole } from "@/lib/discordGuild";
import { normalizeSelection } from "@/lib/portrait/catalog";
import { renderPortrait } from "@/lib/portrait/render";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

export async function updateCharacterProfile(formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character");

  // A character's name is SET AT CREATION and never read from this form
  // again — honorific, firstName and lastName are all ignored here, however
  // the form is posted. The greyed inputs on the sheet are the hint; this is
  // the lock, same posture as `age` below and `title` before it.
  //
  // The one exception in the game is the Mulligan Potion (docs/tags.yaml),
  // and it is deliberately not automated: a player consumes it, and a GM
  // renames them from /gm/dev/characters/[characterId]. That keeps
  // web/lib/characterWrite.js the only remaining rename path, which is also
  // the only one that plans the Discord fan-out (role title, colour,
  // nickname, dynasty propagation) properly.
  const appearance =
    formData.get("appearance")?.toString().trim().slice(0, APPEARANCE_MAX_LENGTH) || null;
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

  const data = { appearance, turnPingOptIn, romanceOptOut };
  if (age !== null && character.age === null) data.age = age;

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
  await syncCharacterNickname(session.discordUserId, formatBareName(updated)).catch(() => {});
  await setTurnPingRole(session.discordUserId, updated.turnPingOptIn).catch(() => {});
  await setRomanceOptOutRole(session.discordUserId, updated.romanceOptOut).catch(() => {});
  // Kept as a self-heal, not a rename: the name can no longer change here, so
  // this only ever creates a personal role that went missing.
  await ensureCharacterRole(updated).catch(() => {});
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
