"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { STOWABLE_SLUGS, WATER_TRAVEL_SLUGS, BOAT_CONFLICT_SLUGS } from "@lifeweb/db/lib/mounts";
import { describeSlotClash, findSlotClash } from "@lifeweb/db/lib/equipSlots";
import { INCAPACITATING_SLUGS } from "@lifeweb/db/lib/incapacitation";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { auth } from "@/lib/auth";

// Equipping is instant and writes no Request and no AuditLog. That is
// deliberate: it costs nothing, the player can undo it themselves in one tap,
// and at 100+ players a row per toggle would drown /gm/audit and the Requests
// tab in noise. Contrast TRANSFER_RESOURCES, which moves something real and so
// has to be reviewable — see docs/systemdocs/REQUESTS.md.
export async function toggleEquip(characterTagId) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // The character comes from the session, never from the client: a server
  // action is a public endpoint, so an id posted directly would otherwise let
  // anyone equip things on someone else's sheet.
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      location: { select: { indoors: true, name: true } },
      // `equipped` and the tag NAME are both read by the boat/mount clash
      // below, which has to name the thing already out loud.
      tags: { select: { equipped: true, tag: { select: { slug: true, name: true } } } },
    },
  });
  if (!character) return { error: "No living character." };

  // Bound, Dying, Paralyzed, Catatonic, mid-Seizure — no hands to do this
  // with. Both directions, which is the point: a hostage who could take the
  // sack off their own head would not be much of a hostage.
  if (character.tags.some((ct) => INCAPACITATING_SLUGS.has(ct.tag.slug))) {
    return { error: "You can't work your hands right now. ‡" };
  }

  const held = await prisma.characterTag.findFirst({
    where: { id: characterTagId ?? "", characterId: character.id },
    select: { id: true, equipped: true, tag: { select: { equippable: true, name: true, slug: true } } },
  });
  if (!held) return { error: "You aren't holding that." };
  if (!held.tag.equippable) return { error: `${held.tag.name} isn't something you can equip.` };

  // A cart does not come into a chapel (docs/systemdocs/CARRY.md §3). Arriving
  // already unequipped it; this stops it going straight back on. This one gates
  // the equip direction only — taking the cart off at the door is the whole
  // point of it. The incapacitation check above is the gate that runs both
  // ways.
  if (!held.equipped && STOWABLE_SLUGS.has(held.tag.slug) && character.location?.indoors) {
    return { error: `You can't set up ${held.tag.name} inside ${character.location.name}. ‡` };
  }

  // You are either riding or poling. The boat and the road kit compete for the
  // same free crossing, and having both out would stack two of them, so each
  // refuses while the other is equipped. Checked in both directions — the
  // player may reach this from either tag.
  if (!held.equipped) {
    const conflicting = WATER_TRAVEL_SLUGS.has(held.tag.slug)
      ? BOAT_CONFLICT_SLUGS
      : BOAT_CONFLICT_SLUGS.has(held.tag.slug)
        ? WATER_TRAVEL_SLUGS
        : null;
    if (conflicting) {
      const other = character.tags.find((ct) => ct.equipped && conflicting.has(ct.tag.slug));
      if (other) {
        return {
          error: `Put ${other.tag.name} away first — you can't have that and ${held.tag.name} out at once. ‡`,
        };
      }
    }
  }

  if (held.equipped) {
    await prisma.characterTag.update({ where: { id: held.id }, data: { equipped: false } });
    // Unequipping a Cart shrinks the carry cap, so the sheet has to be settled
    // against it — Overburdened goes on. Nothing is dropped for a shrink
    // (CARRY.md §1), so putting the cart down at an inn door is safe.
    await afterInventoryChange([character.id]);
    revalidatePath("/character");
    return { equipped: false };
  }

  // Counting inside the transaction is NOT enough on its own: Prisma runs at
  // READ COMMITTED, so two tabs (or one impatient double-tap) both read the
  // same count, both see a free slot, and both write — which is exactly what
  // happens without the lock below. Taking a row lock on the Character first
  // serializes every equip for this one character, so the second attempt reads
  // the first's committed count. Contention is per-character, i.e. only ever
  // between one player's own clients.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${character.id} FOR UPDATE`;
      const config = await tx.gameConfig.findUnique({ where: { id: 1 }, select: { equipSlots: true } });
      const slots = config?.equipSlots ?? 6;
      const inUse = await tx.characterTag.count({ where: { characterId: character.id, equipped: true } });
      if (inUse >= slots) throw new Error("NO_SLOTS");
      await tx.characterTag.update({ where: { id: held.id }, data: { equipped: true } });

      // Written first, then checked, so this asks the same question the GM
      // batch path asks: "is the resulting set wearable?". Inside the same
      // transaction and behind the same row lock as the slot count, so a
      // double-tap cannot slip a second helmet past it; the throw rolls the
      // write back.
      const worn = await tx.characterTag.findMany({
        where: { characterId: character.id, equipped: true },
        select: { tag: { select: { name: true, equipSlot: true, equipLayer: true } } },
      });
      const clash = findSlotClash(worn);
      if (clash) throw new Error(`CLASH:${describeSlotClash(clash)}`);
    });
  } catch (err) {
    if (err.message === "NO_SLOTS") return { error: "You have no free equipment slots." };
    if (err.message?.startsWith("CLASH:")) return { error: err.message.slice("CLASH:".length) };
    throw err;
  }

  // Equipping a Cart raises the cap, which can clear Overburdened.
  await afterInventoryChange([character.id]);
  revalidatePath("/character");
  return { equipped: true };
}
