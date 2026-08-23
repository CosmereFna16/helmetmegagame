import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import PageShell, { PageHeader } from "../../components/PageShell";
import DocumentsBoard from "./DocumentsBoard";
import { toDocumentPreviewText } from "@/lib/documentPreview";

export const metadata = { title: "Documents" };

// Which of a character's traits a document can key off. Kept here rather
// than in the client component so the matching runs once on the server and
// the client only ever receives the documents that already apply.
function assignedTo(document, character) {
  if (!character) return null;
  if (character.role?.docElements?.includes(document.key)) return character.role.name;
  const tagHit = document.tagSlugs.find((slug) => character.tagSlugs.has(slug));
  if (tagHit) return character.tagNameBySlug.get(tagHit) ?? tagHit;
  if (document.roleSlugs.includes(character.role?.slug)) return character.role.name;
  if (document.factionSlugs.includes(character.faction?.slug)) return character.faction.name;
  if (document.flags.includes("leader") && character.isLeader) return "Leader";
  if (document.flags.includes("treasurer") && character.isTreasurer) return "Treasurer";
  return null;
}

export default async function DocumentsPage() {
  // getGmSession() wraps auth() and is React-cached, so asking Discord whether
  // this user is a GM costs this page nothing it wasn't already paying.
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

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

  const character = characterRow && {
    ...characterRow,
    tagSlugs: new Set(characterRow.tags.map((ct) => ct.tag.slug)),
    tagNameBySlug: new Map(characterRow.tags.map((ct) => [ct.tag.slug, ct.tag.name])),
  };

  // A document with no prose yet is a slot waiting to be written (see the
  // stubs in docs/documents.yaml) — never show a player an empty page.
  const written = documents.filter((d) => d.description.trim().length > 0);

  const shape = (d, source) => ({
    key: d.key,
    name: d.name,
    description: d.description,
    previewText: toDocumentPreviewText(d.description),
    source,
  });

  const publicDocs = written.filter((d) => d.isPublic).map((d) => shape(d, "Public"));

  // GM-only papers. Unlike every other assignment, this one keys off a Discord
  // role rather than anything on a Character — a GM usually has no character at
  // all. Resolved here rather than in the client for the same reason the rest
  // of this file is: a player's browser must never receive the text.
  const gmDocs = isGm
    ? written.filter((d) => d.flags.includes("gamemaster")).map((d) => shape(d, "Gamemaster"))
    : [];
  const assignedDocs = character
    ? written
      .map((d) => [d, assignedTo(d, character)])
      .filter(([, source]) => source !== null)
      .map(([d, source]) => shape(d, source))
    : [];

  return (
    <PageShell width="wide">
      <PageHeader
        title="Documents"
        subtitle="Use these documents to learn more about your role, the game mechanics, and Ravenheart in general."
      />
      <DocumentsBoard
        publicDocs={publicDocs}
        assignedDocs={assignedDocs}
        gmDocs={gmDocs}
        hasCharacter={!!character}
      />
    </PageShell>
  );
}
