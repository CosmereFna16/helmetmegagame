import { NextResponse } from "next/server";
import { prisma } from "@lifeweb/db";

// Backs the {tag:id} / {tag:slug} inline reference syntax (see
// web/app/components/RichText.js) — small enough dataset to fetch whole and
// cache client-side rather than looking up one at a time.
export async function GET() {
  const tags = await prisma.tag.findMany({
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      pointCost: true,
      category: true,
      group: { select: { slug: true, name: true, color: true } },
    },
  });
  return NextResponse.json(tags);
}
