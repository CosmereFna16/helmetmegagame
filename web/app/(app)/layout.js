import { redirect } from "next/navigation";
import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { isSuperadmin } from "@/lib/superadmin";
import NavRail from "../components/NavRail";
import TurnChip from "../components/TurnChip";

const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/archive", label: "Archive", icon: "archive" },
];

const GM_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/gm/players", label: "Players", icon: "players" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns" },
  { href: "/gm/messages", label: "Messages", icon: "messages" },
  { href: "/archive", label: "Archive", icon: "archive" },
  { href: "/gm/audit", label: "Audit", icon: "audit" },
];

const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev" };

export default async function AppLayout({ children }) {
  const [{ session, isGm: gm }, turn] = await Promise.all([getGmSession(), getOpenTurn()]);
  if (!session?.discordUserId) redirect("/");

  const baseNav = gm ? GM_NAV : PLAYER_NAV;
  const items = isSuperadmin(session.discordUserId) ? [...baseNav, DEV_NAV_ITEM] : baseNav;

  const [confirmedActionCount, pendingDesireCount, pendingTagRequestCount] = gm
    ? await Promise.all([
        prisma.action.count({ where: { status: "CONFIRMED" } }),
        prisma.desire.count({ where: { status: "PENDING" } }),
        prisma.tagChangeRequest.count({ where: { status: "PENDING" } }),
      ])
    : [0, 0, 0];
  const pendingAdjudicationCount = confirmedActionCount + pendingDesireCount + pendingTagRequestCount;
  const badges = gm && pendingAdjudicationCount > 0 ? { "/gm/turns": pendingAdjudicationCount } : {};

  return (
    <div className="app-shell">
      <NavRail items={items} badges={badges} />
      <main className="app-main">{children}</main>
      <TurnChip turn={turn} />
    </div>
  );
}
