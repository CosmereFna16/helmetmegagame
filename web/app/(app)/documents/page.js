import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getMyZone } from "@/lib/gmZone";
import PageShell, { PageHeader } from "../../components/PageShell";
import DocumentsBoard from "./DocumentsBoard";
import { toDocumentPreviewText } from "@/lib/documentPreview";
import { assignedTo, isWritten, readerFromCharacter } from "@/lib/documentAccess";

export const metadata = { title: "Documents" };

// The matching rules live in web/lib/documentAccess.js so getDocumentIndex --
// which decides whether a {document:key} chip is a working link or an inert
// one -- cannot disagree with this page about who may read what. Matching
// still runs here on the server, so the client only ever receives documents
// that already apply.

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

  const character = readerFromCharacter(characterRow);
  const written = documents.filter(isWritten);

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

  const myZone = isGm ? await getMyZone() : null;
  const isMasterGm = isGm && myZone === null;

  const secretDocs = isMasterGm
    ? written.filter((d) => d.isSecret).map((d) => shape(d, "Secret"))
    : [];

  // The All tab: every written document in the game, GM-only. Same gate as
  // gmDocs above — a Discord role, resolved server-side, so a player's browser
  // never receives the text. Its source line answers a different question from
  // every other tab's: not "why is this in your folder" (it isn't in anyone's
  // folder here) but "how does this paper reach a player at all".
  //
  // Secret papers are the one exception to "every document": they stay gated to
  // master GMs here exactly as they are in the Secret tab, so a zone-GM's All
  // never leaks a threat brief they can't open.
  //
  // A paper can also be handed out by a role's doc_elements list, which lives
  // on Role rather than on the document — so answering "unrouted" honestly
  // costs one extra query, run only for a GM.
  const docElementKeys = isGm
    ? new Set(
      (await prisma.role.findMany({ select: { docElements: true } }))
        .flatMap((r) => r.docElements),
    )
    : new Set();
  const allSource = (d) => {
    if (d.isPublic) return "Public";
    if (d.flags.includes("gamemaster")) return "Gamemaster";
    const routed =
      docElementKeys.has(d.key) ||
      d.tagSlugs.length > 0 ||
      d.roleSlugs.length > 0 ||
      d.factionSlugs.length > 0 ||
      d.flags.length > 0;
    return routed ? "Assigned" : "Unrouted";
  };
  const allDocs = isGm
    ? written.filter((d) => isMasterGm || !d.isSecret).map((d) => shape(d, allSource(d)))
    : [];

  const assignedDocs = character
    ? written
      .map((d) => [d, assignedTo(d, character)])
      .filter(([, source]) => source !== null)
      .map(([d, source]) => shape(d, source))
    : [];

  // The role charter, pinned first in Assigned.
  //
  // Role.description is a String[] of plain sentences (docs/roles.yaml), not
  // Markdown like a Document — joining them as a bullet list is the whole
  // conversion, and it is what lets this reuse the ordinary card and sheet
  // untouched. It has been written and synced for all 49 roles since the
  // start and rendered nowhere; the nearest a player got was role.intro in
  // the creation wizard.
  //
  // `role: true` is already in the include above, so this costs no query.
  //
  // Not a Document row, so {document:…} can never resolve to it — the index
  // getDocumentIndex builds only ever lists real rows.
  const roleCharter =
    character?.role?.description?.length > 0
      ? {
        pinned: true,
        key: "role",
        name: character.role.name,
        source: "Your Role",
        description: character.role.description.map((line) => `- ${line}`).join("\n"),
        // Blank lines, not bullets: the card preview is flattened prose.
        previewText: character.role.description.join("\n\n"),
      }
      : null;

  const assigned = roleCharter ? [roleCharter, ...assignedDocs] : assignedDocs;

  return (
    <PageShell width="wide">
      <PageHeader
        title="Documents"
        subtitle="Use these documents to learn more about your role, the game mechanics, and Ravenheart in general."
      />
      <DocumentsBoard
        publicDocs={publicDocs}
        assignedDocs={assigned}
        gmDocs={gmDocs}
        secretDocs={secretDocs}
        allDocs={allDocs}
        hasCharacter={!!character}
      />
    </PageShell>
  );
}
