export default function TagChip({ tag }) {
  const cost = tag.pointCost ?? 0;
  const costColor = cost > 0 ? "var(--mood-happy)" : cost < 0 ? "var(--accent)" : "var(--muted)";
  const costLabel = cost > 0 ? `+${cost}` : `${cost}`;

  return (
    <span className="tag-hover" tabIndex={0}>
      <span className="chip">{tag.name}</span>
      <span className="tag-tooltip" role="tooltip">
        <strong>{tag.name}</strong>
        {tag.description && <p>{tag.description}</p>}
        <span style={{ color: costColor }}>{costLabel} pts</span>
      </span>
    </span>
  );
}
