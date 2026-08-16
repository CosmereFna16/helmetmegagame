"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CharacterIcon,
  PlayersIcon,
  ScaleIcon,
  AuditIcon,
  FactionIcon,
  DevIcon,
  MessageIcon,
  ArchiveIcon,
  SignOutIcon,
} from "./icons";
import { signOutOfDiscord } from "../actions";

const ICONS = {
  character: CharacterIcon,
  players: PlayersIcon,
  turns: ScaleIcon,
  audit: AuditIcon,
  faction: FactionIcon,
  dev: DevIcon,
  messages: MessageIcon,
  archive: ArchiveIcon,
};

export default function NavRail({ items, badges = {} }) {
  const pathname = usePathname();

  return (
    <nav className="app-rail" aria-label="Main">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badgeCount = badges[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            className="rail-item"
            data-active={active ? "true" : "false"}
          >
            <span className="rail-icon">
              <Icon aria-hidden="true" />
              {badgeCount > 0 && (
                <span className="rail-badge" aria-label={`${badgeCount} pending`}>
                  {badgeCount > 9 ? "9+" : badgeCount}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
      <form action={signOutOfDiscord} className="rail-signout">
        <button type="submit" className="rail-item" style={{ width: "100%" }}>
          <SignOutIcon aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </form>
    </nav>
  );
}
