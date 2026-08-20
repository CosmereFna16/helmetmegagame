import { formatCost, costColor } from "@/lib/characterCreation";
import { formatTagRequirement } from "@lifeweb/db";

export default function TagChip({ tag }) {
  const groupColor = tag.group?.color ? `var(--tag-${tag.group.color})` : null;
  // Minified "cost to add/remove this tag in play" — see
  // Tag.requirement* in schema.prisma. Null when unset, so it's simply
  // omitted rather than rendering an empty line.
  const requirement = formatTagRequirement(tag);

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
        {requirement && <p style={{ color: "var(--muted)" }}>{requirement}</p>}
        <span style={{ color: costColor(tag.pointCost) }}>{formatCost(tag.pointCost)} pts</span>
      </span>
    </span>
  );
}
