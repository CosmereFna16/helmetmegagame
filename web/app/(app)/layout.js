import { redirect } from "next/navigation";
import { Suspense } from "react";
import { prisma, MORTUS_SLUG } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getGmSession } from "@/lib/discordGuild";
import { getOpenTurn } from "@/lib/turn";
import { isSuperadmin } from "@/lib/superadmin";
import NavRail from "../components/NavRail";
import NavRailAsync from "../components/NavRailAsync";
import TurnChip from "../components/TurnChip";
import TurnChipAsync from "../components/TurnChipAsync";

const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/documents", label: "Documents", icon: "documents" },
];

const GM_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/gm/players", label: "Players", icon: "players" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns" },
  { href: "/gm/messages", label: "Messages", icon: "messages" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/documents", label: "Documents", icon: "documents" },
  { href: "/gm/audit", label: "Audit", icon: "audit" },
];

const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev" };
const LIFEWEB_NAV_ITEM = { href: "/lifeweb", label: "Lifeweb", icon: "lifeweb" };

// Streamed separately from the nav shell (see the Suspense boundary in
// AppLayout below) — the live Discord role check and the Mortus-tag lookup
// never block a navigation's paint.
async function loadNavItems(discordUserId) {
  const [{ isGm: gm }, hasMortusTag] = await Promise.all([
    getGmSession(),
    // The Lifeweb's Blood level is a secret the Mortii keep — everyone else
    // only gets the vague public omen line in the turn announcement (see
    // advanceTurn() in db/index.js) once it runs low.
    prisma.characterTag.findFirst({
      where: { character: { discordUserId, status: "ALIVE" }, tag: { slug: MORTUS_SLUG } },
    }),
  ]);
  const hasMortus = gm || !!hasMortusTag;

  const baseNav = gm ? GM_NAV : PLAYER_NAV;
  const withLifeweb = hasMortus ? [...baseNav, LIFEWEB_NAV_ITEM] : baseNav;
  return isSuperadmin(discordUserId) ? [...withLifeweb, DEV_NAV_ITEM] : withLifeweb;
}

export default async function AppLayout({ children }) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  // Not awaited here — passed down so Suspense can stream it in behind the
  // shell instead of blocking every navigation.
  const itemsPromise = loadNavItems(session.discordUserId);
  const turnPromise = getOpenTurn();

  return (
    <div className="app-shell">
      <Suspense fallback={<NavRail items={PLAYER_NAV} />}>
        <NavRailAsync itemsPromise={itemsPromise} />
      </Suspense>
      <main className="app-main">{children}</main>
      <Suspense fallback={<TurnChip turn={null} />}>
        <TurnChipAsync turnPromise={turnPromise} />
      </Suspense>
    </div>
  );
}
