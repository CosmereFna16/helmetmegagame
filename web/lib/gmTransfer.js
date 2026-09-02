import { prisma } from "@lifeweb/db";
import { resolveParty, partyLabel } from "@lifeweb/db/lib/parties";
import { applyTransfer, InsufficientResourcesError } from "@lifeweb/db/lib/resourceTransfer";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { UserError } from "@/lib/actionResult";
import { requireReason } from "@/lib/requests";
import { normalizeQuiet } from "@/lib/siloCover";
import { notifyCharacter } from "@/lib/notifyCharacter";

// The immediate GM transfer — moves ⬢ between any two parties (a character
// or a faction Silo) right now, from the Dev Panel and from the FactionsPanel
// Silo control. Any GM, not just a superadmin (the absolute "set the Silo to
// N" field in `/gm/dev/factions` stays superadmin-only as the blunt tool).
// Apply-first like every other Dev Panel verb — no Request row, no one-click
// Undo, the reverse transfer is the reversal — and skips the reach gate
// (web/lib/transferReach.js) a player transfer enforces, but not the balance
// check. `quiet`/`cover*` hide the move from the faction's own
// Leader/Treasurer; the AuditLog row always records the truth AND the cover.
export async function gmTransferResources({
  fromKey,
  toKey,
  amount: rawAmount,
  reason: rawReason,
  quiet = false,
  coverActorName,
  coverToName,
  coverNote,
}) {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId || !gm) throw new UserError("Not authorized.");
  const reason = requireReason(rawReason);

  const amount = Number.parseInt(rawAmount, 10);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("Amount must be a positive whole number.");

  const [from, to] = await Promise.all([resolveParty(prisma, fromKey), resolveParty(prisma, toKey)]);
  if (!from) throw new UserError("Unknown source.");
  if (!to) throw new UserError("Unknown recipient.");
  if (from.kind === to.kind && from.id === to.id) throw new UserError("Source and recipient are the same.");
  if (amount > from.balance) throw new UserError(`${partyLabel(from)} only has ${from.balance} ⬢.`);

  const { hidden, cover } = normalizeQuiet({ quiet, coverActorName, coverToName, coverNote });

  const openTurn = await getOpenTurn();
  const ledger = {
    hidden,
    cover,
    actorDiscordUserId: session.discordUserId,
    actorCharacterId: null,
    // Matches the "GM (Dev Panel)" convention updateFaction already uses for
    // a manual Silo correction — the audit row's actorDiscordUserId is the
    // real per-GM identity; this is just the ledger's plain-language label.
    actorName: "GM (Transfer)",
    turnNumber: openTurn?.number ?? null,
    turnPhase: openTurn?.phase ?? null,
    note: reason,
  };

  await prisma.$transaction(async (tx) => {
    try {
      await applyTransfer(tx, { from, to, amount, ledger });
    } catch (err) {
      if (err instanceof InsufficientResourcesError) throw new UserError(err.message);
      throw err;
    }
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "gm_transfer_resources",
        targetCharacterId: to.kind === "character" ? to.id : from.kind === "character" ? from.id : null,
        reason,
        details: {
          amount,
          from: { kind: from.kind, id: from.id, name: from.name },
          to: { kind: to.kind, id: to.id, name: to.name },
          hidden,
          cover,
        },
      },
    });
  });

  if (from.kind === "character") {
    notifyCharacter({ id: from.id, discordUserId: from.discordUserId }, `${from.name} paid ${amount} ⬢ to ${partyLabel(to)}.`);
  }
  if (to.kind === "character") {
    notifyCharacter({ id: to.id, discordUserId: to.discordUserId }, `${to.name} received ${amount} ⬢ from ${partyLabel(from)}.`);
  }

  return { from: partyLabel(from), to: partyLabel(to), amount };
}
