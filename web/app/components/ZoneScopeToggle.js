"use client";

// Mine / All, for a GM who holds a zone seat.
//
// Holds no state of its own on purpose. The Zone <select> in FilterBar and
// this toggle are two faces of one value — `filters.zone` — so a second
// useState here would let them disagree the moment someone used the select
// instead. Pressed state is derived, and the page-1 reset rides in for free
// on the shared setFilters.
//
// Renders nothing for the master and for an unassigned GM, which is how every
// zone feature degrades to today's behaviour when getMyZone() returns null.
export default function ZoneScopeToggle({ myZoneName, filters, setFilters }) {
  if (!myZoneName) return null;
  const mine = filters.zone === myZoneName;

  return (
    <div className="field">
      <span className="field-label">Scope</span>
      <div className="segmented" role="group" aria-label="Zone scope">
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, zone: myZoneName }))}
          aria-pressed={mine}
        >
          Mine
        </button>
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, zone: "" }))}
          aria-pressed={!mine}
        >
          All
        </button>
      </div>
    </div>
  );
}
