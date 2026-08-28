"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getGmSession, syncCharacterNarrowcastAccess } from "@/lib/discordGuild";
import { UserError, guarded } from "@/lib/actionResult";
import { addToStack, dropCharacterTag } from "@/lib/requestEffects";
import { expiryFor } from "@/lib/turnFormat";

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

    const failed = [];
    let applied = 0;

    for (const characterId of ids) {
      try {
        await prisma.$transaction(async (tx) => {
          if (mode === "revoke") {
            // One unit off a stack, the whole row otherwise — a GM
            // correcting an over-grant shouldn't wipe a player's larder.
            await dropCharacterTag(tx, characterId, tagId, tag.stackable ? 1 : null);
          } else {
            // expiryFor is not optional: resolveNeeds()'s sweep matches on
            // expiresTurn, so a timed tag granted with a null there never
            // expires at all.
            await addToStack(tx, characterId, tagId, 1, {
              source: "GM_GRANT",
              stackable: tag.stackable,
              expiresTurn: expiryFor(tag, openTurn),
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
        details: { tagId, tagName: tag.name, characterIds: ids, applied, failed },
      },
    });

    // A granted or revoked tag may change narrowcast access (#watch,
    // #intercom). Sequential and after the writes, per ARCHITECTURE.md §5 —
    // never a fan-out of REST calls at Discord's rate limiter.
    after(async () => {
      for (const characterId of ids) {
        await syncCharacterNarrowcastAccess(characterId).catch(() => {});
      }
    });

    revalidatePath("/gm/players", "layout");
    revalidatePath("/character");
    return { applied, failed: failed.length, tagName: tag.name };
  });
}
