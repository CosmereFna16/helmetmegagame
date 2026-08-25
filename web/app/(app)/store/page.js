import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { loadPointBuyCatalog } from "@/lib/pointBuyCatalog";
import PageShell, { PageHeader } from "@/app/components/PageShell";
import StoreClient from "./StoreClient";

export const metadata = { title: "Store" };

// The mid-game tag store: the same PointBuy experience as character
// creation, spending Character.tagPoints instead of the starting budget and
// offering only tags still marked purchasableAfterStart. Checkout applies
// instantly and files ONE batched BUY_TAGS request for GM review — the same
// apply-then-review contract as every other request (REQUESTS.md).
export default async function StorePage() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      tagPoints: true,
      tags: { select: { tagId: true } },
    },
  });
  // No character, nothing to spend — the wizard (or the sheet) is the page
  // they actually want.
  if (!character) redirect("/character");

  // Held ids widen the catalog so unpurchasable held tags (a GM-granted
  // Demoness, a crafted item) still reach the client's byId map — chain
  // discounts and hidden-category gates key off them.
  const heldIds = character.tags.map((ct) => ct.tagId);
  const tags = await loadPointBuyCatalog(heldIds);
  const held = new Set(heldIds);
  const heldTags = tags.filter((t) => held.has(t.id)).map((t) => ({ id: t.id, name: t.name }));

  return (
    <PageShell width="wide">
      <PageHeader
        title="Store"
        subtitle="Spend your Tag Points on new tags. Purchases apply immediately; a GM sees each one as a request."
      />
      <StoreClient tags={tags} budget={character.tagPoints} heldTags={heldTags} />
    </PageShell>
  );
}
