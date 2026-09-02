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
