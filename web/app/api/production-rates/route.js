import { NextResponse } from "next/server";
import { prisma, PRODUCTION_RATES, HUNTING_DICE, computeRate } from "@lifeweb/db";

// Backs the {resource:field:tier} inline reference syntax (see
// web/app/components/RichText.js) — computed live from the current
// productionCoefficient so docs/documents.yaml's printed numbers never
// drift from what /labor actually pays out.
export async function GET() {
  const config = await prisma.gameConfig.findUnique({ where: { id: 1 } });
  const coefficient = config?.productionCoefficient ?? 1;

  const rates = Object.fromEntries(
    Object.keys(PRODUCTION_RATES).map((field) => [
      field,
      Object.fromEntries(
        Object.keys(PRODUCTION_RATES[field]).map((tier) => [tier, computeRate(field, tier, coefficient)]),
      ),
    ]),
  );

  return NextResponse.json({ coefficient, rates, hunting: HUNTING_DICE });
}
