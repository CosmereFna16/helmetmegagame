import { prisma } from "@lifeweb/db";

export async function GET(_request, { params }) {
  const { characterId } = await params;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { avatarData: true, avatarMimeType: true },
  });

  if (!character?.avatarData) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(character.avatarData, {
    headers: {
      "Content-Type": character.avatarMimeType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
