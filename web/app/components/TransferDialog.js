"use client";

import PartySelect from "./PartySelect";
import CheckField from "./CheckField";

// The body of the one Transfer dialog (docs/systemdocs/CARRY.md): a source, a
// destination, the tags that can leave the source, and a ⬢ amount. State
// lives in RequestActionsProvider like every other mode — this component is
// the form, not the owner.
//
// Tags are listed only when the source is YOU or a Room. Any other source
// offers ⬢ alone: browsing another player's inventory is the abuse the
// send-only rule prevents (REQUESTS.md §3), and a Silo holds ⬢, not things.
// The party lists are unfiltered on purpose — the server is the gate, and a
// range-filtered menu would be a scouting tool.
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
  const fromRoom = fromKey.startsWith("room:") ? rooms.find((r) => `room:${r.id}` === fromKey) : null;
  const toRoom = toKey.startsWith("room:") ? rooms.find((r) => `room:${r.id}` === toKey) : null;
  const toIsCharacter = toKey.startsWith("character:");

  // What the source has on offer. From yourself: every tradeable tag you
  // hold. From a room: its stash. Anything else: nothing.
  const offered =
    fromKey === selfKey
      ? transferable.map((t) => ({ tagId: t.id, name: t.name, quantity: t.quantity, stackable: t.stackable }))
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
  const units = picked.reduce((n, t) => n + (Number(picks[t.tagId]) || 1), 0);
  const moved = Number(amount) || 0;
  let projected = null;
  if (carry && fromKey === selfKey) {
    projected = { tags: carry.tagsUsed - units, resources: carry.resources - moved };
  } else if (carry && toKey === selfKey) {
    projected = { tags: carry.tagsUsed + units, resources: carry.resources + moved };
  }
  const overAfter = projected && (projected.tags > carry.tagsCap || projected.resources > carry.resourcesCap);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <PartySelect
          label="From ‡"
          value={fromKey}
          onChange={onFrom}
          hint="Choose a source… ‡"
          characters={parties?.characters ?? []}
          factions={parties?.factions ?? []}
          rooms={rooms}
        />
        <PartySelect
          label="To ‡"
          value={toKey}
          onChange={onTo}
          hint="Choose a destination… ‡"
          characters={parties?.characters ?? []}
          factions={parties?.factions ?? []}
          rooms={rooms}
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
                      <label className="field" style={{ width: "7rem" }}>
                        <span className="field-label">How many?</span>
                        <input
                          type="number"
                          min="1"
                          max={max}
                          value={picks[t.tagId]}
                          onChange={(e) => onPickQuantity(t.tagId, e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        {!canOfferTags && fromKey && (
          <p className="text-xs text-muted">
            {toRoom || toIsCharacter
              ? "Only ⬢ can move from there. To hand over a thing, it has to be yours or lying in a room. ‡"
              : "Only ⬢ can move from there. ‡"}
          </p>
        )}
      </div>

      {projected && (
        <p className={`text-xs ${overAfter ? "text-accent" : "text-muted"}`}>
          After this you carry {projected.tags} / {carry.tagsCap} items and {projected.resources} /{" "}
          {carry.resourcesCap} ⬢.
          {overAfter ? " That's more than you can manage — you'll be Overburdened until you set some down." : ""} ‡
        </p>
      )}
      <p className="text-xs text-muted">
        A person has to share your zone; a Silo, its faction&apos;s zone; a room, the spot you&apos;re
        standing in. ‡
      </p>
    </>
  );
}
