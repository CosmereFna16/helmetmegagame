import HoverCard from "./HoverCard";

// Thin wrapper for a flat-text tooltip (InfoIcon's "?" glyph). Shares
// HoverCard with TagChip so both escape their scrolling ancestors — they used
// to share only a CSS class, which meant fixing one would have half-broken
// the other.
export default function Tooltip({ text, children, className = "" }) {
  return (
    <HoverCard panel={text} className={className}>
      {children}
    </HoverCard>
  );
}
