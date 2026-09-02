"use client";

// The GM's seats, plus All, for a GM who holds any. Holds no state of its
// own — the Zone <select> in FilterBar and this toggle are two faces of one
// value, `filters.zone`, so a second useState here would let them disagree.
// `filters.zone` stays a single zone NAME: a GM seated in two zones gets one
// button per seat rather than a combined "Mine", since there is no one zone
// that is theirs. Renders nothing for the master or an unassigned GM.
export default function ZoneScopeToggle({ myZoneNames, filters, setFilters }) {
  const seats = myZoneNames ?? [];
  if (seats.length === 0) return null;
  const choose = (zone) => setFilters((f) => ({ ...f, zone }));

  return (
    <div className="field">
      <span className="field-label">Scope</span>
      <div className="segmented" role="group" aria-label="Zone scope">
        {seats.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => choose(name)}
            aria-pressed={filters.zone === name}
          >
            {/* One seat reads better as "Mine" — the zone's own name is
                already on the chip beside every row. Two or more have to be
                named apart. */}
            {seats.length === 1 ? "Mine" : name}
          </button>
        ))}
        <button type="button" onClick={() => choose("")} aria-pressed={!filters.zone}>
          All
        </button>
      </div>
    </div>
  );
}
