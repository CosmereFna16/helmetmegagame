import { redirect } from "next/navigation";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import NavRail from "../components/NavRail";
import TurnChip from "../components/TurnChip";

const PLAYER_NAV = [{ href: "/character", label: "Character", icon: "character" }];

const GM_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/gm/players", label: "Players", icon: "players" },
  { href: "/gm/turns", label: "Turns", icon: "turns" },
  { href: "/gm/audit", label: "Audit", icon: "audit" },
];

export default async function AppLayout({ children }) {
  const [{ session, isGm: gm }, turn] = await Promise.all([getGmSession(), getOpenTurn()]);
  if (!session?.discordUserId) redirect("/");

  return (
    <div className="app-shell">
      <NavRail items={gm ? GM_NAV : PLAYER_NAV} />
      <main className="app-main">{children}</main>
      <TurnChip turn={turn} />
    </div>
  );
}
