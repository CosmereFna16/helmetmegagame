import Link from "next/link";

// Two call shapes, same idiom as DevCharacterButton.js:
//   - No `onSelect`: a plain Link to /faction?factionId=<id> — the
//     standalone page, used anywhere outside a desk that shows factions
//     in-place.
//   - `onSelect` given: a button that hands the id back to the caller
//     instead of navigating away, so a desk (the player desk's Factions tab)
//     can switch to its own faction view without leaving itself.
export default function FactionLink({ factionId, name, className = "menu-item", onSelect }) {
  if (!factionId) return name || "-";

  if (onSelect) {
    return (
      <button type="button" className={className} onClick={() => onSelect(factionId)}>
        {name}
      </button>
    );
  }

  return (
    <Link href={`/faction?factionId=${factionId}`} className={className}>
      {name}
    </Link>
  );
}
