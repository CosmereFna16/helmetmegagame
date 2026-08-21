// The bare `.chip` span — name, optional ×N, group colour — with no tooltip
// and nothing interactive on it.
//
// Split out of TagChip so it can be rendered where an interactive chip can't
// go: inside another chip's hover tooltip (un-hoverable), or inside the
// <button> a point-buy row is (a role="button" inside a button is invalid
// markup). TagChip builds its own visible half from this.
export default function ChipLabel({ tag, quantity = 1, duration = null }) {
  // Only a stack says how many; an ordinary tag reads as a bare name, which
  // is every tag outside Items today.
  const stack = quantity > 1 ? quantity : null;
  const groupColor = tag.group?.color ?? null;

  return (
    <span
      className="chip"
      style={groupColor ? { borderLeftColor: groupColor, borderLeftWidth: 3 } : undefined}
    >
      {tag.name}
      {stack && <span className="text-muted"> &times;{stack}</span>}
      {/* Compact on the face, spelled out in TagChip's tooltip — a chip has no
          room for "2 turns left". aria-hidden because the tooltip carries the
          readable version. The badge comes from the same tagDuration() the
          tooltip uses, so the two can't disagree; a tag on its final turn
          reads "last" rather than "0t", which looked like it had already
          gone. Null when the tag has no duration at all. */}
      {duration && (
        <span className="text-muted" aria-hidden="true"> &middot; {duration.badge}</span>
      )}
    </span>
  );
}
