// The bare `.chip` span — name, optional ×N, group colour — with no tooltip
// and nothing interactive on it.
//
// Split out of TagChip so it can be rendered where an interactive chip can't
// go: inside another chip's hover tooltip (un-hoverable), or inside the
// <button> a point-buy row is (a role="button" inside a button is invalid
// markup). TagChip builds its own visible half from this.
export default function ChipLabel({ tag, quantity = 1, left = null }) {
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
      {/* Compact on the face, spelled out in the tooltip below — a chip has
          no room for "2 turns left". aria-hidden because the tooltip carries
          the readable version. */}
      {left != null && (
        <span className="text-muted" aria-hidden="true"> &middot; {left}t</span>
      )}
    </span>
  );
}
