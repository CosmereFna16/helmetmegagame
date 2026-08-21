import { NextResponse } from "next/server";
import { prisma, PRODUCTION_RATES, computeRate, formatRate } from "@lifeweb/db";

// Backs the {resource:field:tier} inline reference syntax (see
// web/app/components/RichText.js) — computed live from the current
// productionCoefficient so docs/documents.yaml's printed numbers never
// drift from what the labor commands actually pay out. Hunting is just
// another field here now, not a separate key.
//
// Each tier ships a `display` string already formatted ("3", or "0–4" for a
// range) so the en dash has one implementation and no client component has
// to import @lifeweb/db — which would drag PrismaClient into a "use client"
// bundle.
export async function GET() {
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

  return NextResponse.json({ coefficient, rates });
}
