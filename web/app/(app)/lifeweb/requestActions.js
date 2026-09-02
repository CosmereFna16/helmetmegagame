"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import {
  prisma,
  MORTUS_SLUG,
  DRAINED_SLUG,
  FORTRESS_SLUG,
  bloodValueForTags,
  bumpBlood,
  FEED_PERSON_AMOUNT,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { createRequest, logRequest, requireReason } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { killCharacter } from "@/lib/discordGuild";

// The Lifeweb's two player-facing Requests, following the same contract as
// the ones on the character sheet (web/app/(app)/character/requestActions.js):
// authenticate, re-validate everything the client sent, then apply the effect
// and write the Request + AuditLog rows in ONE transaction.
//
// Both snapshot `bloodDelta` — what actually moved after the 0-100 clamp —
// rather than the amount asked for, because that is the only number an Undo
// can safely reverse. See docs/systemdocs/REQUESTS.md §2.

// The /lifeweb page gate is advisory: a server action is a public endpoint,
// so Mortus is checked again here. A GM without a living Mortus character
// can't submit these — the GM panel on the same page is their route.
//
// Standing in the Fortress is the second half of the gate. The tower is up the
// Keep stairs (docs/zones.yaml, the Gatehouse topic), so tending the Web is
// something you do with your boots on that ground — the same reach rule every
// other person-touching Request already applies (MAP.md §3).
async function requireMortusCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } }, zone: { select: { slug: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  if (!character.tags.some((ct) => ct.tag.slug === MORTUS_SLUG)) {
    throw new UserError("Only the Mortii may touch the Lifeweb.");
  }
  if (character.zone?.slug !== FORTRESS_SLUG) {
    throw new UserError("The Lifeweb is in the Fortress. You have to be standing there.");
  }
  return { session, character };
}

// The target has to be at the tower too — folded into the WHERE clause rather
// than checked after, the same shape the character-sheet Requests use.
async function requireLivingTarget(targetCharacterId) {
  const target = await prisma.character.findFirst({
    // `?? ""` is load-bearing: Prisma strips an undefined field from a where
    // clause rather than matching nothing, so an omitted id turned "bleed this
    // person" into "bleed any living character". These two buttons act on
    // somebody else's sheet, which makes it the worst place in the app for
    // that.
    where: { id: targetCharacterId ?? "", status: "ALIVE", zone: { slug: FORTRESS_SLUG } },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) throw new UserError("They aren't in the Fortress.");
  return target;
}

function revalidateAll() {
  revalidatePath("/lifeweb");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

// Bleeding someone: the pool gains, and they carry Drained until it expires
// on its own via the turn sweep. Self-targeting is allowed — donating your
// own blood is the obvious reading of the button.
async function donateBloodRequestImpl({ targetCharacterId, reason: rawReason }) {
  const { session, character } = await requireMortusCharacter();
  const reason = requireReason(rawReason);
  const target = await requireLivingTarget(targetCharacterId);

  if (target.tags.some((ct) => ct.tag.slug === DRAINED_SLUG)) {
    throw new UserError(`${target.name} is already Drained.`);
  }

  const [openTurn, drainedTag] = await Promise.all([
    getOpenTurn(),
    prisma.tag.findUnique({ where: { slug: DRAINED_SLUG } }),
  ]);
  if (!drainedTag) throw new UserError("The Drained tag is missing — run npm run db:sync-tags.");

  const { amount, tier } = bloodValueForTags(target.tags);
  const expiresTurn = await expiryForGrant(prisma, drainedTag, openTurn, {
    characterId: target.id,
    where: "donateBloodRequest",
  });

  // `blood` is now produced INSIDE the transaction rather than from a read
  // taken before it. The snapshot written to Request.effect below is what Undo
  // reverses (REQUESTS.md §2), so it has to describe the move this statement
  // actually made — not one computed from a pool value another donation has
  // already changed.
  let blood;
  await prisma.$transaction(async (tx) => {
    blood = await bumpBlood(tx, amount);
    await tx.characterTag.create({
      data: { characterId: target.id, tagId: drainedTag.id, source: "EVENT", expiresTurn },
    });

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tier,
      nominalAmount: amount,
      bloodBefore: blood.before,
      bloodAfter: blood.after,
      bloodDelta: blood.delta,
      drainedTagId: drainedTag.id,
      expiresTurn,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "DONATE_BLOOD",
      reason,
      payload: { targetCharacterId: target.id },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_donate_blood",
      targetCharacterId: target.id,
      reason,
      details: effect,
    });
  });

  // Self-donation is the ordinary case (see the comment above), and it needs
  // no DM — a player already knows what they just clicked.
  if (target.id !== character.id) notifyCharacter(target, "You've been Drained.");

  revalidateAll();
  return { targetName: target.name, amount: blood.delta, tier };
}

// Feeding someone to the Lifeweb kills them, here, on the click.
//
// It used to stop short — the pool went up, `effect.killed` stayed false, and
// a GM finished it from the Requests tab — on the argument that a player must
// not end another player's game from a dropdown. What that bought in practice
// was a character who had already been fed to the Tower walking around until
// a GM got to the queue, and a game state nobody could read. The gates are
// what protect a player, and they are all still here and all still checked
// server-side: the actor must be a living Mortus, standing in the Fortress,
// the target must be alive and in the Fortress too, and a reason is required
// and logged. A GM reads it afterwards rather than before.
//
// The kill is claimed INSIDE the transaction that moves the blood, with the
// same conditional `status: ALIVE` where-clause every other death path uses
// (db/lib/characterDeath.js), so two Mortii feeding the same person in the
// same second can't both claim it. The Discord half runs after the commit —
// killCharacter() is a string of REST calls and must never hold the
// transaction open.
//
// Undo still does not revive. That is unchanged and deliberate (REQUESTS.md
// §2): undoing the request draws the blood back out and says so.
async function feedPersonRequestImpl({ targetCharacterId, reason: rawReason }) {
  const { session, character } = await requireMortusCharacter();
  const reason = requireReason(rawReason);
  const target = await requireLivingTarget(targetCharacterId);

  const openTurn = await getOpenTurn();

  let blood;
  let killed = false;
  await prisma.$transaction(async (tx) => {
    blood = await bumpBlood(tx, FEED_PERSON_AMOUNT);

    // The claim. `count` is 0 when someone else got there first, in which case
    // the blood still lands — the Tower was fed either way — but this request
    // doesn't claim a kill it didn't make, and the teardown below is skipped.
    const claim = await tx.character.updateMany({
      where: { id: target.id, status: "ALIVE" },
      data: { status: "DEAD" },
    });
    killed = claim.count > 0;

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      nominalAmount: FEED_PERSON_AMOUNT,
      bloodBefore: blood.before,
      bloodAfter: blood.after,
      bloodDelta: blood.delta,
      killed,
      killedAt: killed ? new Date().toISOString() : null,
    };
    await createRequest(tx, {
      characterId: character.id,
      turnId: openTurn?.id ?? null,
      type: "FEED_PERSON",
      reason,
      payload: { targetCharacterId: target.id },
      effect,
    });
    await logRequest(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_feed_person",
      targetCharacterId: target.id,
      reason,
      details: effect,
    });
  });

  // The rest of death — access revoke, role delete, nickname clear, the Cursed
  // grant, the death DM — outside the transaction, with the row's status
  // already written. killCharacter's own applyDeathToRow call runs with
  // expectStatus DEAD, which is exactly the shape of the claim above. Not
  // awaited-and-thrown: the feeding is committed, and a Discord hiccup must
  // not report it as failed.
  if (killed) {
    await killCharacter(target, "You were fed to the Lifeweb.").catch((err) =>
      console.error(`killCharacter failed after feeding ${target.id}:`, err),
    );
  }

  revalidateAll();
  return { targetName: target.name, amount: blood.delta, killed };
}

// Validation comes back as { ok: false, error } rather than thrown — a
// production Next.js build redacts anything thrown out of a Server Action.
// See web/lib/actionResult.js.

export async function donateBloodRequest(input) {
  return guarded(() => donateBloodRequestImpl(input));
}

export async function feedPersonRequest(input) {
  return guarded(() => feedPersonRequestImpl(input));
}
