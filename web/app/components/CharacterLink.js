import Link from "next/link";

// GM-only: players never get a link, just the plain name, regardless of
// characterId.
export default function CharacterLink({ characterId, name, isGm, className = "menu-item" }) {
  if (!characterId || !isGm) return name || "-";
  return (
    <Link href={`/gm/dev/characters/${characterId}`} className={className}>
      {name}
    </Link>
  );
}
