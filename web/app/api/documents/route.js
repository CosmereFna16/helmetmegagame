import { NextResponse } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getMyZone } from "@/lib/gmZone";
import { documentSource, isWritten, readerFromCharacter } from "@/lib/documentAccess";
import { toDocumentPreviewText } from "@/lib/documentPreview";

// Backs the {document:key} inline reference syntax (see
// web/app/components/RichText.js) — the same shape as /api/tags, and for the
// same reason: a small dataset fetched whole and cached client-side beats
// looking one up at a time.
//
// What it does NOT do is ship every document to every reader. /documents is
// careful to resolve visibility on the server so a player's browser never
// receives a Gamemaster brief, and a chip route that dumped the lot would
// undo that in one line. So:
//
//   name        ships for every written document. The reference is embedded
//               in prose the reader is already looking at, so naming the
//               document tells them nothing they were not about to read —
//               and it is what lets a locked chip say WHICH document it is.
//   source      only when they may read it.
//   excerpt     only when they may read it, and truncated: the hover panel
//               wants a taste, not the document. Shipping ~35 full Markdown
//               bodies on every page load is not worth it.
//
// The rules themselves live in web/lib/documentAccess.js, shared with
// /documents — two copies of a visibility rule drift, and the failure here is
// telling a player they can open something they cannot.
//
// Session-dependent, so it must not be cached across callers.
export const dynamic = "force-dynamic";

const EXCERPT_CHARS = 160;

function excerptOf(description) {
  const flat = toDocumentPreviewText(description).replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  // Cut on a word boundary so the ellipsis doesn't land mid-word.
  return `${flat.slice(0, flat.lastIndexOf(" ", EXCERPT_CHARS))}…`;
}

export async function GET() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return NextResponse.json([]);

  const [documents, characterRow] = await Promise.all([
    prisma.document.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      include: {
        role: true,
        faction: true,
        tags: { include: { tag: { select: { slug: true, name: true } } } },
      },
    }),
  ]);

  const character = readerFromCharacter(characterRow);
  const myZone = isGm ? await getMyZone() : null;
  const isMasterGm = isGm && myZone === null;

  const entries = documents.filter(isWritten).map((d) => {
    const source = documentSource(d, { character, isGm, isMasterGm });
    return {
      key: d.key,
      name: d.name,
      accessible: source !== null,
      source,
      excerpt: source ? excerptOf(d.description) : null,
    };
  });

  return NextResponse.json(entries);
}
