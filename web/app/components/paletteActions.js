"use server";

import { prisma } from "@lifeweb/db";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { guarded } from "@/lib/actionResult";
import { moveKindLabel } from "@/lib/moves";

// Everything ⌘K can jump to, in one payload. Fetched on first open and held
// client-side for a minute rather than shipped with every page — a hundred
// characters plus a turn's queue is small, but it is not free, and most page
// views never open the palette.
//
// A non-GM gets pages only. The GM branches below are all re-gated in the
// pages they lead to; this is presentation, and those are enforcement.

const GENERIC_PAGES = [
  { label: "Character", href: "/character" },
  { label: "Map", href: "/map" },
  { label: "Notes", href: "/notes" },
  { label: "Documents", href: "/documents" },
  { label: "Archive", href: "/archive" },
];

// The GM screens with no rail item at all. Today these are reachable only by
// knowing the URL or by hunting through a hand-rolled sub-nav on some other
// page, which is most of the reason the palette exists.
const GM_PAGES = [
  { label: "Players", href: "/gm/players" },
  { label: "Adjudicate", href: "/gm/turns" },
  { label: "Dev Panel", href: "/gm/dev" },
  { label: "Dev · Characters", href: "/gm/dev/characters" },
  { label: "Dev · Factions", href: "/gm/dev/factions" },
  { label: "Dev · Tags", href: "/gm/dev/tags" },
  { label: "Gamemasters", href: "/gm/gamemasters" },
  { label: "Audit log", href: "/gm/audit" },
  { label: "Lifeweb", href: "/lifeweb" },
];

const REQUEST_LIMIT = 100;

async function getPaletteIndexImpl() {
  const { session, isGm: gm } = await getGmSession();
  if (!session?.discordUserId) return { entries: [] };

  const pages = gm
    ? [...GM_PAGES, ...GENERIC_PAGES].filter(
        (p) => p.href !== "/gm/audit" || isSuperadmin(session.discordUserId),
      )
    : GENERIC_PAGES;

  const entries = pages.map((p) => ({
    kind: "page",
    id: p.href,
    label: p.label,
    hint: p.href,
    href: p.href,
  }));

  if (!gm) return { entries };

  const openTurn = await getOpenTurn();
  const [characters, actions, requests, zones, factions] = await Promise.all([
    prisma.character.findMany({
      orderBy: [{ firstName: "asc" }, { lastName: { sort: "asc", nulls: "first" } }],
      select: {
        id: true,
        name: true,
        status: true,
        discordUserId: true,
        roleTitle: true,
        faction: { select: { name: true } },
      },
      take: 1000,
    }),
    openTurn
      ? prisma.action.findMany({
          where: { turnId: openTurn.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            description: true,
            moveKind: true,
            character: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    prisma.request.findMany({
      orderBy: { createdAt: "desc" },
      take: REQUEST_LIMIT,
      select: { id: true, type: true, character: { select: { name: true } } },
    }),
    prisma.zone.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.faction.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  for (const c of characters) {
    entries.push({
      kind: "player",
      id: c.id,
      label: c.name,
      hint: [c.roleTitle, c.faction?.name].filter(Boolean).join(" · "),
      dim: c.status !== "ALIVE",
      href: `/gm/players/${c.discordUserId}`,
      search: { role: c.roleTitle ?? "", faction: c.faction?.name ?? "" },
    });
  }

  for (const a of actions) {
    entries.push({
      kind: "move",
      id: a.id,
      label: `${a.character?.name ?? "(deleted)"} — ${moveKindLabel(a.moveKind)}`,
      hint: a.description ?? "",
      href: `/gm/turns/move/${a.id}`,
      search: { preview: a.description ?? "" },
    });
  }

  for (const r of requests) {
    entries.push({
      kind: "request",
      id: r.id,
      label: `${r.character?.name ?? "(deleted)"} — request`,
      hint: r.type,
      href: `/gm/turns/request/${r.id}`,
    });
  }

  for (const z of zones) {
    entries.push({ kind: "zone", id: z.id, label: z.name, hint: "zone", href: "/map" });
  }

  for (const f of factions) {
    entries.push({
      kind: "faction",
      id: f.id,
      label: f.name,
      hint: "faction",
      href: `/faction?factionId=${f.id}`,
    });
  }

  return { entries };
}

export async function getPaletteIndex() {
  return guarded(() => getPaletteIndexImpl());
}
