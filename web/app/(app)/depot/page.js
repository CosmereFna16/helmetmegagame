import { redirect } from "next/navigation";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_LOCATION_SLUG,
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  loadDepot,
  depotPowered,
  fuelTurnsLeft,
  creditAvailableObols,
  canOpenCrate,
  presentedIdentity,
  forcedNameFrom,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { REQUEST_TYPE_LABELS } from "@/lib/requestLabels";
import DepotConsole from "@/app/components/DepotConsole";
import PageShell, { PageHeader } from "@/app/components/PageShell";

// The Merchant's station. See docs/systemdocs/DEPOT.md.
//
// Three ways in, and they are deliberately different. The Merchant's Licence
// runs the place — the licence and not the ROLE, because the licence is
// tradeable and handing it over really does hand over the Depot. A Depot
// Keycard reads it: a Docker needs to know whether the generator is alive and
// what is on the pad, and can crack open the crates he is carrying, but
// operates nothing. A superadmin reads it too. Everyone else is bounced.
const TAG_SELECT = { include: { group: { select: { name: true } } } };

// How many ledger rows to hand the client. Enough to be a book, few enough
// that a month-old game does not ship a megabyte of JSON to a browser.
const LEDGER_LIMIT = 200;

const DEPOT_REQUEST_TYPES = [
  "DEPOT_BUY",
  "DEPOT_SELL",
  "DEPOT_CREDIT",
  "DEPOT_ORDER",
  "DEPOT_SHIP",
  "DEPOT_ATM",
  "DEPOT_CRATE_OPEN",
  "DEPOT_REFUEL",
];

// One line of prose per ledger row, and the obols it moved. Derived from the
// `effect` snapshot rather than live state, the same rule Undo follows — a row
// has to keep reading correctly after the catalog moves under it.
function ledgerRow(request, who) {
  const e = request.effect ?? {};
  switch (request.type) {
    case "DEPOT_ORDER":
      return { detail: (e.lines ?? []).map((l) => `${l.name} ×${l.quantity}`).join(", "), delta: -(e.total ?? 0) };
    case "DEPOT_SHIP":
      return e.direction === "UP"
        ? { detail: `Sent up ${(e.soldTags ?? []).length} lot(s)${e.resourcesSpent ? ` and ${e.resourcesSpent} ⬢` : ""}`, delta: e.payout ?? 0 }
        : { detail: `Shipment ${e.shipment ?? ""} — ${e.crates ?? 0} crate(s)`, delta: 0 };
    case "DEPOT_ATM":
      return { detail: e.direction === "WITHDRAW" ? "Withdrawn as coin" : "Deposited", delta: e.direction === "WITHDRAW" ? -(e.amount ?? 0) : (e.amount ?? 0) };
    case "DEPOT_CREDIT":
      return { detail: e.direction === "DRAW" ? "Drawn on the line" : "Repaid the line", delta: e.direction === "DRAW" ? (e.amount ?? 0) : -(e.amount ?? 0) };
    case "DEPOT_CRATE_OPEN":
      return { detail: `${e.crateName ?? "A crate"} — ${(e.granted ?? []).map((g) => `${g.name} ×${g.quantity}`).join(", ") || "empty"}`, delta: 0 };
    case "DEPOT_REFUEL":
      return { detail: `${e.tagName ?? "Fuel"} ×${e.quantity ?? 0} into the generator`, delta: 0 };
    default:
      return { detail: e.tagName ? `${e.tagName} ×${e.quantity ?? 1}` : "", delta: 0 };
  }
}

export default async function DepotPage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      resources: true,
      location: { select: { slug: true } },
      tags: {
        select: {
          quantity: true,
          tagId: true,
          tag: { select: { slug: true, forcedName: true, name: true } },
        },
      },
    },
  });

  const heldSlugs = new Set((character?.tags ?? []).map((ct) => ct.tag.slug));
  const licensed = heldSlugs.has(MERCHANT_LICENSE_SLUG);
  const keycard = heldSlugs.has(DEPOT_KEYCARD_SLUG);
  const superadmin = isSuperadmin(session.discordUserId);

  if (!licensed && !keycard && !superadmin) redirect("/character");

  const depot = await loadDepot(prisma);
  const openTurn = await getOpenTurn();

  const [wareTags, pricedTags, pad, obolTag, ledgerRows] = await Promise.all([
    prisma.tag.findMany({ where: { depotPrice: { not: null } }, ...TAG_SELECT }),
    // The reference book: anything with a price in either direction.
    prisma.tag.findMany({
      where: { OR: [{ depotPrice: { not: null } }, { sellable: true, sellablePrice: { not: null } }] },
      ...TAG_SELECT,
    }),
    prisma.room.findUnique({
      where: { slug: LANDING_PAD_SLUG },
      include: { tags: { include: { tag: TAG_SELECT } } },
    }),
    prisma.tag.findUnique({ where: { slug: OBOL_SLUG }, select: { id: true } }),
    prisma.request.findMany({
      where: { type: { in: DEPOT_REQUEST_TYPES } },
      orderBy: { createdAt: "desc" },
      take: LEDGER_LIMIT,
      select: {
        id: true,
        type: true,
        effect: true,
        createdAt: true,
        turn: { select: { number: true } },
        character: { select: { name: true } },
      },
    }),
  ]);

  const heldByTagId = new Map((character?.tags ?? []).map((ct) => [ct.tagId, ct.quantity]));

  const shape = (tag) => ({
    id: tag.id,
    name: tag.name,
    description: tag.description ?? "",
    groupName: tag.group?.name ?? "",
    price: tag.depotPrice,
    sellPrice: tag.sellablePrice,
    // What the station makes on the round trip, from his side of the counter.
    margin: tag.depotPrice != null && tag.sellablePrice != null ? tag.sellablePrice - tag.depotPrice : null,
    held: heldByTagId.get(tag.id) ?? 0,
    stackable: tag.stackable,
    sealed: Boolean(tag.sealedShipping),
    tag,
  });

  const wares = wareTags.map(shape);
  const priceList = pricedTags.map((tag) => ({
    ...shape(tag),
    side: tag.depotPrice != null && tag.sellablePrice != null ? "Both" : tag.depotPrice != null ? "Sells to you" : "Buys from you",
  }));

  // Crates the reader is carrying, with their manifest already printed on the
  // description. `canOpen` is advisory — the action re-checks the keycard.
  const crates = (character?.tags ?? []).length
    ? (
        await prisma.tag.findMany({
          where: {
            custom: true,
            crateContents: { not: null },
            id: { in: [...heldByTagId.keys()] },
          },
        })
      ).map((tag) => ({
        id: tag.id,
        name: tag.name,
        description: tag.description ?? "",
        sealed: tag.sealedShipping,
        canOpen: canOpenCrate(tag, heldSlugs),
      }))
    : [];

  const fuelSources = [
    { slug: COAL_SLUG, name: "Coal", perUnit: depot.coalFuel },
    { slug: SALTPETER_SLUG, name: "Saltpeter", perUnit: depot.saltpeterFuel },
  ];
  const bySlug = new Map((character?.tags ?? []).map((ct) => [ct.tag.slug, ct.quantity]));

  const greeting = character
    ? presentedIdentity(character, { forcedName: forcedNameFrom(character.tags) }).name
    : null;

  const atDepot = character?.location?.slug === DEPOT_LOCATION_SLUG;
  const powered = depotPowered(depot);
  // Read-only unless you hold the licence. Everything below is a hint anyway —
  // the actions re-check all of it.
  const readOnly = !licensed;

  return (
    <PageShell width="wide">
      <PageHeader
        title="The Depot"
        subtitle="A hangar door in the roof of the caves and an automated shuttle that comes through it. Everything imported into Ravenheart lands here, and leaves here as somebody's problem. ‡"
      />
      <DepotConsole
        depot={{
          accountObols: depot.accountObols,
          debtObols: depot.debtObols,
          creditCapObols: depot.creditCapObols,
          generatorOn: depot.generatorOn,
          generatorFuel: depot.generatorFuel,
          fuelMax: depot.fuelMax,
          fuelBurnPerTurn: depot.fuelBurnPerTurn,
          turretArmed: depot.turretArmed,
          merchantFace: depot.merchantFace,
          shuttleState: depot.shuttleState,
          shuttleTurn: depot.shuttleTurn,
          shuttleMaxTurns: depot.shuttleMaxTurns,
        }}
        greetingName={greeting}
        turnNumber={openTurn?.number ?? null}
        fuelTurnsLeft={fuelTurnsLeft(depot)}
        readOnly={readOnly}
        atDepot={Boolean(atDepot)}
        powered={powered}
        // One flag for "you may press things": licensed, standing there, and
        // the lights on. The Station tab overrides it for the power switch,
        // which has to work in the dark.
        disabled={readOnly || !atDepot || !powered}
        poweredDisabled={readOnly || !atDepot}
        wares={wares}
        priceList={priceList}
        manifest={Array.isArray(depot.manifest) ? depot.manifest : []}
        pad={{
          resources: pad?.resources ?? 0,
          rows: (pad?.tags ?? []).map((rt) => ({
            id: rt.id,
            quantity: rt.quantity,
            sellPrice: rt.tag.sellablePrice,
            tag: rt.tag,
          })),
        }}
        crates={crates}
        heldObols={obolTag ? (heldByTagId.get(obolTag.id) ?? 0) : 0}
        resources={character?.resources ?? 0}
        creditAvailable={creditAvailableObols(depot)}
        fuel={{
          turnsLeft: fuelTurnsLeft(depot),
          sources: fuelSources.map((s) => ({ ...s, held: bySlug.get(s.slug) ?? 0 })),
        }}
        ledger={ledgerRows.map((r) => {
          const who = r.character?.name ?? "—";
          const { detail, delta } = ledgerRow(r, who);
          return {
            id: r.id,
            label: REQUEST_TYPE_LABELS[r.type] ?? r.type,
            detail,
            who,
            delta,
            turn: r.turn?.number ?? null,
            at: r.createdAt.getTime(),
          };
        })}
      />
    </PageShell>
  );
}
