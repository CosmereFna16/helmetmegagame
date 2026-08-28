"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import ZoneChip from "@/app/components/ZoneChip";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import usePins from "@/app/components/usePins";
import { scoreMatch } from "@/lib/fuzzySearch";
import { markConversationRead } from "./actions";

// The player desk's queue rail, on the same .desk-rail/.desk-queue-row classes
// as the adjudication desk's — the two are the same tool and should look it.
//
// Two lenses, the way the other rail has Moves/Requests:
//
//   Inbox  — only players with a conversation, sorted pinned → unread →
//            recency, showing the last message.
//   Roster — everyone with a character, alphabetically. This is the lens that
//            makes a first message possible at all; the old inbox could only
//            list people who had already written.

const STATUS_FILTERS = ["all", "unread", "awaiting"];

function relativeTime(ms) {
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export default function PlayerRail({ rows, myZoneName, myDiscordUserId }) {
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [lens, setLens] = useState("inbox");
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState(myZoneName ?? "");
  const [statusFilter, setStatusFilter] = useState("all");

  const { isPinned, togglePin } = usePins();

  const zoneOptions = useMemo(
    () => [...new Set(rows.map((c) => c.factionZoneName).filter(Boolean))].sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim();
    // Inbox is "has a conversation"; Roster is "has a character". A player
    // with neither is not a row at all, and a dead character stays visible in
    // the roster so their history is still reachable.
    let list = rows.filter((r) => (lens === "inbox" ? r.count > 0 : r.characterId));

    if (zoneFilter) list = list.filter((c) => c.factionZoneName === zoneFilter);
    if (statusFilter === "unread") list = list.filter((c) => c.unreadCount > 0);
    if (statusFilter === "awaiting") list = list.filter((c) => c.lastDirection === "INBOUND");

    let scored = list.map((c) => ({ row: c, match: null }));
    if (q) {
      scored = list
        .map((c) => ({
          row: c,
          match: scoreMatch(q, {
            name: c.name,
            role: c.roleTitle,
            faction: c.factionName,
            username: c.username,
            zone: c.factionZoneName,
            preview: c.preview,
          }),
        }))
        .filter((r) => r.match);
    }

    scored.sort((a, b) => {
      if (q) return b.match.score - a.match.score;
      const aPinned = isPinned(a.row);
      const bPinned = isPinned(b.row);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      if (lens === "roster") return a.row.name.localeCompare(b.row.name);
      const aUnread = a.row.unreadCount > 0;
      const bUnread = b.row.unreadCount > 0;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      return b.row.lastAtMs - a.row.lastAtMs;
    });

    return scored;
  }, [rows, lens, query, zoneFilter, statusFilter, isPinned]);

  const unreadIds = useMemo(
    () => rows.filter((c) => c.unreadCount > 0).map((c) => c.discordUserId),
    [rows],
  );

  function markAllRead() {
    startTransition(async () => {
      await Promise.all(unreadIds.map((id) => markConversationRead({ playerDiscordUserId: id })));
    });
  }

  return (
    <div className="desk-rail">
      <div className="desk-rail-lens segmented" role="group" aria-label="Rail lens">
        <button type="button" aria-pressed={lens === "inbox"} onClick={() => setLens("inbox")}>
          Inbox
        </button>
        <button type="button" aria-pressed={lens === "roster"} onClick={() => setLens("roster")}>
          Roster
        </button>
      </div>

      <div className="desk-rail-filters">
        <label className="field min-w-0">
          <span className="field-label">Search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, role, faction…"
          />
        </label>
        <div className="segmented" role="group" aria-label="Conversation filter">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={statusFilter === f}
              onClick={() => setStatusFilter(f)}
            >
              {f === "all" ? "All" : f === "unread" ? "Unread" : "Awaiting"}
            </button>
          ))}
        </div>
        <ZoneScopeToggle
          myZoneName={myZoneName}
          filters={{ zone: zoneFilter }}
          setFilters={(fn) => setZoneFilter((prev) => fn({ zone: prev }).zone)}
        />
        {zoneOptions.length > 0 && (
          <label className="field">
            <span className="field-label">Zone</span>
            <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
              <option value="">All</option>
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        )}
        {unreadIds.length > 0 && (
          <button type="button" className="btn-quiet" onClick={markAllRead}>
            Mark all read
          </button>
        )}
      </div>

      <div className="desk-queue">
        {visible.map(({ row, match }) => {
          const href = `/gm/players/${row.discordUserId}`;
          const active = pathname === href;
          const pinned = isPinned(row);
          const claimedByOther =
            row.claimedByDiscordUserId && row.claimedByDiscordUserId !== myDiscordUserId;
          return (
            <div key={row.discordUserId} className="desk-queue-row" data-active={active ? "true" : "false"}>
              <button
                type="button"
                className="desk-queue-pin"
                aria-pressed={pinned}
                aria-label={pinned ? `Unpin ${row.name}` : `Pin ${row.name}`}
                onClick={() => togglePin(row)}
              >
                {pinned ? "★" : "☆"}
              </button>
              <Link href={href} className="desk-queue-link">
                <div className="desk-queue-top">
                  <span className="desk-queue-name">{row.name}</span>
                  {row.factionZoneName ? <ZoneChip zoneName={row.factionZoneName} /> : null}
                  {row.status && row.status !== "ALIVE" && (
                    <span className="chip text-xs text-muted">· {row.status.toLowerCase()}</span>
                  )}
                  {row.claimedByDiscordUserId && (
                    <span
                      className="chip"
                      title={claimedByOther ? "Claimed by another GM" : "Claimed by you"}
                    >
                      · {claimedByOther ? "claimed" : "you"}
                    </span>
                  )}
                  {row.lastAtMs > 0 && (
                    <span className="desk-queue-time mono">{relativeTime(row.lastAtMs)}</span>
                  )}
                </div>
                <div className="desk-queue-preview">
                  {row.preview || (
                    <span className="text-muted">
                      {row.roleTitle || "No messages yet"}
                    </span>
                  )}
                </div>
                {match && match.matchedField !== "name" && (
                  <div className="desk-queue-reason">
                    {match.matchedField === "role" && row.roleTitle}
                    {match.matchedField === "faction" && row.factionName}
                    {match.matchedField === "zone" && row.factionZoneName}
                    {match.matchedField === "username" && row.username}
                    {match.matchedField === "preview" && "matched message text"}
                  </div>
                )}
              </Link>
              {row.unreadCount > 0 && (
                <span className="desk-queue-unread mono">{row.unreadCount}</span>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <p className="text-sm text-muted p-4">Nobody matches.</p>}
      </div>

      <div className="desk-rail-hint">
        <span className="text-xs text-muted">
          {lens === "inbox"
            ? "Inbox lists players you have a thread with. Switch to Roster to message anyone."
            : "Roster lists every character. Pick one to open a reply box, even with no history."}
        </span>
      </div>
    </div>
  );
}
