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
  { href: "/map", label: "Map", icon: "map" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/documents", label: "Documents", icon: "documents" },
  // Sixth item, so on mobile it lands behind the More sheet — an occasional
  // shopping trip loses that seat to the five daily surfaces above.
  { href: "/store", label: "Store", icon: "store" },
];

// No Faction item: for a GM /faction only ever rendered the all-factions
// overview, which is now the Factions tab of the Players panel. Players keep
// theirs in PLAYER_NAV above — that one is their own faction, not a list.
const GM_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/gm/players", label: "Players", icon: "players" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns" },
  { href: "/gm/messages", label: "Messages", icon: "messages" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/documents", label: "Documents", icon: "documents" },
  // Appended rather than slotted in beside Character: on a GM's rail the
  // first five are what the mobile bar shows, and Adjudicate/Players earn
  // those slots ahead of the Map.
  { href: "/map", label: "Map", icon: "map" },
  // Zone-GMs play too, so they shop too.
  { href: "/store", label: "Store", icon: "store" },
];

// Superadmin-only, appended together below. The Audit log used to sit in
// GM_NAV; with five GMs it is a record of them rather than a tool for them.
// Gamemasters has no rail item at all — it is one more superadmin table, so
// it hangs off the Dev panel's sub-nav beside Characters/Factions/Tags.
const AUDIT_NAV_ITEM = { href: "/gm/audit", label: "Audit", icon: "audit" };
const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev" };
const LIFEWEB_NAV_ITEM = { href: "/lifeweb", label: "Lifeweb", icon: "lifeweb" };
const ARCHIVE_NAV_ITEM = { href: "/archive", label: "Archive", icon: "archive" };

// Streamed separately from the nav shell (see the Suspense boundary in
// AppLayout below) — the live Discord role check and the Mortus-tag lookup
// never block a navigation's paint.
async function loadNavItems(discordUserId) {
  const [{ isGm: gm }, hasMortusTag, config] = await Promise.all([
    getGmSession(),
    // The Lifeweb's Blood level is a secret the Mortii keep — everyone else
    // only gets the vague public omen line in the turn announcement (see
    // advanceTurn() in db/index.js) once it runs low.
    prisma.characterTag.findFirst({
      where: { character: { discordUserId, status: "ALIVE" }, tag: { slug: MORTUS_SLUG } },
    }),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { archiveVisible: true } }),
  ]);
  const hasMortus = gm || !!hasMortusTag;

  const baseNav = gm ? GM_NAV : PLAYER_NAV;
  const withLifeweb = hasMortus ? [...baseNav, LIFEWEB_NAV_ITEM] : baseNav;
  // GMs always have the Archive; players only once it's opened. The page
  // re-checks — this is presentation, that is enforcement, same posture as
  // /character's creation gate.
  const withArchive =
    gm || config?.archiveVisible ? [...withLifeweb, ARCHIVE_NAV_ITEM] : withLifeweb;
  return isSuperadmin(discordUserId)
    ? [...withArchive, AUDIT_NAV_ITEM, DEV_NAV_ITEM]
    : withArchive;
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
