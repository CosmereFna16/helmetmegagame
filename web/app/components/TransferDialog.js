"use client";

import PartySelect from "./PartySelect";
import CheckField from "./CheckField";
import QuantityField from "./QuantityField";

// The body of the one Transfer dialog (docs/systemdocs/CARRY.md): a source, a
// destination, the tags that can leave the source, and a ⬢ amount. State
// lives in RequestActionsProvider like every other mode — this component is
// the form, not the owner.
//
// The source is YOU or a Room here — never another person. You can't reach
// into someone's pockets, and listing what's in them would show their hidden
// tags; Loot is how you take from a (helpless) person. The destination is
// anyone standing here and unconcealed, or a Room here
// (web/lib/peopleHere.js); the server re-checks the same predicate.
//
// `rooms` carries each stash's contents, so pulling out of a Room shows
// what's there; `carry` is this character's load and caps for the projection
// line, which warns but never blocks (going over just makes you Overburdened).

function stackLabel(name, quantity) {
  return quantity > 1 ? `${name} ×${quantity}` : name;
}

export default function TransferDialog({
  selfId,
  parties,
  silo = null,
  transferable,
  carry,
  fromKey,
  toKey,
  onFrom,
  onTo,
  picks,
  onTogglePick,
  onPickQuantity,
  amount,
  onAmount,
}) {
  const selfKey = selfId ? `character:${selfId}` : "";
  const rooms = parties?.rooms ?? [];
  const people = parties?.characters ?? [];
  const self = people.filter((c) => c.id === selfId);
  const others = people.filter((c) => c.id !== selfId);
  const fromRoom = fromKey.startsWith("room:") ? rooms.find((r) => `room:${r.id}` === fromKey) : null;
  const toRoom = toKey.startsWith("room:") ? rooms.find((r) => `room:${r.id}` === toKey) : null;
  // The silo when it is the destination: either the elsewhere-in-zone entry
  // PartySelect adds, or the ordinary room entry when you happen to be
  // standing in it.
  const toSilo = silo && toKey === `room:${silo.id}` ? silo : null;
  const toIsCharacter = toKey.startsWith("character:");

  // What the source has on offer. From yourself: every tradeable tag you
  // hold. From a room: its stash. Anything else: nothing.
  const offered =
    fromKey === selfKey
      ? transferable.map((t) => ({
          tagId: t.id,
          name: t.name,
          quantity: t.quantity,
          stackable: t.stackable,
          // Assets weigh nothing on your back (CARRY.md §1), so the
          // projection must not charge you for handing one over either.
          weightLbs: t.category === "Assets" ? 0 : (t.weightLbs ?? 0),
        }))
      : (fromRoom?.tags ?? []);
  const canOfferTags = fromKey === selfKey || Boolean(fromRoom);
  const balance =
    fromKey === selfKey
      ? carry?.resources
      : fromRoom
        ? fromRoom.resources
        : null;
  const sameParty = fromKey && fromKey === toKey;

  // Projection: what YOUR load looks like after this moves. Only meaningful
  // when one end is you.
  const picked = offered.filter((t) => t.tagId in picks);
  const lbs = picked.reduce((n, t) => n + (t.weightLbs ?? 0) * (Number(picks[t.tagId]) || 1), 0);
  const moved = Number(amount) || 0;
  const round = (n) => Math.round(n * 100) / 100;
  let projected = null;
  if (carry && fromKey === selfKey) {
    projected = { weight: round(carry.weightUsed - lbs), resources: carry.resources - moved };
  } else if (carry && toKey === selfKey) {
    projected = { weight: round(carry.weightUsed + lbs), resources: carry.resources + moved };
  }
  const overAfter = projected && (projected.weight > carry.weightCap || projected.resources > carry.resourcesCap);
  // Past the ceiling the server refuses outright, so say so rather than
  // letting them submit into an error (CARRY.md §1).
  const refusedAfter =
    projected && (projected.weight > carry.weightHardCap || projected.resources > carry.resourcesHardCap);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PartySelect
          label="From ‡"
          value={fromKey}
          onChange={onFrom}
          hint="Choose a source… ‡"
          characters={self}
          rooms={rooms}
          selfId={selfId}
        />
        <PartySelect
          label="To ‡"
          value={toKey}
          onChange={onTo}
          hint="Choose a destination… ‡"
          characters={others}
          rooms={rooms}
          silo={silo && (!silo.here || !silo.canOpen) ? silo : null}
        />
      </div>
      {sameParty && <p className="text-xs text-accent">Source and recipient are the same.</p>}

      <div className="panel flex flex-col gap-3 p-3">
        <label className="field" style={{ width: "10rem" }}>
          <span className="field-label">Resources{balance != null ? ` (of ${balance})` : ""} ‡</span>
          <input
            type="number"
            min="0"
            max={balance ?? undefined}
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
          />
        </label>

        {canOfferTags &&
          (offered.length === 0 ? (
            <p className="text-xs text-muted">
              {fromRoom ? "Nothing is stored here. ‡" : "You're carrying nothing you could hand over. ‡"}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="field-label">{fromRoom ? "Take ‡" : "Hand over ‡"}</span>
              {offered.map((t) => {
                const checked = t.tagId in picks;
                // A non-stackable tag pins at one per character, so a pull out
                // of a room to a person is one at a time.
                const max = t.stackable || !toIsCharacter ? t.quantity : 1;
                return (
                  <div key={t.tagId} className="flex flex-wrap items-center gap-3">
                    <CheckField checked={checked} onChange={() => onTogglePick(t.tagId, t.quantity)}>
                      {stackLabel(t.name, t.quantity)}
                    </CheckField>
                    {checked && max > 1 && (
                      <QuantityField
                        label="How many? ‡"
                        max={max}
                        value={picks[t.tagId]}
                        onChange={(v) => onPickQuantity(t.tagId, v)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      {projected && (
        <p className={`text-xs ${overAfter || refusedAfter ? "text-accent" : "text-muted"}`}>
          After this you carry {projected.weight} / {carry.weightCap} lb and {projected.resources} /{" "}
          {carry.resourcesCap} ⬢.
          {refusedAfter
            ? " That's more than you could hold even overburdened, so it won't go through."
            : overAfter
              ? " That's more than you can manage — you'll be Overburdened until you set some down."
              : ""}{" "}
          ‡
        </p>
      )}
      <p className="text-xs text-muted">
        {toSilo && !toSilo.canOpen
          ? `${toSilo.name} is locked to you. This will go in, and you will not be able to take it back out. ‡`
          : toSilo
            ? "Anyone in the faction who can get into the silo can take what you leave there. ‡"
            : toRoom
              ? "Anyone who can get into that room can take what you leave there. ‡"
              : "Only people standing where you are, with their face showing, are listed. ‡"}
      </p>
    </>
  );
}
