// One reading of Character.tagPoints, so the sheet, the Tags panel and the
// dev panel all agree. A balance is not a cost: here a positive number is
// points you still have, so it stays green — the opposite of costColor(),
// which reads a tag's price and inverts the sign.
export default function TagPointsValue({ points, className }) {
  const n = points ?? 0;
  const color = n > 0 ? "var(--positive)" : n < 0 ? "var(--accent-text)" : "var(--muted)";
  return (
    <span className={className} style={{ color }}>
      {n > 0 ? `+${n}` : String(n)}
    </span>
  );
}
