// One way to show a state, in place of the eight the app had grown.
//
// The tone is the vocabulary, not the colour: callers say what a state MEANS
// and the stylesheet decides what that looks like, so a status cannot pick a
// colour the theme has not solved. That matters because "bad" was being drawn
// with --accent in some places and --danger in others, and --accent is a fill
// token that fails AA as text.
//
// Colour comes from a data-tone attribute rather than an inline style — the
// mechanism the map panel's data-tier already proves, and which nothing else
// in the app was using.
//
// Per-domain label/tone maps stay where they are. A Move's statuses and a
// Request's are genuinely different vocabularies with their own justifying
// comments; what universalizes is the rendering, not the meanings.
export default function StatusPill({ tone = "neutral", children, className = "" }) {
  return (
    <span className={`status-pill ${className}`.trim()} data-tone={tone}>
      {children}
    </span>
  );
}

// The DB enums, in one place, so a raw ALIVE/DEAD/FULFILLED can never reach a
// player again. Five tables were rendering `{c.status}` straight out of Prisma
// -- two of them on /faction, which players can see.
export const CHARACTER_STATUS = {
  ALIVE: { label: "Alive", tone: "good" },
  DEAD: { label: "Dead", tone: "bad" },
  CURSED: { label: "Cursed", tone: "muted" },
};

export const DESIRE_STATUS = {
  ACTIVE: { label: "Active", tone: "neutral" },
  FULFILLED: { label: "Fulfilled", tone: "good" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

// Renders a DB enum through one of the maps above, falling back to the raw
// value rather than to nothing — an unmapped enum should look wrong in review,
// not vanish in production.
export function EnumPill({ map, value, className = "" }) {
  const entry = map[value];
  return (
    <StatusPill tone={entry?.tone ?? "neutral"} className={className}>
      {entry?.label ?? value}
    </StatusPill>
  );
}
