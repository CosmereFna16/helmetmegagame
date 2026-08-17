import { redirect } from "next/navigation";
import { Suspense } from "react";
import { prisma, MORTUS_SLUG } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { isSuperadmin } from "@/lib/superadmin";
import NavRail from "../components/NavRail";
import NavRailWithBadges from "../components/NavRailWithBadges";
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

// Streamed separately from the nav shell (see the Suspense boundary in
// AppLayout below) so these always-live DB queries never block paint on a
// navigation. Caught internally so a transient DB hiccup degrades to "no
// badges" instead of taking down the whole rail.
async function loadGmBadgeCounts() {
  try {
    const [confirmedActionCount, pendingDesireCount, pendingTagRequestCount, unrepliedConversations] =
      await Promise.all([
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
      ]);
    const pendingAdjudicationCount = confirmedActionCount + pendingDesireCount + pendingTagRequestCount;
    const pendingMessageCount = unrepliedConversations[0]?.count ?? 0;
    return {
      ...(pendingAdjudicationCount > 0 ? { "/gm/turns": pendingAdjudicationCount } : {}),
      ...(pendingMessageCount > 0 ? { "/gm/messages": pendingMessageCount } : {}),
    };
  } catch {
    return {};
  }
}

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

  // Intentionally not awaited — passed down as a promise so Suspense can
  // stream it in behind the nav shell instead of blocking every navigation.
  const badgesPromise = gm ? loadGmBadgeCounts() : Promise.resolve({});

  return (
    <div className="app-shell">
      <Suspense fallback={<NavRail items={items} badges={{}} />}>
        <NavRailWithBadges items={items} badgesPromise={badgesPromise} />
      </Suspense>
      <main className="app-main">{children}</main>
      <TurnChip turn={turn} />
    </div>
  );
}
