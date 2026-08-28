import { prisma, MORTUS_SLUG } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";

// The nav rail's item list, shared by both route groups. It used to live
// inside (app)/layout.js, which was fine while (app) was the only group that
// drew a rail — (desk) rendered its children bare. Now that the adjudication
// and player desks carry the rail too, one copy has to serve both, or the two
// groups drift into different navs for the same user.

export const PLAYER_NAV = [
  { href: "/character", label: "Character", icon: "character" },
  { href: "/map", label: "Map", icon: "map" },
  { href: "/faction", label: "Faction", icon: "faction" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/documents", label: "Documents", icon: "documents" },
];

// No Faction item: for a GM /faction only ever rendered the all-factions
// overview, which is now the Factions view of the player desk's roster.
// Players keep theirs in PLAYER_NAV above — that one is their own faction,
// not a list.
//
// No Messages item either: Players and Messages used to be two screens and
// are one desk now, so the unread badge rides Players. The roster and the
// conversations are the same list seen through two lenses.
//
// `section` splits the rail into the two hats a GM wears: the "gm" group is
// the job, the "player" group is the same five screens every player gets.
// NavRail draws a divider wherever the section changes, so the order below IS
// the grouping — moving an item between groups is a one-word edit here.
// PLAYER_NAV carries no section at all, which is how a player gets no divider.
export const GM_NAV = [
  { href: "/gm/players", label: "Players", icon: "messages", section: "gm" },
  { href: "/gm/turns", label: "Adjudicate", icon: "turns", section: "gm" },
  { href: "/gm/audit", label: "Audit", icon: "audit", section: "gm" },
  // The GM's own player screens, in PLAYER_NAV's order minus Faction.
  { href: "/character", label: "Character", icon: "character", section: "player" },
  { href: "/map", label: "Map", icon: "map", section: "player" },
  { href: "/notes", label: "Notes", icon: "notes", section: "player" },
  { href: "/documents", label: "Documents", icon: "documents", section: "player" },
];

// Appended conditionally below. Audit now sits in GM_NAV itself — every GM
// reads it, so it is a tool for them rather than a record of them. Dev stays
// superadmin. Gamemasters still has no rail item at all: it is one more
// superadmin table hanging off the Dev panel's sub-nav.
const DEV_NAV_ITEM = { href: "/gm/dev", label: "Dev", icon: "dev", section: "gm" };
const LIFEWEB_NAV_ITEM = { href: "/lifeweb", label: "Lifeweb", icon: "lifeweb", section: "player" };
const ARCHIVE_NAV_ITEM = { href: "/archive", label: "Archive", icon: "archive", section: "player" };

// Streamed separately from the nav shell (see the Suspense boundary in
// AppRail) — the live Discord role check and the Mortus-tag lookup never
// block a navigation's paint.
async function loadUnreadConversationCount(discordUserId) {
  // Distinct players with an INBOUND row newer than this GM's read cursor —
  // the same shape the messages layout uses per-conversation, collapsed to
  // one number for the rail badge.
  const rows = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT dm."discordUserId")::int AS "count"
    FROM "DirectMessage" dm
    LEFT JOIN "ConversationRead" cr
      ON cr."playerDiscordUserId" = dm."discordUserId"
      AND cr."gmDiscordUserId" = ${discordUserId}
    WHERE dm."direction" = 'INBOUND'
      AND dm."createdAt" > COALESCE(cr."lastReadAt", to_timestamp(0))
  `;
  return rows[0]?.count ?? 0;
}

export async function loadNavItems(discordUserId) {
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

  // Only a GM has a per-GM read cursor to speak of; a player's own DM history
  // isn't what this badge is for.
  const unreadCount = gm ? await loadUnreadConversationCount(discordUserId) : 0;
  const baseNav = (gm ? GM_NAV : PLAYER_NAV).map((item) =>
    item.href === "/gm/players" && unreadCount > 0 ? { ...item, badge: unreadCount } : item,
  );
  const withLifeweb = hasMortus ? [...baseNav, LIFEWEB_NAV_ITEM] : baseNav;
  // GMs always have the Archive; players only once it's opened. The page
  // re-checks — this is presentation, that is enforcement, same posture as
  // /character's creation gate.
  const withArchive =
    gm || config?.archiveVisible ? [...withLifeweb, ARCHIVE_NAV_ITEM] : withLifeweb;
  // Dev is appended last and carries section "gm", so on a GM's rail it lands
  // after the player group. That is one more divider than the two groups
  // suggest, which is correct: Dev is not the same job as Players/Adjudicate
  // and reads better as its own mark at the bottom.
  return isSuperadmin(discordUserId) ? [...withArchive, DEV_NAV_ITEM] : withArchive;
}
