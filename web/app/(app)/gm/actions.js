"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { prisma } from "@lifeweb/db";
import { getGmSession, syncCharacterNarrowcastAccess } from "@/lib/discordGuild";
import { syncCharacterRoomAccess } from "@lifeweb/db/lib/roomAccess";
import { UserError, guarded } from "@/lib/actionResult";
import { addToStack, dropCharacterTag, grantTagSlugs } from "@/lib/requestEffects";
import { rollTagChain } from "@lifeweb/db/lib/tagShapes";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";

// The GM broadcast used to live here (sendGmMessage/deliverGmMessage). It's
// now web/app/(app)/gm/messages/actions.js#sendGmBroadcast, consolidated
// alongside the rest of the messaging surface so there is one delivery path
// (and one last-broadcast audit trail) instead of two.

// ── bulk tagging from /gm/players ──────────────────────────────────────────

// Grants or revokes one tag across every selected character.
//
// ONE TRANSACTION PER CHARACTER, never one across the whole batch. A
// hundred-character transaction would hold a row lock against each of those
// players' own equip toggles for its entire duration, and one bad character
// would roll back ninety-nine good ones. Sequential, partial success
// reported, one audit row for the batch.
export async function bulkTagCharacters({ characterIds, tagId, mode }) {
  return guarded(async () => {
    const { session, isGm: gm } = await getGmSession();
    if (!session?.discordUserId || !gm) throw new UserError("Not authorized.");

    const ids = [...new Set(characterIds ?? [])];
    if (!ids.length) throw new UserError("Select at least one character.");
    if (ids.length > 200) throw new UserError("That's more than 200 characters at once.");

    const tag = await prisma.tag.findUnique({ where: { id: tagId } });
    if (!tag) throw new UserError("That tag no longer exists.");

    const openTurn = await prisma.turn.findFirst({
      where: { status: "OPEN" },
      select: { number: true },
    });

    // Resolved ONCE, above the loop. The tag and the turn are the same for
    // every character, and the try/catch below is inside the loop and swallows
    // into a bare `failed[]` count — so resolving per character would turn one
    // shared problem into 200 unexplained failures. See db/lib/grantExpiry.js
    // for why this is not just expiryFor.
    const grantExpiresTurn =
      mode === "revoke"
        ? null
        : await expiryForGrant(prisma, tag, openTurn, { where: "bulkTagCharacters" });

    const failed = [];
    let applied = 0;
    const aftermathNames = new Set();

    for (const characterId of ids) {
      try {
        await prisma.$transaction(async (tx) => {
          if (mode === "revoke") {
            // The treated-wound aftermath (Tag.removesInto, TAGS.md §5c),
            // rolled PER CHARACTER rather than once for the batch — a oneOf
            // chain resolved once would hand a hundred people the same coin
            // flip. Skipped if they weren't holding it, since the drop below
            // is then a no-op.
            const held = await tx.characterTag.findUnique({
              where: { characterId_tagId: { characterId, tagId } },
            });
            // One unit off a stack, the whole row otherwise — a GM
            // correcting an over-grant shouldn't wipe a player's larder.
            await dropCharacterTag(tx, characterId, tagId, tag.stackable ? 1 : null);
            if (held) {
              const granted = await grantTagSlugs(
                tx,
                characterId,
                rollTagChain(tag.removesInto),
                openTurn?.number ?? null,
              );
              for (const g of granted) aftermathNames.add(g.tagName);
            }
          } else {
            // The stamp is not optional: resolveNeeds()'s sweep matches on
            // expiresTurn, so a timed tag granted with a null there never
            // expires at all. Hoisted above the loop — see the comment there.
            await addToStack(tx, characterId, tagId, 1, {
              source: "GM_GRANT",
              stackable: tag.stackable,
              expiresTurn: grantExpiresTurn,
            });
          }
        });
        applied += 1;
      } catch (err) {
        console.error(`Bulk ${mode} of ${tag.slug} failed for ${characterId}:`, err);
        failed.push(characterId);
      }
    }

    await prisma.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: mode === "revoke" ? "gm_bulk_tag_revoke" : "gm_bulk_tag_grant",
        details: {
          tagId,
          tagName: tag.name,
          characterIds: ids,
          applied,
          failed,
          ...(aftermathNames.size ? { granted: [...aftermathNames] } : {}),
        },
      },
    });

    // A granted or revoked tag may change narrowcast access (#watch,
    // #intercom) and private-room membership — a key tag gained opens a door,
    // a key tag lost shuts it. Sequential and after the writes, per
    // ARCHITECTURE.md §5 — never a fan-out of REST calls at Discord's rate
    // limiter.
    after(() => afterInventoryChange(ids));

    revalidatePath("/gm/players", "layout");
    revalidatePath("/character");
    return { applied, failed: failed.length, tagName: tag.name };
  });
}
