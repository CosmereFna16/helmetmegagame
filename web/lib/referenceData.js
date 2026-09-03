import { prisma, PRODUCTION_RATES, computeRate, formatRate } from "@lifeweb/db";
import { carryCaps, carryBonusLine, MULT_SCALE } from "@lifeweb/db/lib/carry";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getMyZones } from "@/lib/gmZone";
import { documentSource, isWritten, readerFromCharacter } from "@/lib/documentAccess";
import { toDocumentPreviewText } from "@/lib/documentPreview";

// The three datasets behind the {tag:…} / {resource:…} / {document:…}
// inline reference syntax. The root layout calls these
// un-awaited and streams the promises into client providers, so the data
// rides the initial response instead of a post-hydration round trip.

// The tag list is not the whole catalog: a tag whose group carries a
// requiredTag sits in a hidden category (Demoness — TAGS.md §3),
// withheld unless the caller's own character has unlocked it. Gating is on
// the GROUP gate only — a tag's own requiredTag stays visible so
// {tag:ranged-archer} references still work for players who haven't bought it.
//
// Exactly the Tag columns TagChip reads. Shared so every TagChip caller
// (this module, /gm/turns) uses the same shape instead of a copy that drifts.
export const TAG_CHIP_FIELDS = {
  id: true,
  slug: true,
  name: true,
  description: true,
  pointCost: true,
  category: true,
  // Drives TagChip's "Requires" line. A caller gating to what the viewer
  // holds must filter group-gated tags itself — the name would tip off
  // anyone else.
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
  // Minified via formatTagRequirement wherever a description renders.
  requirementTurns: true,
  requirementResources: true,
  requirementGambit: true,
  requirementSkills: { select: { id: true, slug: true, name: true } },
  // A prose {tag:…} reference has no live expiresTurn, so this is the only
  // way to tell a reader how long the tag would last (TagChip.js).
  defaultDurationTurns: true,
  // What the tag turns into when its duration runs out (untreated-wound
  // chain); TagChip renders it as "Becomes".
  expiresInto: true,
  // Drives TagChip's "Seen by others" line (Tag.inspectVisibility).
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

  // A signed-out caller, or one with no living character, holds nothing.
  const held = new Set((character?.tags ?? []).map((ct) => ct.tagId));
  return tags.filter((tag) => !tag.group?.requiredTagId || held.has(tag.group.requiredTagId));
}

// Computed live from productionCoefficient so docs/documents.yaml's printed
// numbers never drift from actual payout. Each tier ships a pre-formatted
// `display` string so no client component has to import @lifeweb/db, which
// would drag PrismaClient into a "use client" bundle. Must be computed
// per-request — productionCoefficient is a live dial on /gm/dev.
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

// The {carry:slug} token (RichText.js): the sentence a carry tag's
// description ends with, pre-formatted per tag from the live caps so the
// client never imports @lifeweb/db. Keyed by slug so a description only
// names itself and the multiplier stays single-sourced in docs/tags.yaml.
export async function getCarryReference() {
  const [config, tags] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { carryTagCap: true, carryResourceCap: true } }),
    prisma.tag.findMany({
      where: { carryMultiplier: { not: null } },
      select: { slug: true, carryMultiplier: true },
    }),
  ]);
  const lines = Object.fromEntries(tags.map((t) => [t.slug, carryBonusLine(config, t.carryMultiplier)]));
  return { base: carryCaps(config, MULT_SCALE), lines };
}

const EXCERPT_CHARS = 160;

function excerptOf(description) {
  const flat = toDocumentPreviewText(description).replace(/\s+/g, " ").trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", EXCERPT_CHARS))}…`;
}

// The document index for {document:key} chips. Does not ship every
// document to every reader: `name` ships for every written document (so a
// locked chip can say which one), `source`/`excerpt` only when the reader
// may read it. Visibility rules live in web/lib/documentAccess.js, shared
// with /documents. Session-dependent — must never be cached across callers.
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
  // Holding no seat is the master's state; a GM seated anywhere is a
  // zone-GM and does not see Secret papers.
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
