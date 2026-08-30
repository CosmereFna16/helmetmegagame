// Moves ⬢ between two parties (see db/lib/parties.js) atomically, and never
// mints or burns a balance from nowhere. Promoted out of
// web/lib/requestEffects.js so the turn-end push (CommonJS, runs inside the
// bot's turn engine) and every GM transfer surface share the exact primitive
// the player-facing TRANSFER_RESOURCES request already used.
//
// The check and the subtraction used to be separate statements with a whole
// server action between them: read the balance, compare, and some lines later
// decrement. Prisma runs READ COMMITTED, so two requests firing at the same
// moment — two tabs, a double-click, a flaky connection retrying — both read
// the same balance, both passed, and both subtracted. Ten ⬢ sent twice left
// the sender at −10 and the recipient up 20, and it worked on faction silos
// too.
//
// So the write IS the check: a conditional updateMany that matches only while
// the balance still covers the amount, and a count of 0 means it didn't. Every
// caller runs inside a $transaction, so the throw rolls back everything else
// in it along with it.
class InsufficientResourcesError extends Error {
  constructor(party, amount) {
    super(`${party?.name ?? "That party"} no longer has ${amount} ⬢.`);
    this.party = party;
    this.amount = amount;
  }
}

async function moveParty(tx, party, delta) {
  if (!party || !delta) return;
  const character = party.kind === "character";
  if (!character && party.kind !== "faction") return;

  const model = character ? tx.character : tx.faction;
  const field = character ? "resources" : "silo";

  if (delta > 0) {
    await model.update({ where: { id: party.id }, data: { [field]: { increment: delta } } });
    return;
  }

  const amount = -delta;
  const { count } = await model.updateMany({
    where: { id: party.id, [field]: { gte: amount } },
    data: { [field]: { decrement: amount } },
  });
  if (count) return;

  throw new InsufficientResourcesError(party, amount);
}

// Moves `amount` from `from` to `to`, writing a SiloTransaction row for each
// end that's a faction. `ledger` carries the actor/turn/note fields every
// SiloTransaction row needs (actorDiscordUserId, actorCharacterId?,
// actorName, turnNumber?, turnPhase?, note?).
//
// Legs are sorted by (kind, id), not by which side is the sender. Two
// simultaneous transfers between the same pair in opposite directions used to
// take their row locks in opposite orders — A then B for one, B then A for
// the other — which is a textbook Postgres deadlock. A total order over the
// participants means both transactions queue instead.
async function applyTransfer(tx, { from, to, amount, ledger }) {
  const legs = [
    [from, -amount],
    [to, amount],
  ].sort(([a], [b]) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

  for (const [party, delta] of legs) {
    await moveParty(tx, party, delta);
    if (party.kind === "faction") {
      await tx.siloTransaction.create({
        data: {
          factionId: party.id,
          amount: delta,
          toCharacterId: to.kind === "character" ? to.id : null,
          toName: to.name,
          ...ledger,
        },
      });
    }
  }
}

module.exports = { moveParty, applyTransfer, InsufficientResourcesError };
