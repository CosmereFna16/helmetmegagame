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

// The Handbook rail tab.
export function HelpIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.3a2.4 2.4 0 114.15 1.65c-.7.65-1.35 1.1-1.35 2.15" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.15" fill="currentColor" stroke="none" />
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

// A hanging merchant's scale-pan / coin purse silhouette: the Store is where
// Tag Points get spent, so it reads as commerce rather than another list.
export function StoreIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M9.5 8V6.5a2.5 2.5 0 015 0V8" strokeLinecap="round" />
      <path
        d="M5.5 8h13l-1 11a1.5 1.5 0 01-1.5 1.4H8a1.5 1.5 0 01-1.5-1.4l-1-11z"
        strokeLinejoin="round"
      />
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

// The Dev-panel jump — a crenellated keep: the panel is where a GM rebuilds
// someone from the foundations up.
export function KeepIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M6.5 20V6h2.3v1.8h2.05V6h2.3v1.8h2.05V6h2.3v14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 20h15" strokeLinecap="round" />
      <path d="M10.6 20v-3.1a1.4 1.4 0 0 1 2.8 0V20" strokeLinejoin="round" />
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

// GM inbox chime mute toggle (NavRail.js). One icon, one path added when muted.
export function SpeakerIcon({ muted, ...props }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 10v4h3.5L12 17.5v-11L7.5 10H4z" strokeLinejoin="round" />
      {muted ? (
        <path d="M16 9.5l4.5 5M20.5 9.5L16 14.5" strokeLinecap="round" />
      ) : (
        <path d="M16 9.2c1.1.9 1.8 2 1.8 2.8s-.7 1.9-1.8 2.8" strokeLinecap="round" />
      )}
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

// Craft. A hammer over an anvil-line: the recipe door on the action grid
// (actionRegistry.js).
export function HammerIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M13.5 6.5l4 4" strokeLinecap="round" />
      <path d="M9.5 5.5l5-1.5 4.5 4.5-1.5 5-3-3" strokeLinejoin="round" />
      <path d="M12.5 10.5L5 18a1.6 1.6 0 0 0 2.3 2.3l7.5-7.5" strokeLinejoin="round" />
      <path d="M4 21.5h16" strokeLinecap="round" />
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

// --- The player Actions grid (ActionGrid.js) -------------------------------
// Seven glyphs that had no equivalent in the set above. Same flat 1.6 stroke
// on currentColor as everything else here, so they inherit .icon-btn's
// accent-on-hover fill without any colour of their own.

// Transfer Tag — a thing passed from one open hand to another.
export function HandOffIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3 10h4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 14h-4l-2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 7.5l3-2.5 3 2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 5v9" strokeLinecap="round" />
    </svg>
  );
}

// Transfer Resources — the filled ⬢ of the Resources glyph, hexagon only, so
// it reads as the currency next to PointsIcon's hollow ⬡.
export function ResourcesIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z" strokeLinejoin="round" />
    </svg>
  );
}

// Loot — a hand closing over what it takes.
export function LootIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M7 11V5.5a1.5 1.5 0 013 0V11" strokeLinecap="round" />
      <path d="M10 11V4.5a1.5 1.5 0 013 0V11" strokeLinecap="round" />
      <path d="M13 11V6a1.5 1.5 0 013 0v5" strokeLinecap="round" />
      <path d="M16 9.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1a6 6 0 01-6-6v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Bind — a shackle: a closed loop through a link.
export function ShackleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="8" cy="12" r="4.5" />
      <circle cx="16" cy="12" r="4.5" />
      <path d="M12.5 12h-1" strokeLinecap="round" />
    </svg>
  );
}

// Free — the key that opens it.
export function KeyIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="8" cy="8" r="4" />
      <path d="M11 11l8 8M16.5 16.5l-2 2M19 19l-2 2" strokeLinecap="round" />
    </svg>
  );
}


// Butcher — a cleaver: a broad rectangular blade with a short handle off its
// heel. Squared-off and blade-heavy so it doesn't read as the hammer or the
// sword at 16px.
export function CleaverIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 4.5h11v9.5H4z" strokeLinejoin="round" />
      <path d="M15 6.5h3.5M18.5 6.5V19" strokeLinecap="round" />
    </svg>
  );
}

// Engrave — the same headstone as Bury, but standing free of the ground and
// carrying lettering. The two sit side by side in the action grid, so what
// separates them has to be visible at 16px: no ground line, three rules.
export function HeadstoneIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M6.5 21V8.5a5.5 5.5 0 0 1 11 0V21" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 11h5M9.5 14h5M9.5 17h3" strokeLinecap="round" />
    </svg>
  );
}

// Bury — a headstone in the ground. The rounded top and the ground line read
// as a grave at 16px, where a cross alone would read as a plus sign.
export function GraveIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M7 20V9a5 5 0 0 1 10 0v11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 8v6M9.5 10.5h5" strokeLinecap="round" />
      <path d="M3.5 20h17" strokeLinecap="round" />
    </svg>
  );
}

// Fast travel — a horse's head and neck in profile, the shape a chess knight
// uses for the same reason: it survives being shrunk.
export function HorseIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path
        d="M8 20.5c0-4 1-6 3.5-7.6 1.6-1 2.3-1.9 2.4-3.2l-3.2 1.2-1.6-2.2 2.6-3.3c1.2-1.5 2.6-2.2 4.1-1.9 2.3.5 3.7 2.6 3.7 5.6 0 5.4-2.4 8.6-2.4 11.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16.2 8.2h.01" strokeLinecap="round" />
    </svg>
  );
}

// A bird in flight, for the Bird's letter. Same construction as HorseIcon
// above — one continuous stroke, no fill, so it sits at the same weight as the
// rest of the Actions grid at 24px.
export function BirdIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path
        d="M20.5 5.2c-1 .5-1.8.7-2.7.7A4 4 0 0 0 11 8.7v.9C7.6 9.4 5 7.9 3.2 5.2c0 0-2 4.5 1.8 7.5-.9.6-1.8.8-2.8.8 1.2 1.8 3 2.4 4.9 2.4-1.6 1.2-3.7 1.8-5.6 1.7 2 1.3 4.4 2 6.8 2 8.1 0 12.6-6.9 12.6-12.8v-.6c.8-.6 1.5-1.4 2-2.3-.8.4-1.6.6-2.4.7z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The Select trigger's open/close glyph — a single downward chevron, the
// universal "this opens a list" mark.
export function ChevronDownIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// A drawing-pin, angled — the Journal's "pin to top" toggle. Deliberately not
// a star: this page already uses ★ for a starred message, and the Starred
// tab's [★] means "unstar/delete" — a star meaning "pinned" on one tab and
// "delete" on the other would overload the same glyph two ways on one page.
export function PinIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path
        d="M14.5 3.5l6 6-3 3-1-.3-3.9 3.9.4 3.4-1.4 1.4-4.6-4.6-4.6 4.6-1-1 4.6-4.6-4.6-4.6 1.4-1.4 3.4.4 3.9-3.9-.3-1z"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SendIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M4 12l16-7-5 7 5 7-16-7z" strokeLinejoin="round" />
      <path d="M4 12h11" />
    </svg>
  );
}
