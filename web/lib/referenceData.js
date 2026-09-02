import { prisma, PRODUCTION_RATES, computeRate, formatRate, PARTY_SIZE_TIERS, partySize, formatPartySize } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyZones } from "@/lib/gmZone";
import { documentSource, isWritten, readerFromCharacter } from "@/lib/documentAccess";
import { toDocumentPreviewText } from "@/lib/documentPreview";

// The four datasets behind the {tag:…} / {resource:…} / {partysize:…} /
// {document:…} inline reference syntax (see web/app/components/RichText.js).
// The root layout calls these un-awaited and streams the promises into the
// client providers, so the data rides the initial response instead of
// costing four client round trips after hydration — and doesn't block first
// paint either.

// The tag list is NOT the whole catalog. A tag whose group carries a
// requiredTag sits in a hidden category (Demoness, Bacchus — see
// docs/systemdocs/TAGS.md §3), and this list is the one place a curious
// player could otherwise read every one of them straight out of DevTools. So
// it resolves the caller's own character and withholds any tag they haven't
// unlocked.
//
// Gating is on the GROUP gate only, deliberately — never on a tag's own
// requiredTag. Ranged (Archer) isn't a secret, and hiding it would break
// the {tag:ranged-archer} references in public documents for everyone who
// hasn't bought it.
//
// Exactly the Tag columns TagChip (and formatTagRequirement/prerequisiteNames)
// read, and nothing else. Shared so every caller that feeds TagChip — this
// module, the /gm/turns queue and inspector — selects the same shape instead
// of maintaining their own copy that quietly drifts (group/category fell out
// of the /gm/turns copies this way once already, which is why every chip
// there rendered uncoloured with no "Requires" row).
export const TAG_CHIP_FIELDS = {
  id: true,
  slug: true,
  name: true,
  description: true,
  pointCost: true,
  category: true,
  // The prerequisite gates' NAMES drive TagChip's "Requires" line. A caller
  // gating a list to what the viewer holds (getVisibleTags below) must filter
  // group-gated tags to gate-holders itself — the name would tip off anyone
  // else.
  requiredTagId: true,
  requiredTag: { select: { name: true } },
  group: {
    select: {
      slug: true,
      name: true,
      color: true,
      requiredTagId: true,
      requiredTag: { select: { name: true } },
    },
  },
  removable: true,
  craftable: true,
  // Minified via formatTagRequirement (@lifeweb/db) wherever a tag's
  // description renders — see Tag.requirement* in schema.prisma.
  requirementTurns: true,
  requirementResources: true,
  requirementGambit: true,
  requirementSkills: { select: { id: true, slug: true, name: true } },
  // A prose {tag:…} reference has no CharacterTag behind it and so no
  // live expiresTurn — this is the only thing that can tell a reader
  // how long the tag would last. See TagChip.js's expiry line.
  defaultDurationTurns: true,
  // What this tag turns into when that duration runs out — the
  // untreated-wound chain. TagChip renders it as a "Becomes" line, so a
  // player can see the threat before the timer teaches them.
  expiresInto: true,
  // Drives TagChip's "Seen by others" line — whether a 🔍 inspect shows this
  // tag to another player, and whether it does so only while the tag is
  // equipped (Tag.inspectVisibility).
  inspectVisibility: true,
};

// Session-dependent, so it must never be cached across callers.
export async function getVisibleTags() {
  const session = await auth();
  const [tags, character] = await Promise.all([
    prisma.tag.findMany({
      select: TAG_CHIP_FIELDS,
    }),
    session?.discordUserId
      ? prisma.character.findFirst({
          where: { discordUserId: session.discordUserId, status: "ALIVE" },
          select: { tags: { select: { tagId: true } } },
        })
      : null,
  ]);

  // A signed-out caller, or one with no living character, holds nothing —
  // which is exactly the right answer, not a reason to skip the filter.
  const held = new Set((character?.tags ?? []).map((ct) => ct.tagId));
  return tags.filter((tag) => !tag.group?.requiredTagId || held.has(tag.group.requiredTagId));
}

// Computed live from the current productionCoefficient so
// docs/documents.yaml's printed numbers never drift from what the labor
// commands actually pay out. Hunting is just another field here now, not a
// separate key.
//
// Each tier ships a `display` string already formatted ("3", or "0–4" for a
// range) so the en dash has one implementation and no client component has
// to import @lifeweb/db — which would drag PrismaClient into a "use client"
// bundle. productionCoefficient is a live dial on /gm/dev, so this must be
// computed per-request, never cached.
export async function getProductionRates() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const coefficient = config?.productionCoefficient ?? 1;

  const rates = Object.fromEntries(
    Object.keys(PRODUCTION_RATES).map((field) => [
      field,
      Object.fromEntries(
        Object.keys(PRODUCTION_RATES[field]).map((tier) => {
          const rate = computeRate(field, tier, coefficient);
          return [tier, { ...rate, display: formatRate(rate) }];
        }),
      ),
    ]),
  );

  return { coefficient, rates };
}

// The Cult of Bacchus's party goals, computed live from
// GameConfig.playerCount so docs/documents.yaml's printed numbers never
// drift from what a GM is actually adjudicating against. Same shape as
// getProductionRates, and for the same reason — playerCount is a live dial
// on /gm/dev too.
export async function getPartySizes() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const playerCount = config?.playerCount ?? 100;

  const sizes = Object.fromEntries(
    PARTY_SIZE_TIERS.map((tier) => {
      const value = partySize(tier, playerCount);
      return [tier, { value, display: formatPartySize(value) }];
    }),
  );

  return { playerCount, sizes };
}

const EXCERPT_CHARS = 160;

function excerptOf(description) {
  const flat = toDocumentPreviewText(description).replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  // Cut on a word boundary so the ellipsis doesn't land mid-word.
  return `${flat.slice(0, flat.lastIndexOf(" ", EXCERPT_CHARS))}…`;
}

// The document index for {document:key} chips. What it does NOT do is ship
// every document to every reader. /documents is careful to resolve
// visibility on the server so a player's browser never receives a Gamemaster
// brief, and an index that dumped the lot would undo that in one line. So:
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
// Session-dependent, so it must never be cached across callers.
export async function getDocumentIndex() {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return [];

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
  // Holding no seat at all is the master's state; a GM seated anywhere — one
  // zone or several — is a zone-GM and does not see Secret papers.
  const myZones = isGm ? await getMyZones() : [];
  const isMasterGm = isGm && myZones.length === 0;

  return documents.filter(isWritten).map((d) => {
    const source = documentSource(d, { character, isGm, isMasterGm });
    return {
      key: d.key,
      name: d.name,
      accessible: source !== null,
      source,
      excerpt: source ? excerptOf(d.description) : null,
    };
  });
}
