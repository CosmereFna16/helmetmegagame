import { redirect } from "next/navigation";
import { DESIRE_UNLOCK_SELECT } from "@/lib/referenceData";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getMyZones } from "@/lib/gmZone";
import PageShell, { PageHeader } from "../../components/PageShell";
import DocumentsBoard from "./DocumentsBoard";
import { toDocumentPreviewText } from "@/lib/documentPreview";
import { assignedTo, isWritten, readerFromCharacter } from "@/lib/documentAccess";
import { getHandbookBody, HANDBOOK_KEY } from "@/lib/handbook";
import { catalogTags } from "@/lib/tagCatalog";

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

  const [documents, characterRow, tagRows] = await Promise.all([
    prisma.document.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.character.findFirst({
      where: { discordUserId: session.discordUserId, status: "ALIVE" },
      include: {
        role: true,
        faction: true,
        tags: { include: { tag: { select: { slug: true, name: true } } } },
      },
    }),
    // Per-character corpse rows are junk on a catalog page; the YAML monster
    // corpses (nekker-corpse, etc.) are on the secret list below anyway.
    prisma.tag.findMany({
      where: { corpseOfCharacterId: null },
      orderBy: { name: "asc" },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            color: true,
            slug: true,
            requiredTagId: true,
            // Drives TagChip's "Requires" line, same as TAG_CHIP_FIELDS.
            requiredTag: { select: { name: true } },
          },
        },
        requiredTag: { select: { name: true } },
        requirementSkills: { select: { id: true, slug: true, name: true } },
        // The Tag Catalog tab's detail sheet, same block TagChip shows.
        ...DESIRE_UNLOCK_SELECT,
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

  // The player handbook, pinned first in Public — same synthesized-card shape
  // as the role charter below, reading from docs/handbook.md rather than a
  // Document row. Public rather than Assigned: it's the tab a character-less
  // visitor lands on, and the handbook is exactly what that visitor wants.
  // "handbook" is reserved in db/lib/syncDocuments.js#RESERVED_KEYS, so a real
  // Document can never collide with it.
  const handbookBody = getHandbookBody();
  const handbookCard = handbookBody
    ? {
      pinned: true,
      key: HANDBOOK_KEY,
      name: "Player Handbook",
      source: "Start Here",
      description: handbookBody,
      previewText: toDocumentPreviewText(handbookBody),
    }
    : null;

  const publicDocs = [
    ...(handbookCard ? [handbookCard] : []),
    ...written.filter((d) => d.isPublic).map((d) => shape(d, "Public")),
  ];

  // GM-only papers. Unlike every other assignment, this one keys off a Discord
  // role rather than anything on a Character — a GM usually has no character at
  // all. Resolved here rather than in the client for the same reason the rest
  // of this file is: a player's browser must never receive the text.
  const gmDocs = isGm
    ? written.filter((d) => d.flags.includes("gamemaster")).map((d) => shape(d, "Gamemaster"))
    : [];

  // Holding no seat at all is the master's state; a GM seated anywhere — one
  // zone or several — is a zone-GM and does not see Secret papers.
  const myZones = isGm ? await getMyZones() : [];
  const isMasterGm = isGm && myZones.length === 0;

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
  // untouched.
  //
  // Role.intro is the creation wizard's one-sentence hook (character/page.js);
  // it opens the charter, italicised. No escaping guard, so an authored `_` or
  // `*` in an intro would break the wrapper — none has one today.
  //
  // `role: true` is already in the include above, so this costs no query.
  //
  // Not a Document row, so {document:…} can never resolve to it — the index
  // getDocumentIndex builds only ever lists real rows.
  const roleIntro = character?.role?.intro?.trim() ?? "";
  const roleBullets = character?.role?.description ?? [];
  // Intro OR bullets: some roles carry `description: []`, and a length-only
  // test would drop their charter off the page entirely.
  const roleCharter =
    roleIntro || roleBullets.length > 0
      ? {
        pinned: true,
        key: "role",
        name: character.role.name,
        source: "Your Role",
        description: (roleIntro ? [`_${roleIntro}_\n`] : [])
          .concat(roleBullets.map((line) => `- ${line}`))
          .join("\n"),
        // Blank lines, not bullets: the card preview is flattened prose. Built
        // by hand rather than through toDocumentPreviewText, which flattens a
        // bullet list into one run-on string.
        previewText: (roleIntro ? [roleIntro] : []).concat(roleBullets).join("\n\n"),
      }
      : null;

  const assigned = roleCharter ? [roleCharter, ...assignedDocs] : assignedDocs;

  // Tag Catalog tab: field shape mirrors /gm/dev/tags minus GM-only extras
  // (held counts, `custom`). Filtered server-side through catalogTags so a
  // withheld tag never reaches the browser — same posture as the document
  // tabs above.
  const mappedTags = tagRows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    category: t.category,
    description: t.description,
    pointCost: t.pointCost,
    groupId: t.groupId,
    groupName: t.group?.name ?? null,
    groupColor: t.group?.color ?? null,
    // Full group shape (not just the gate fields): TagChip reads
    // group.name/color for its chip and group.requiredTag.name for the
    // "Requires" line, alongside catalogTags' gate on requiredTagId.
    group: t.group
      ? {
        slug: t.group.slug,
        name: t.group.name,
        color: t.group.color,
        requiredTagId: t.group.requiredTagId,
        requiredTag: t.group.requiredTag,
      }
      : null,
    requiredTag: t.requiredTag,
    inspectVisibility: t.inspectVisibility,
    stackable: t.stackable,
    equippable: t.equippable,
    concealsIdentity: t.concealsIdentity,
    forcedName: t.forcedName,
    consumable: t.consumable,
    removable: t.removable,
    tradeable: t.tradeable,
    craftable: t.craftable,
    healable: t.healable,
    teachable: t.teachable,
    purchasable: t.purchasable,
    purchasableAfterStart: t.purchasableAfterStart,
    catalogVisibility: t.catalogVisibility,
    depotPrice: t.depotPrice,
    defaultDurationTurns: t.defaultDurationTurns,
    sellable: t.sellable,
    sellablePrice: t.sellablePrice,
    parentTagId: t.parentTagId,
    requiredTagId: t.requiredTagId,
    consumesInto: t.consumesInto,
    expiresInto: t.expiresInto,
    removesInto: t.removesInto,
    requirementTurns: t.requirementTurns,
    requirementResources: t.requirementResources,
    requirementGambit: t.requirementGambit,
    requirementSkills: t.requirementSkills,
  }));

  const heldTagIds = (characterRow?.tags ?? []).map((ct) => ct.tagId);
  const startingTagSlugs = characterRow?.role?.startingTagSlugs ?? [];
  const tagCatalogList = catalogTags(mappedTags, { isGm, heldTagIds, startingTagSlugs });

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
        tagCatalog={tagCatalogList}
        hasCharacter={!!character}
      />
    </PageShell>
  );
}
