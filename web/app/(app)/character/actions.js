"use server";

import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { redirect } from "next/navigation";
import { prisma, loadConcealment, loadForcedName } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { APPEARANCE_MAX_LENGTH } from "@/lib/constants";
import { AGE_MIN, AGE_MAX, formatBareName } from "@/lib/characterName";
import { syncCharacterNickname, setTurnPingRole, ensureCharacterRole } from "@/lib/discordGuild";
import { normalizeSelection } from "@/lib/portrait/catalog";
import { renderPortrait } from "@/lib/portrait/render";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

// Driven by useActionState in web/app/components/BioForm.js, hence the
// leading `_prevState`. Returning { error } rather than throwing is the rule
// in web/lib/actionResult.js: Next redacts anything thrown out of a Server
// Action into React error #441, so the avatar size check below used to reach
// the player as a digest instead of a sentence.
export async function updateCharacterProfile(_prevState, formData) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
  });
  if (!character) redirect("/character");

  // A character's name and GENDER are SET AT CREATION and never read from this
  // form again — honorific, firstName, lastName and gender are all ignored
  // here, however the form is posted. The greyed inputs on the sheet are the
  // hint; this silence is the lock, same posture as `title`.
  //
  // Gender deliberately does NOT get `age`'s null-until-set conditional below:
  // there is no unset state to leave open. It is chosen once and only a GM can
  // correct it, from /gm/dev/characters/[characterId].
  //
  // The one exception for the name is the Mulligan Potion (docs/tags.yaml),
  // which is a CHANGE_NAME request handled by
  // character/requestActions.js#changeNameRequestImpl — it applies immediately
  // and a GM can undo it. Gender has no such exception.
  const appearance =
    formData.get("appearance")?.toString().trim().slice(0, APPEARANCE_MAX_LENGTH) || null;
  const turnPingOptIn = formData.get("turnPingOptIn") === "on";
  // The conceal toggle. No Discord side effect: the proxy pipeline resolves
  // concealment at send time (PROXYING.md). A forced identity (Tag.forcedName
  // — Apex Form's "Beast") locks it off: the switch renders disabled, and this
  // is the lock behind it. The same tag fixes the face, so an upload is
  // dropped too.
  const forcedName = await loadForcedName(prisma, character.id);
  // And the gear gate, the same one /conceal applies. Without something
  // concealing EQUIPPED there is nothing to turn on; under something that
  // forces it there is no choice either way, so the stored preference is left
  // exactly as it was rather than being quietly rewritten by a form post.
  const concealment = forcedName ? null : await loadConcealment(prisma, character.id);
  const concealed = concealment?.forced
    ? character.concealed
    : Boolean(concealment) && formData.get("concealed") === "on";
  const avatar = forcedName ? null : formData.get("avatar");

  // Age is set once and then fixed. The input renders `disabled` after the
  // first save so it submits nothing, but that is only the UI half — this is
  // the lock: a non-null age is never overwritten, however the form is posted.
  // A GM can still change it from /gm/dev/characters/[characterId].
  const rawAge = Number.parseInt(formData.get("age")?.toString() ?? "", 10);
  const age =
    Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;

  const data = { appearance, turnPingOptIn, concealed };
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
      return { error: `That image is ${(avatar.size / 1024 / 1024).toFixed(1)}MB. It has to be under 5MB.` };
    }
    try {
      const buffer = Buffer.from(await avatar.arrayBuffer());
      data.avatarData = await sharp(buffer)
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
        .webp({ quality: 85 })
        .toBuffer();
      data.avatarMimeType = "image/webp";
    } catch (err) {
      // sharp throws on anything it can't decode, and the file picker's
      // accept="image/*" is a hint rather than a guarantee. Nothing has been
      // written yet, so refusing here leaves the sheet as it was.
      console.error("Failed to process an uploaded avatar:", err);
      return { error: "That image couldn't be read. Try a JPEG or a PNG." };
    }
  }

  const updated = await prisma.character.update({ where: { id: character.id }, data });
  await syncCharacterNickname(session.discordUserId, formatBareName(updated)).catch(() => {});
  await setTurnPingRole(session.discordUserId, updated.turnPingOptIn).catch(() => {});
  // Kept as a self-heal, not a rename: the name can no longer change here, so
  // this only ever creates a personal role that went missing.
  await ensureCharacterRole(updated).catch(() => {});
  revalidatePath("/character");
  return { ok: true };
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
  // The face is fixed while a forced identity is held (Tag.forcedName); the
  // button is hidden, and this is the lock.
  if (await loadForcedName(prisma, character.id)) {
    return { ok: false, error: "Your face is not yours to change right now. ‡" };
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

