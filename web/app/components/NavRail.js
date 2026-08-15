"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CharacterIcon,
  PlayersIcon,
  TurnsIcon,
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
  turns: TurnsIcon,
  audit: AuditIcon,
  faction: FactionIcon,
  dev: DevIcon,
  messages: MessageIcon,
  archive: ArchiveIcon,
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
      <form action={signOutOfDiscord} className="rail-signout">
        <button type="submit" className="rail-item" style={{ width: "100%" }}>
          <SignOutIcon aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </form>
    </nav>
  );
}
