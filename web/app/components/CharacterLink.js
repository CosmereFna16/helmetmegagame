import Link from "next/link";

export default function CharacterLink({ characterId, name, className = "menu-item" }) {
  if (!characterId) return name || "-";
  return (
    <Link href={`/gm/players/${characterId}`} className={className}>
      {name}
    </Link>
  );
}
