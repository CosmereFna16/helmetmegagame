import { NextResponse } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";

// Backs the {tag:id} / {tag:slug} inline reference syntax (see
// web/app/components/RichText.js) — small enough dataset to fetch whole and
// cache client-side rather than looking up one at a time.
//
// It is NOT the whole catalog any more. A tag whose group carries a
// requiredTag sits in a hidden category (Demoness, Bacchus — see
// docs/systemdocs/TAGS.md §3), and this route is the one place a curious
// player could otherwise read every one of them straight out of DevTools. So
// it resolves the caller's own character and withholds any tag they haven't
// unlocked.
//
// Gating is on the GROUP gate only, deliberately — never on a tag's own
// requiredTag. Fighting (Archer) isn't a secret, and hiding it would break
// the {tag:fighting-archer} references in public documents for everyone who
// hasn't bought it.
//
// Session-dependent, so it must not be cached across callers.
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const [tags, character] = await Promise.all([
    prisma.tag.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        pointCost: true,
        category: true,
        group: { select: { slug: true, name: true, color: true, requiredTagId: true } },
        removable: true,
        craftable: true,
        // Minified via formatTagRequirement (@lifeweb/db) wherever a tag's
        // description renders — see Tag.requirement* in schema.prisma.
        requirementTurns: true,
        requirementResources: true,
        requirementGambit: true,
        requirementSkills: { select: { id: true, slug: true, name: true } },
      },
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
  const visible = tags.filter(
    (tag) => !tag.group?.requiredTagId || held.has(tag.group.requiredTagId),
  );

  return NextResponse.json(visible);
}
