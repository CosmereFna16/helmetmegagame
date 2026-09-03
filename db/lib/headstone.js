// "{name}'s Headstone" — what Engraving leaves behind.
//
// A stone carved for someone whose body nobody could find. Like a corpse it is
// a system-authored Tag row (`custom: true`, so no sync touches it), but unlike
// a corpse it is NOT a handle to anything: it carries no corpseOfCharacterId,
// because the person it commemorates is memorialised rather than present. It
// is an ordinary keepsake you can carry, hand over, or keep on a shelf.
//
// An UPSERT, not a create, and that is the interesting part: two mourners can
// engrave the same person, and the second must not hit the @unique on slug.
// The second one simply gets a grant of the row the first made — which is also
// the right fiction. There is one stone; more than one person can have helped.
//
// Takes a tx as the first parameter (db/lib/dm.js convention); off the barrel.

function headstoneSlug(name) {
  const base = (name ?? "")
    .toString()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 38);
  return `custom-${base || "unnamed"}-headstone`;
}

async function mintHeadstone(tx, target) {
  const slug = headstoneSlug(target.name);
  const name = `${target.name}'s Headstone`;
  const description = `A headstone commemorating ${target.name}'s life. ‡`;
  const existing = await tx.tag.findUnique({ where: { slug } });
  if (existing) return existing;
  try {
    return await tx.tag.create({
      data: {
        slug,
        name,
        description,
        category: "Items",
        pointCost: 0,
        custom: true,
        // A carved stone is a thing people can see you carrying.
        inspectVisibility: "ALWAYS",
        tradeable: true,
        stackable: false,
        // Binnable, unlike a corpse: throwing away a memorial is a choice a
        // player is allowed to make, and it frees nobody's soul either way.
        removable: true,
        consumable: false,
        purchasable: false,
        purchasableAfterStart: false,
      },
    });
  } catch (err) {
    // Two engravers inside the same instant. The findUnique above missed it,
    // so re-read rather than failing the request.
    if (err?.code === "P2002") {
      const raced = await tx.tag.findUnique({ where: { slug } });
      if (raced) return raced;
    }
    throw err;
  }
}

module.exports = { mintHeadstone, headstoneSlug };
