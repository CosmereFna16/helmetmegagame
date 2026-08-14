"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CharacterIcon, PlayersIcon, TurnsIcon, AuditIcon } from "./icons";

const ICONS = {
  character: CharacterIcon,
  players: PlayersIcon,
  turns: TurnsIcon,
  audit: AuditIcon,
};

export default function NavRail({ items }) {
  const pathname = usePathname();

  return (
    <nav className="app-rail" aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="rail-item"
            data-active={active ? "true" : "false"}
          >
            <Icon aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
