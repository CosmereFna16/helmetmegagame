// Renders a {resource:field:tier} token (see RichText.js) as a small pill
// showing the live-computed payout — "3", or "0–4" for a tier that rolls.
//
// Deliberately no tooltip and no tabIndex: it used to carry a "field — tier"
// label, which only restated what the surrounding table column already said,
// and a focus stop that reveals nothing is pure keyboard noise. The `chip-mono`
// class is doing real work, though — the mono face used to come from the
// `.tag-hover` wrapper that the tooltip needed, so dropping that wrapper
// without it would silently take every resource number off the mono face
// (see the fonts section of CLAUDE.md).
export default function ResourceChip({ value }) {
  return <span className="chip chip-mono">{value} ⬢</span>;
}
