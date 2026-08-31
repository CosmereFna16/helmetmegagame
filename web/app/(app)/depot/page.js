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
import { isSuperadmin } from "@/lib/superadmin";
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
// already do, so they are redirected like anyone else. A superadmin without
// the licence gets a read-only price list instead: no counters, no credit,
// and every trade action still re-checks the licence server-side.

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
  // A superadmin with no licensed character reads the shelf; everyone else
  // is bounced. `spectating` shapes the whole render below: no held counts,
  // no credit line, every control disabled.
  const spectating = !character;
  if (spectating && !isSuperadmin(session.discordUserId)) redirect("/character");

  const [wareTags, sellableTags, held] = await Promise.all([
    // The shelf: everything the station stocks. Infinite supply — price is the
    // only limiter, which is the whole design (DEPOT.md §1).
    prisma.tag.findMany({ where: { depotPrice: { not: null } }, ...TAG_SELECT }),
    // The whole price list, not just what he happens to be carrying — a
    // Merchant needs to know what everything is worth before he goes and
    // gets it.
    prisma.tag.findMany({ where: { sellable: true, sellablePrice: { not: null } }, ...TAG_SELECT }),
    // His own inventory, so the price list can be split into what he can
    // sell right now and what he'd have to go get first.
    spectating
      ? []
      : prisma.characterTag.findMany({
          where: { characterId: character.id, tag: { sellable: true } },
          select: { tagId: true, quantity: true },
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

  const heldByTagId = new Map(held.map((ct) => [ct.tagId, ct.quantity]));

  // Sorted held-first here, rather than left to the table's default sort,
  // because SORT is stable: pre-ordering by price within each half means the
  // default "held desc" view reads as two price-ordered lists, not one
  // shuffled by insertion order.
  const stock = sellableTags
    .map((tag) => ({
      id: tag.id,
      name: tag.name,
      description: tag.description ?? "",
      groupName: tag.group?.name ?? "",
      price: tag.sellablePrice,
      stackable: tag.stackable,
      held: heldByTagId.get(tag.id) ?? 0,
      tag,
    }))
    .sort((a, b) => a.price - b.price);

  // The second gate, and the same one the Lifeweb applies at the tower: the
  // Depot is a shuttle parked at Customs. He can read the price list from
  // anywhere; trading needs his boots on that ground.
  const atDepot = !spectating && character.zone?.slug === DEPOT_ZONE_SLUG;
  const debt = spectating ? 0 : (character.depotDebt ?? 0);

  return (
    <PageShell width="narrow">
      <PageHeader
        title="The Depot"
        subtitle="An automated shuttle at the Customs. It flies to a nearby city at supersonic speeds—the roundtrip is a few hours. It's small, but it fits a person; you could hitch a ride if necessary. Beats the trains…"
      />

      {spectating ? (
        <p className="text-sm text-muted">
          Read-only view — you hold no Merchant&apos;s License. The prices are live; the counter is
          not yours.
        </p>
      ) : (
        !atDepot && (
          <p className="text-sm text-muted">
            You are not at Customs. The list is current, but the shuttle will not open its hold for
            someone who isn&apos;t standing in front of it.
          </p>
        )
      )}

      <section className="panel p-5">
        <h2 className="panel-header">Wares</h2>
        <DepotCounter
          wares={wares}
          stock={stock}
          resources={spectating ? 0 : character.resources}
          maxQuantity={DEPOT_MAX_QUANTITY}
          disabled={!atDepot}
        />
        <p className="mt-3 text-xs text-muted">
          Trades settle immediately and a GM reviews them afterwards. What you charge Ravenheart for
          any of it is between you and Ravenheart.
        </p>
      </section>

      {/* Credit is a personal debt line, so a spectator has none to show. */}
      {!spectating && (
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
      )}
    </PageShell>
  );
}
