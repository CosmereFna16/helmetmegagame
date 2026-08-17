import { redirect } from "next/navigation";
import { prisma, MORTUS_SLUG } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { isSuperadmin } from "@/lib/superadmin";
import NavRail from "../components/NavRail";
import TurnChip from "../components/TurnChip";

const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/notes", label: "Notes", icon: "notes" },
];

const GM_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/gm/players", label: "Players", icon: "players" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns" },
  { href: "/gm/messages", label: "Messages", icon: "messages" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/gm/audit", label: "Audit", icon: "audit" },
];

const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev" };
const LIFEWEB_NAV_ITEM = { href: "/lifeweb", label: "Lifeweb", icon: "lifeweb" };

export default async function AppLayout({ children }) {
  const [{ session, isGm: gm }, turn] = await Promise.all([getGmSession(), getOpenTurn()]);
  if (!session?.discordUserId) redirect("/");

  // The Lifeweb's Blood level is a secret the Mortii keep — everyone else
  // only gets the vague public omen line in the turn announcement (see
  // advanceTurn() in db/index.js) once it runs low.
  const hasMortus = gm
    ? true
    : !!(await prisma.characterTag.findFirst({
        where: { character: { discordUserId: session.discordUserId, status: "ALIVE" }, tag: { slug: MORTUS_SLUG } },
      }));

  const baseNav = gm ? GM_NAV : PLAYER_NAV;
  const withLifeweb = hasMortus ? [...baseNav, LIFEWEB_NAV_ITEM] : baseNav;
  const items = isSuperadmin(session.discordUserId) ? [...withLifeweb, DEV_NAV_ITEM] : withLifeweb;

  const [confirmedActionCount, pendingDesireCount, pendingTagRequestCount, unrepliedConversations] = gm
    ? await Promise.all([
        prisma.action.count({ where: { status: "CONFIRMED" } }),
        prisma.desire.count({ where: { status: "PENDING" } }),
        prisma.tagChangeRequest.count({ where: { status: "PENDING" } }),
        // A conversation needs a reply when its most recent message is INBOUND
        // (from the player) — an OUTBOUND message, bot-sent or GM-sent, counts
        // as answered.
        prisma.$queryRaw`
          SELECT COUNT(*)::int AS count FROM (
            SELECT DISTINCT ON ("discordUserId") direction
            FROM "DirectMessage"
            ORDER BY "discordUserId", "createdAt" DESC
          ) latest
          WHERE direction = 'INBOUND'
        `,
      ])
    : [0, 0, 0, [{ count: 0 }]];
  const pendingAdjudicationCount = confirmedActionCount + pendingDesireCount + pendingTagRequestCount;
  const pendingMessageCount = unrepliedConversations[0]?.count ?? 0;
  const badges = gm
    ? {
        ...(pendingAdjudicationCount > 0 ? { "/gm/turns": pendingAdjudicationCount } : {}),
        ...(pendingMessageCount > 0 ? { "/gm/messages": pendingMessageCount } : {}),
      }
    : {};

  return (
    <div className="app-shell">
      <NavRail items={items} badges={badges} />
      <main className="app-main">{children}</main>
      <TurnChip turn={turn} />
    </div>
  );
}
