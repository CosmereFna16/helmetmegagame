// Moves ⬢ between two parties (see db/lib/parties.js) atomically, never
// minting or burning a balance from nowhere. Shared by the turn-end push and
// every GM transfer surface.
//
// Prisma runs READ COMMITTED, so the balance check must be the write itself
// (a conditional updateMany matching only while the balance still covers the
// amount), not a separate read-then-decrement, or two concurrent requests can
// both pass and both subtract. Every caller runs inside a $transaction.
class InsufficientResourcesError extends Error {
  constructor(party, amount) {
    super(`${party?.name ?? "That party"} no longer has ${amount} ⬢.`);
    this.party = party;
    this.amount = amount;
  }
}

// Which model and column hold each party kind's balance. A table rather
// than a branch so applyTransfer's (kind, id) lock ordering keeps working
// unchanged as kinds are added. (A faction Silo was the second kind until
// 9/2026 — old TRANSFER_RESOURCES rows may still name one; moveParty ignores
// a kind it doesn't know, so their Undo is a no-op on that end.)
const BALANCE = {
  character: ["character", "resources"],
  room: ["room", "resources"],
};

async function moveParty(tx, party, delta) {
  if (!party || !delta) return;
  const spec = BALANCE[party.kind];
  if (!spec) return;

  // A room that eats what is put into it (Room.destroysContents — the Godard
  // Factory's Spillway). Money going IN goes nowhere; money coming OUT is
  // still allowed, because Undo has to be able to take back what it drained
  // from the sender and nothing was ever added here to overdraw.
  if (party.destroysContents && delta > 0) return;

  const [modelName, field] = spec;
  const model = tx[modelName];

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

// Moves `amount` from `from` to `to`. Legs are sorted by (kind, id), not by
// sender, so a total order over participants avoids a lock-order deadlock
// between concurrent transfers. `ledger` is accepted and ignored: it fed the
// Silo rows, and callers still pass it.
async function applyTransfer(tx, { from, to, amount }) {
  const legs = [
    [from, -amount],
    [to, amount],
  ].sort(([a], [b]) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

  for (const [party, delta] of legs) {
    await moveParty(tx, party, delta);
  }
}

module.exports = { moveParty, applyTransfer, InsufficientResourcesError };
