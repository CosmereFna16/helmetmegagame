"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname } from "next/navigation";
import ZoneChip from "@/app/components/ZoneChip";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import { scoreMatch } from "@/lib/fuzzySearch";
import { markConversationRead } from "./actions";

const PINS_STORAGE_KEY = "messages-pins";

// Same read-through-useSyncExternalStore shape as the desk's pins
// (Workspace.js) — no setState-in-effect, no server/client hydration
// mismatch, and a pin change in another tab is picked up via `storage`.
function subscribePins(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}
const NO_PINS = [];
let pinsCache = { raw: null, value: NO_PINS };
function readStoredPins() {
  try {
    const raw = window.localStorage.getItem(PINS_STORAGE_KEY);
    if (raw === pinsCache.raw) return pinsCache.value;
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    pinsCache = { raw, value: Array.isArray(parsed) ? parsed : NO_PINS };
    return pinsCache.value;
  } catch {
    return pinsCache.value;
  }
}
function serverPins() {
  return NO_PINS;
}
function writeStoredPins(pins) {
  try {
    window.localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    /* private window / blocked site data */
  }
}

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

const FILTERS = ["all", "unread", "awaiting"];

export default function ConversationList({ conversations, myZoneName, myDiscordUserId }) {
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState(myZoneName ?? "");
  const [statusFilter, setStatusFilter] = useState("all");

  const pins = useSyncExternalStore(subscribePins, readStoredPins, serverPins);
  const pinnedSet = useMemo(() => new Set(pins), [pins]);

  const togglePin = useCallback(
    (discordUserId) => {
      const next = pinnedSet.has(discordUserId)
        ? pins.filter((id) => id !== discordUserId)
        : [...pins, discordUserId];
      writeStoredPins(next);
      // storage event doesn't fire in the tab that wrote it — nudge the
      // subscriber manually so the pin reflects immediately here too.
      window.dispatchEvent(new Event("storage"));
    },
    [pins, pinnedSet],
  );

  const zoneOptions = useMemo(
    () => [...new Set(conversations.map((c) => c.zoneName).filter(Boolean))].sort(),
    [conversations],
  );

  const rows = useMemo(() => {
    const q = query.trim();
    let list = conversations;

    if (zoneFilter) list = list.filter((c) => c.zoneName === zoneFilter);
    if (statusFilter === "unread") list = list.filter((c) => c.unreadCount > 0);
    if (statusFilter === "awaiting") list = list.filter((c) => c.lastDirection === "INBOUND");

    let scored = list.map((c) => ({ row: c, match: null }));
    if (q) {
      scored = list
        .map((c) => ({
          row: c,
          match: scoreMatch(q, {
            name: c.name,
            role: c.roleName,
            faction: c.factionName,
            username: c.username,
            zone: c.zoneName,
            preview: c.preview,
          }),
        }))
        .filter((r) => r.match);
    }

    scored.sort((a, b) => {
      if (q) return b.match.score - a.match.score;
      const aPinned = pinnedSet.has(a.row.discordUserId);
      const bPinned = pinnedSet.has(b.row.discordUserId);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aUnread = a.row.unreadCount > 0;
      const bUnread = b.row.unreadCount > 0;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      return b.row.lastAtMs - a.row.lastAtMs;
    });

    return scored;
  }, [conversations, query, zoneFilter, statusFilter, pinnedSet]);

  const unreadIds = useMemo(() => conversations.filter((c) => c.unreadCount > 0).map((c) => c.discordUserId), [conversations]);

  function markAllRead() {
    startTransition(async () => {
      await Promise.all(unreadIds.map((id) => markConversationRead({ playerDiscordUserId: id })));
    });
  }

  return (
    <div className="inbox-list">
      <div className="inbox-list-controls">
        <label className="field min-w-0">
          <span className="field-label">Search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, role, faction…"
          />
        </label>
        <div className="segmented" role="group" aria-label="Conversation filter">
          {FILTERS.map((f) => (
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

      <div className="inbox-rows">
        {rows.map(({ row, match }) => {
          const href = `/gm/messages/${row.discordUserId}`;
          const active = pathname === href;
          const pinned = pinnedSet.has(row.discordUserId);
          const claimedByOther = row.claimedByDiscordUserId && row.claimedByDiscordUserId !== myDiscordUserId;
          return (
            <div key={row.discordUserId} className="inbox-row" data-active={active ? "true" : "false"}>
              <button
                type="button"
                className="inbox-row-pin"
                aria-pressed={pinned}
                aria-label={pinned ? "Unpin conversation" : "Pin conversation"}
                onClick={() => togglePin(row.discordUserId)}
              >
                {pinned ? "★" : "☆"}
              </button>
              <Link href={href} className="inbox-row-link">
                <div className="inbox-row-top">
                  <span className="inbox-row-name">{row.name}</span>
                  {row.zoneName ? <ZoneChip zoneName={row.zoneName} /> : null}
                  {row.claimedByDiscordUserId && (
                    <span className="chip" title={claimedByOther ? "Claimed by another GM" : "Claimed by you"}>
                      · {claimedByOther ? "claimed" : "you"}
                    </span>
                  )}
                  <span className="inbox-row-time mono">{relativeTime(row.lastAtMs)}</span>
                </div>
                <div className="inbox-row-preview">{row.preview}</div>
                {match && match.matchedField !== "name" && (
                  <div className="inbox-row-reason">
                    {match.matchedField === "role" && row.roleName}
                    {match.matchedField === "faction" && row.factionName}
                    {match.matchedField === "zone" && row.zoneName}
                    {match.matchedField === "username" && row.username}
                    {match.matchedField === "preview" && "matched message text"}
                  </div>
                )}
              </Link>
              {row.unreadCount > 0 && <span className="inbox-unread-pill mono">{row.unreadCount}</span>}
            </div>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-muted p-4">No conversations match.</p>}
      </div>
    </div>
  );
}
