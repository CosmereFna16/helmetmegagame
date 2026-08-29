import { redirect } from "next/navigation";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_ZONE_SLUG,
  DEPOT_CREDIT_CAP,
  DEPOT_MAX_QUANTITY,
  creditAvailable,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import DepotCounter from "@/app/components/DepotCounter";
import DepotCreditPanel from "@/app/components/DepotCreditPanel";
import PageShell, { PageHeader } from "@/app/components/PageShell";

// The Merchant's counter with the orbital station. See
// docs/systemdocs/DEPOT.md.
//
// Gated on the Merchant's License tag, not on the Merchant ROLE: the licence
// is tradeable, so handing it over really does hand over the Depot, and a role
// check would quietly break that. Unlike /lifeweb there is no GM half — a GM
// with no licensed character has nothing to do here that /gm/dev cannot
// already do, so they are redirected like anyone else.

// TagChip renders from the catalog row, so ask for the whole tag rather than
// picking fields off it — the chip's hover card wants the description, the
// requirement block and the duration.
const TAG_SELECT = { include: { group: { select: { name: true } } } };

export default async function DepotPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: {
      discordUserId: session.discordUserId,
      status: "ALIVE",
      tags: { some: { tag: { slug: MERCHANT_LICENSE_SLUG } } },
    },
    select: {
      id: true,
      resources: true,
      depotDebt: true,
      zone: { select: { slug: true } },
    },
  });
  if (!character) redirect("/character");

  const [wareTags, held] = await Promise.all([
    // The shelf: everything the station stocks. Infinite supply — price is the
    // only limiter, which is the whole design (DEPOT.md §1).
    prisma.tag.findMany({ where: { depotPrice: { not: null } }, ...TAG_SELECT }),
    // His own inventory, narrowed to what the station will actually buy.
    prisma.characterTag.findMany({
      where: { characterId: character.id, tag: { sellable: true } },
      include: { tag: TAG_SELECT },
    }),
  ]);

  const wares = wareTags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    description: tag.description ?? "",
    groupName: tag.group?.name ?? "",
    price: tag.depotPrice,
    stackable: tag.stackable,
    tag,
  }));

  const stock = held.map((ct) => ({
    id: ct.tag.id,
    name: ct.tag.name,
    description: ct.tag.description ?? "",
    groupName: ct.tag.group?.name ?? "",
    price: ct.tag.sellablePrice,
    stackable: ct.tag.stackable,
    held: ct.quantity,
    tag: ct.tag,
  }));

  // The second gate, and the same one the Lifeweb applies at the tower: the
  // Depot is a shuttle parked at Customs. He can read the price list from
  // anywhere; trading needs his boots on that ground.
  const atDepot = character.zone?.slug === DEPOT_ZONE_SLUG;
  const debt = character.depotDebt ?? 0;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="The Depot"
        subtitle="An automated shuttle at the Customs. It flies to a nearby city at supersonic speeds—the roundtrip is a few hours. It's small, but it fits a person; you could hitch a ride if necessary. Beats the trains…"
      />

      {!atDepot && (
        <p className="text-sm text-muted">
          You are not at Customs. The list is current, but the shuttle will not open its hold for
          someone who isn&apos;t standing in front of it.
        </p>
      )}

      <section className="panel p-5">
        <h2 className="panel-header">Wares</h2>
        <DepotCounter
          wares={wares}
          stock={stock}
          resources={character.resources}
          maxQuantity={DEPOT_MAX_QUANTITY}
          disabled={!atDepot}
        />
        <p className="mt-3 text-xs text-muted">
          Trades settle immediately and a GM reviews them afterwards. What you charge Ravenheart for
          any of it is between you and Ravenheart.
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">Credit</h2>
        <DepotCreditPanel
          debt={debt}
          cap={DEPOT_CREDIT_CAP}
          available={creditAvailable(debt)}
          resources={character.resources}
          disabled={!atDepot}
        />
      </section>
    </PageShell>
  );
}
