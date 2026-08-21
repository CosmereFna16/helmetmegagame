// Renders a {resource:field:tier} token (see RichText.js) as a small pill
// showing the live-computed payout, same visual language as TagChip.
export default function ResourceChip({ value, label }) {
  return (
    <span className="tag-hover" tabIndex={0}>
      <span className="chip">{value} ⬢</span>
      {label && (
        <span className="tag-tooltip" role="tooltip">
          <strong>{label}</strong>
        </span>
      )}
    </span>
  );
}
