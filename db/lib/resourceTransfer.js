// Moves ⬢ between two parties (see db/lib/parties.js) atomically, never
// minting or burning a balance from nowhere. Shared by the turn-end push and
// every GM transfer surface, same primitive as TRANSFER_RESOURCES.
//
// Prisma runs READ COMMITTED, so the balance check must be the write itself
// (a conditional updateMany matching only while the balance still covers the
// amount) rather than a separate read-then-decrement, or two concurrent
// requests can both pass and both subtract. Every caller runs inside a
// $transaction, so a throw here rolls back everything else in it.
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

// The ONE place that knows the shape of a SiloTransaction row. `ledger` carries
// the actor/turn/note fields every row needs (actorDiscordUserId,
// actorCharacterId?, actorName, turnNumber?, turnPhase?, note?), plus two
// optional fields for a quiet GM adjustment:
//
//   hidden: true          — the real row is written HIDDEN, so it renders on GM
//                           surfaces only and never on /faction.
//   cover: { actorName, toName?, note? }
//                         — additionally write a display-only COVER row with
//                           the SAME signed amount, which is what the faction's
//                           Leader/Treasurer sees instead. Equal amounts are
//                           what keep their visible column summing to the real
//                           Silo total; only the who and the why are fiction.
//
// A cover with no hidden row would be a straightforward lie about the balance,
// so `cover` is ignored unless `hidden` is set.
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
      // The fiction never names the real counterparty: a blank "Shown to"
      // renders as "-", the same as an ordinary deposit.
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
// faction. See writeSiloRows for what `ledger` carries.
//
// Legs are sorted by (kind, id), not by which side is the sender: a total
// order over the participants keeps two simultaneous transfers between the
// same pair from taking their row locks in opposite orders, which deadlocks.
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
