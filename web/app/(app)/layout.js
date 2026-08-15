import { redirect } from "next/navigation";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { isSuperadmin } from "@/lib/superadmin";
import NavRail from "../components/NavRail";
import TurnChip from "../components/TurnChip";

const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
];

const GM_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/gm/players", label: "Players", icon: "players" },
  { href: "/gm/turns", label: "Turns", icon: "turns" },
  { href: "/gm/messages", label: "Messages", icon: "messages" },
  { href: "/gm/archive", label: "Archive", icon: "archive" },
  { href: "/gm/audit", label: "Audit", icon: "audit" },
];

const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev" };

export default async function AppLayout({ children }) {
  const [{ session, isGm: gm }, turn] = await Promise.all([getGmSession(), getOpenTurn()]);
  if (!session?.discordUserId) redirect("/");

  const baseNav = gm ? GM_NAV : PLAYER_NAV;
  const items = isSuperadmin(session.discordUserId) ? [...baseNav, DEV_NAV_ITEM] : baseNav;

  return (
    <div className="app-shell">
      <NavRail items={items} />
      <main className="app-main">{children}</main>
      <TurnChip turn={turn} />
    </div>
  );
}
