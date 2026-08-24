export function CharacterIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.5 20c1.4-4 4-6 7.5-6s6.1 2 7.5 6" strokeLinecap="round" />
    </svg>
  );
}

export function PlayersIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="8.5" cy="8" r="2.8" />
      <circle cx="16" cy="9" r="2.2" />
      <path d="M2.8 19.5c1-3.3 3.1-5 5.7-5s4.7 1.7 5.7 5" strokeLinecap="round" />
      <path d="M14.5 15c2.2.2 3.7 1.8 4.5 4.5" strokeLinecap="round" />
    </svg>
  );
}

export function AuditIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
      <path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4.5" strokeLinecap="round" />
    </svg>
  );
}

// The GM roster. A keyed seat -- a person marked with a pin -- rather than
// another set of faces, so it does not read as PlayersIcon at rail size.
export function GamemastersIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="9.5" cy="8" r="3.25" />
      <path d="M3.75 19.5c0-3.2 2.58-5.25 5.75-5.25 1.06 0 2.05.23 2.9.64" strokeLinecap="round" />
      <path d="M17.5 12.5l1.3 2.63 2.9.42-2.1 2.05.5 2.9-2.6-1.37-2.6 1.37.5-2.9-2.1-2.05 2.9-.42z" strokeLinejoin="round" />
    </svg>
  );
}

export function FactionIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3l7 3.5v5c0 5-3 8.5-7 9.5-4-1-7-4.5-7-9.5v-5L12 3z" strokeLinejoin="round" />
      <path d="M9.5 12l1.8 1.8L15 10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ScaleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3v18M8 21h8" strokeLinecap="round" />
      <path d="M4 7h6M14 7h6" strokeLinecap="round" />
      <path d="M4 7l-2.5 5A2.5 2.5 0 0 0 4 15a2.5 2.5 0 0 0 2.5-3L4 7zM20 7l-2.5 5a2.5 2.5 0 0 0 2.5 3 2.5 2.5 0 0 0 2.5-3L20 7z" strokeLinejoin="round" />
    </svg>
  );
}

export function MessageIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 5.5h16v10H9l-4 3.5v-3.5H4v-10z" strokeLinejoin="round" />
    </svg>
  );
}

export function DevIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 4l-4 16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DocumentsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M14 3H7a1.5 1.5 0 00-1.5 1.5v15A1.5 1.5 0 007 21h10a1.5 1.5 0 001.5-1.5V7.5L14 3z" strokeLinejoin="round" />
      <path d="M13.75 3.2V7.5h4.3M8.75 12h6.5M8.75 15.5h6.5" strokeLinecap="round" />
    </svg>
  );
}

export function NotesIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3.5l2.4 5 5.5.8-4 3.9.9 5.5-5-2.6-5 2.6.9-5.5-4-3.9 5.5-.8L12 3.5z" strokeLinejoin="round" />
    </svg>
  );
}

// A lidded box of records, not another sheet of paper — the Archive is the
// game's kept history, and needs to read as a different kind of thing from
// Documents (reference prose) sitting next to it on the rail.
export function ArchiveIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3.5 7.5h17v11a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-11z" strokeLinejoin="round" />
      <path d="M2.5 4.5h19v3h-19v-3z" strokeLinejoin="round" />
      <path d="M10 11.5h4" strokeLinecap="round" />
    </svg>
  );
}

// A folded map with a marked point on it — the Map panel's pointcrawl in
// miniature, rather than the pin every other app uses for "location".
export function MapIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5v-13z" strokeLinejoin="round" />
      <path d="M9 4v13M15 6.5v13" strokeLinecap="round" />
      <path d="M12 9l1.6 1.6-1.6 1.6-1.6-1.6L12 9z" strokeLinejoin="round" />
    </svg>
  );
}

export function LifewebIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3.5c3.2 4 5.5 7.3 5.5 10.3a5.5 5.5 0 1 1-11 0c0-3 2.3-6.3 5.5-10.3z" strokeLinejoin="round" />
      <path d="M9.7 15.5c0 1.4 1 2.3 2.3 2.3" strokeLinecap="round" />
    </svg>
  );
}

export function SignOutIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M15 4h2.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" strokeLinecap="round" />
      <path d="M11 8l-4 4 4 4M4.5 12H15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The Dev-panel jump. Drawn as a claw hammer: a head block PERPENDICULAR to
// the handle, with the claw's split V on the left. The perpendicular
// T-junction is the whole point — the previous drawing put a matching square
// at both ends of a 45° diagonal, which reads as a pipe wrench, not a hammer.
export function HammerIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      {/* head, sitting across the top */}
      <path d="M6 7.5h12.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H6V7.5z" strokeLinejoin="round" />
      {/* the claw: a V bitten out of the head's left end */}
      <path d="M6 7.5L3 9.75 6 12" strokeLinecap="round" strokeLinejoin="round" />
      {/* handle, dropping straight down from under the head */}
      <path d="M12 12v8.5" strokeLinecap="round" />
    </svg>
  );
}

export function EyeIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

export function EditIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 20h4L19 9l-4-4L4 16v4z" strokeLinejoin="round" />
      <path d="M14.5 5.5l4 4" strokeLinecap="round" />
    </svg>
  );
}

// The mobile bottom bar's "More" affordance — see NavRail.js's MOBILE_PRIMARY.
export function MoreIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

// ── Dev Character Panel action bar (docs/systemdocs/DEV-PANEL.md) ──────────
// One icon per microaction. Same 24×24 stroked convention as everything
// above, so they sit at 15px inside .icon-btn without rescaling.

export function SkullIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 2.5c-4.7 0-7.5 3.1-7.5 7.2 0 2.4 1 4 2.3 5.1.5.4.7.9.7 1.5v1.2c0 .8.7 1.5 1.5 1.5h6c.8 0 1.5-.7 1.5-1.5v-1.2c0-.6.2-1.1.7-1.5 1.3-1.1 2.3-2.7 2.3-5.1 0-4.1-2.8-7.2-7.5-7.2z" strokeLinejoin="round" />
      <circle cx="9" cy="10.5" r="1.6" />
      <circle cx="15" cy="10.5" r="1.6" />
      <path d="M10.5 19v2.5M13.5 19v2.5" strokeLinecap="round" />
    </svg>
  );
}

// Revive. An ankh rather than a plain cross: the cross reads as "add" next to
// the heal icon, and this button is specifically "bring them back".
export function AnkhIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 2.5c-2 0-3.5 1.6-3.5 3.7 0 1.8 1.2 3.2 2.3 4.3.5.5.7.9.7 1.5v9.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 2.5c2 0 3.5 1.6 3.5 3.7 0 1.8-1.2 3.2-2.3 4.3-.5.5-.7.9-.7 1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 13.5h10" strokeLinecap="round" />
    </svg>
  );
}

// Restore turn — a counter-clockwise arrow, the universal "give it back".
export function RestoreIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" strokeLinecap="round" />
      <path d="M3 4v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Spend turn — skip to the end, the mirror of RestoreIcon.
export function SkipIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M5 5.5l8 6.5-8 6.5v-13z" strokeLinejoin="round" />
      <path d="M18 5v14" strokeLinecap="round" />
    </svg>
  );
}

// Inflict wound.
export function WoundIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 21s-7.5-4.7-7.5-10a4.3 4.3 0 0 1 7.5-2.8A4.3 4.3 0 0 1 19.5 11c0 5.3-7.5 10-7.5 10z" strokeLinejoin="round" />
      <path d="M9.5 11.5l2 2 3-3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Heal all.
export function BandageIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" />
      <path d="M10.5 10.5l3 3M13.5 10.5l-3 3" strokeLinecap="round" />
    </svg>
  );
}

// Feed — a bowl, not cutlery: cutlery at 15px is two indistinct strokes.
export function MealIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3.5 11h17a8.5 8.5 0 0 1-8.5 8.5A8.5 8.5 0 0 1 3.5 11z" strokeLinejoin="round" />
      <path d="M8 7.5c0-1 1-1.5 1-2.5M12 7.5c0-1 1-1.5 1-2.5M16 7.5c0-1 1-1.5 1-2.5" strokeLinecap="round" />
    </svg>
  );
}

// Re-push this character's Discord state.
export function SyncIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3.5 10a8.5 8.5 0 0 1 14.4-4.1L20.5 8.5" strokeLinecap="round" />
      <path d="M20.5 14a8.5 8.5 0 0 1-14.4 4.1L3.5 15.5" strokeLinecap="round" />
      <path d="M20.5 3.5v5h-5M3.5 20.5v-5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 6.5h16" strokeLinecap="round" />
      <path d="M9 6.5V4.5h6v2" strokeLinejoin="round" />
      <path d="M6 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h7a1.5 1.5 0 0 0 1.5-1.4l1-13" strokeLinejoin="round" />
      <path d="M10.5 10.5v7M13.5 10.5v7" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

// Refund unspent tag points — the ⬡ of the point economy, hollow so it never
// reads as the filled ⬢ Resources glyph.
export function PointsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z" strokeLinejoin="round" />
      <path d="M9.5 14.5l5-5M9.5 9.5h.01M14.5 14.5h.01" strokeLinecap="round" />
    </svg>
  );
}
