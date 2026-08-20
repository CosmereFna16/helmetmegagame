import sharp from "sharp";
import { prisma } from "@lifeweb/db";

let defaultAvatarBuffer;
function getDefaultAvatar() {
  defaultAvatarBuffer ??= sharp({
    create: { width: 256, height: 256, channels: 4, background: { r: 0x9a, g: 0x9a, b: 0x9a, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return defaultAvatarBuffer;
}

export async function GET(_request, { params }) {
  const { characterId } = await params;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { avatarData: true, avatarMimeType: true },
  });

  if (!character) {
    return new Response("Not found", { status: 404 });
  }

  const data = character.avatarData ?? (await getDefaultAvatar());
  const contentType = character.avatarData ? (character.avatarMimeType ?? "application/octet-stream") : "image/png";

  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
