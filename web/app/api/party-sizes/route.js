import { NextResponse } from "next/server";
import { prisma, PARTY_SIZE_TIERS, partySize, formatPartySize } from "@lifeweb/db";

// Backs the {partysize:N} inline reference syntax (see
// web/app/components/RichText.js) — the Cult of Bacchus's party goals,
// computed live from GameConfig.playerCount so docs/documents.yaml's printed
// numbers never drift from what a GM is actually adjudicating against. Same
// shape as /api/production-rates, and for the same reason.
//
// Each tier ships a `display` string already formatted, so the string form
// has one implementation and no client component has to import @lifeweb/db —
// which would drag PrismaClient into a "use client" bundle.
//
// force-dynamic, unlike the production-rates route: playerCount is a live
// dial on /gm/dev, so a statically cached response would keep serving the
// build-time thresholds until the next deploy.
export const dynamic = "force-dynamic";

export async function GET() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const playerCount = config?.playerCount ?? 100;

  const sizes = Object.fromEntries(
    PARTY_SIZE_TIERS.map((tier) => {
      const value = partySize(tier, playerCount);
      return [tier, { value, display: formatPartySize(value) }];
    }),
  );

  return NextResponse.json({ playerCount, sizes });
}
