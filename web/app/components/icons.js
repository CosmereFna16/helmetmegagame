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

export function TurnsIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M6 4h12M6 20h12" strokeLinecap="round" />
      <path d="M7 4c0 4 4 5 5 8-1 3-5 4-5 8M17 4c0 4-4 5-5 8 1 3 5 4 5 8" strokeLinecap="round" strokeLinejoin="round" />
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

export function FactionIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M12 3l7 3.5v5c0 5-3 8.5-7 9.5-4-1-7-4.5-7-9.5v-5L12 3z" strokeLinejoin="round" />
      <path d="M9.5 12l1.8 1.8L15 10" strokeLinecap="round" strokeLinejoin="round" />
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

export function SignOutIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M15 4h2.5A1.5 1.5 0 0 1 19 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" strokeLinecap="round" />
      <path d="M11 8l-4 4 4 4M4.5 12H15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
