import { formatCost, costColor } from "@/lib/characterCreation";

export default function TagChip({ tag }) {
  const groupColor = tag.group?.color ? `var(--tag-${tag.group.color})` : null;

  return (
    <span className="tag-hover" tabIndex={0}>
      <span
        className="chip"
        style={groupColor ? { borderLeftColor: groupColor, borderLeftWidth: 3 } : undefined}
      >
        {tag.name}
      </span>
      <span className="tag-tooltip" role="tooltip">
        <strong>{tag.name}</strong>
        {tag.description && <p>{tag.description}</p>}
        <span style={{ color: costColor(tag.pointCost) }}>{formatCost(tag.pointCost)} pts</span>
      </span>
    </span>
  );
}
