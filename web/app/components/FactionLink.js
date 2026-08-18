import Link from "next/link";

export default function FactionLink({ factionId, name, className = "menu-item" }) {
  if (!factionId) return name || "-";
  return (
    <Link href={`/faction?factionId=${factionId}`} className={className}>
      {name}
    </Link>
  );
}
