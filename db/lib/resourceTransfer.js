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

// The one place that knows the shape of a SiloTransaction row. `ledger`
// carries the actor/turn/note fields every row needs, plus two optional
// fields for a quiet GM adjustment: `hidden: true` writes the real row as
// GM-only (never shown on /faction); `cover: { actorName, toName?, note? }`
// additionally writes a display-only COVER row with the same signed amount,
// so the Leader/Treasurer's visible total still sums correctly. `cover` is
// ignored unless `hidden` is set.
async function writeSiloRows(tx, { factionId, amount, toCharacterId = null, toName = null, ledger }) {
  const { hidden = false, cover = null, ...base } = ledger ?? {};

  const real = await tx.siloTransaction.create({
    data: {
      factionId,
      amount,
      toCharacterId,
      toName,
      ...base,
      visibility: hidden ? "HIDDEN" : "OPEN",
    },
  });

  if (!hidden || !cover) return real;

  await tx.siloTransaction.create({
    data: {
      factionId,
      amount,
      toCharacterId: null,
      toName: cover.toName || null,
      actorDiscordUserId: base.actorDiscordUserId,
      actorCharacterId: null,
      actorName: cover.actorName,
      note: cover.note || null,
      turnNumber: base.turnNumber ?? null,
      turnPhase: base.turnPhase ?? null,
      visibility: "COVER",
      coverForId: real.id,
    },
  });

  return real;
}

// Moves `amount` from `from` to `to`, writing Silo rows for each end that's a
// faction. Legs are sorted by (kind, id), not by sender, so a total order
// over participants avoids a lock-order deadlock between concurrent transfers.
async function applyTransfer(tx, { from, to, amount, ledger }) {
  const legs = [
    [from, -amount],
    [to, amount],
  ].sort(([a], [b]) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));

  for (const [party, delta] of legs) {
    await moveParty(tx, party, delta);
    if (party.kind === "faction") {
      await writeSiloRows(tx, {
        factionId: party.id,
        amount: delta,
        toCharacterId: to.kind === "character" ? to.id : null,
        toName: to.name,
        ledger,
      });
    }
  }
}

module.exports = { moveParty, applyTransfer, writeSiloRows, InsufficientResourcesError };
