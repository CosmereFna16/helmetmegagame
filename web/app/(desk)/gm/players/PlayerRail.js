"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import ZoneChip from "@/app/components/ZoneChip";
import ZoneScopeToggle from "@/app/components/ZoneScopeToggle";
import Select from "@/app/components/Select";
import { openingZoneName } from "@/lib/zones";
import usePins from "@/app/components/usePins";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import { EnumPill, CHARACTER_STATUS } from "@/app/components/StatusPill";
import { scoreMatch } from "@/lib/fuzzySearch";
import useNowTick from "@/app/components/useNowTick";
import { mergeRailRows, useRailPatches } from "./liveInbox";
import {
  markConversationRead,
  searchConversations,
  setConversationHandled,
  setConversationMuted,
} from "./actions";

// The player desk's queue rail, on the same .desk-rail/.desk-queue-row classes
// as the adjudication desk's — the two are the same tool and should look it.
//
// One lens: the rail is the inbox. With no search query it lists only players
// with a conversation, sorted pinned → unread → recency, showing the last
// message. Typing a query widens the candidate set to everyone with a
// character too — that's what makes a first message possible at all — and
// pauses the zone and needs-reply filters, since the seat-seeded zone filter
// would otherwise silently hide a cross-zone search hit.

// The fuzzy engine only ever sees what the layout ships to the client, and
// that is one preview line per conversation — so "find the thread where we
// talked about the barley" could not work at all. Anything at least this long
// also goes to the server as an ILIKE over every message
// (actions.js#searchConversations), debounced, and its hits are merged in
// UNDER the fuzzy ones: a name match is still what a GM usually means.
const CONTENT_SEARCH_MIN = 3;
const CONTENT_SEARCH_DEBOUNCE_MS = 300;

// The "why this row matched" hint for a tag hit: the tag names that contain a
// query word, not the whole sheet joined into one line.
function matchedTagNames(tagNames, query) {
  const words = query
    .toLowerCase()
    .replace(/^tag:/, "")
    .split(/\s+/)
    .filter(Boolean);
  const hits = (tagNames ?? []).filter((n) => words.some((w) => n.toLowerCase().includes(w)));
  const shown = (hits.length ? hits : tagNames ?? []).slice(0, 3);
  return shown.join(", ") + ((hits.length ? hits : tagNames ?? []).length > 3 ? ", …" : "");
}

function relativeTime(ms, now) {
  const diff = now - ms;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

export default function PlayerRail({ rows: serverRows, rowsAsOfMs, myZoneNames, myDiscordUserId }) {
  const pathname = usePathname();
  // The live inbox's patches laid over the layout's rows (liveInbox.js), so
  // a new message moves a row, bumps its badge and rewrites its preview
  // within seconds instead of on the next 30s refresh. Done FIRST, before
  // the ✓/⊘ overrides below look at a row: the ✓ override is keyed on the
  // row's last-message time, and it has to see the live one to un-stick
  // when a new message lands.
  const patches = useRailPatches();
  const rows = useMemo(() => mergeRailRows(serverRows, patches, rowsAsOfMs), [serverRows, patches, rowsAsOfMs]);
  // A beat for the relative-time chips, so "just now" doesn't stay "just
  // now" for an hour.
  const now = useNowTick(30_000);
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [zoneFilter, setZoneFilter] = useState(openingZoneName(myZoneNames));
  // "Who is waiting on me": unread, or they wrote last and it's been read.
  // A 100-player inbox still needs this one lens; it did not need three
  // mutually exclusive ones where two were sort orders in disguise.
  const [needsReplyOnly, setNeedsReplyOnly] = useState(false);
  // { q, hits } — kept keyed by the query it answered, so a stale round trip
  // is ignored during render rather than cleared from an effect (clearing
  // state in an effect body is what react-hooks/set-state-in-effect, an error
  // here, exists to catch). Clearing the box therefore drops the hits for
  // free: they simply stop matching the current query.
  const [contentHits, setContentHits] = useState(null);
  const [, startSearchTransition] = useTransition();
  // Optimistic ✓ marks, so the glyph lights the instant it is clicked instead
  // of waiting on the revalidation. Keyed on the conversation's last-message
  // time as well as the id, so the entry stops matching — and the server's
  // answer takes back over — the moment a new message lands on that row.
  const [handledOverride, setHandledOverride] = useState({});
  // Muted conversations are out of the rail by default. This reveals them,
  // greyed, in place — hiding them outright is the point, but a GM still has
  // to be able to find someone they muted a week ago.
  const [showMuted, setShowMuted] = useState(false);
  // Same optimistic trick as the ✓, minus the timestamp in the key: a mute is
  // standing, so nothing about a new message should take it back.
  const [mutedOverride, setMutedOverride] = useState({});

  useEffect(() => {
    const q = query.trim();
    if (q.length < CONTENT_SEARCH_MIN) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      startSearchTransition(async () => {
        const res = await searchConversations({ q });
        if (cancelled || !res?.ok) return;
        setContentHits({ q, hits: res.hits });
      });
    }, CONTENT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const activeContentHits =
    contentHits && contentHits.q === query.trim() ? contentHits.hits : null;

  // The player rail knows both id spaces — a character and/or a bare
  // discordUserId per row — so unlike the adjudication desk it can prune both
  // "c:" and "u:" pins, not just its own namespace.
  const knownPinIdentities = useMemo(() => {
    const ids = new Set();
    for (const r of rows) {
      if (r.characterId) ids.add(`c:${r.characterId}`);
      if (r.discordUserId) ids.add(`u:${r.discordUserId}`);
    }
    return ids;
  }, [rows]);
  const { isPinned, togglePin } = usePins({ knownIdentities: knownPinIdentities });

  const isHandled = useCallback(
    (row) => {
      const override = handledOverride[`${row.discordUserId}:${row.lastAtMs}`];
      return override === undefined ? Boolean(row.handled) : override;
    },
    [handledOverride],
  );

  function handledKey(row) {
    return `${row.discordUserId}:${row.lastAtMs}`;
  }

  const isMuted = useCallback(
    (row) => {
      const override = mutedOverride[row.discordUserId];
      return override === undefined ? Boolean(row.muted) : override;
    },
    [mutedOverride],
  );

  function toggleMuted(row) {
    const next = !isMuted(row);
    setMutedOverride((prev) => ({ ...prev, [row.discordUserId]: next }));
    startTransition(async () => {
      const res = await setConversationMuted({
        playerDiscordUserId: row.discordUserId,
        muted: next,
      });
      if (!res?.ok) {
        setMutedOverride((prev) => ({ ...prev, [row.discordUserId]: !next }));
      }
    });
  }

  function toggleHandled(row) {
    const next = !isHandled(row);
    setHandledOverride((prev) => ({ ...prev, [handledKey(row)]: next }));
    startTransition(async () => {
      const res = await setConversationHandled({
        playerDiscordUserId: row.discordUserId,
        handled: next,
      });
      if (!res?.ok) {
        setHandledOverride((prev) => ({ ...prev, [handledKey(row)]: !next }));
      }
    });
  }

  const zoneOptions = useMemo(
    () => [...new Set(rows.map((c) => c.factionZoneName).filter(Boolean))].sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const q = query.trim();
    // With no query, the rail is the inbox: only players with a conversation.
    // A query widens the net to everyone with a character too — that's the
    // only way to reach someone who has never written, since their href
    // already works for an empty thread.
    let list = q
      ? rows.filter((r) => r.hasConversation || r.characterId)
      : rows.filter((r) => r.hasConversation);

    // Unlike the zone and needs-reply filters, a query does NOT lift this one
    // on its own — a mute is a standing decision about a person, not a lens
    // over the inbox, so it takes the toggle to see them again.
    if (!showMuted) list = list.filter((r) => !isMuted(r));

    // A query pauses the zone and needs-reply filters rather than composing
    // with them — otherwise the seat-seeded zone filter would silently hide
    // a cross-zone search hit, which is exactly the case search exists for.
    if (!q) {
      if (zoneFilter) list = list.filter((c) => c.factionZoneName === zoneFilter);
      if (needsReplyOnly) {
        list = list.filter(
          (c) => !isHandled(c) && (c.unreadCount > 0 || c.lastDirection === "INBOUND"),
        );
      }
    }

    let scored = list.map((c) => ({ row: c, match: null }));
    if (q) {
      scored = list
        .map((c) => ({
          row: c,
          match: scoreMatch(q, {
            name: c.name,
            role: c.roleTitle,
            faction: c.factionName,
            username: [c.username, c.globalName].filter(Boolean).join(" "),
            zone: c.factionZoneName,
            tag: c.tag,
            preview: c.preview,
          }),
        }))
        .filter((r) => r.match);
    }

    scored.sort((a, b) => {
      if (q) {
        if (b.match.score !== a.match.score) return b.match.score - a.match.score;
        const aHasThread = a.row.hasConversation;
        const bHasThread = b.row.hasConversation;
        if (aHasThread !== bHasThread) return aHasThread ? -1 : 1;
        return b.row.lastAtMs - a.row.lastAtMs;
      }
      const aPinned = isPinned(a.row);
      const bPinned = isPinned(b.row);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      const aUnread = a.row.unreadCount > 0;
      const bUnread = b.row.unreadCount > 0;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;
      return b.row.lastAtMs - a.row.lastAtMs;
    });

    if (!q || !activeContentHits) return scored;

    // Content hits for people the fuzzy pass already found are redundant —
    // they are ranked by name/role/tag and stay where they are. What is worth
    // adding is everyone the fuzzy pass CANNOT see, because the only place
    // the query appears is inside the transcript.
    const alreadyShown = new Set(scored.map((entry) => entry.row.discordUserId));
    const eligible = new Map(list.map((r) => [r.discordUserId, r]));
    const extra = [];
    for (const hit of activeContentHits) {
      if (alreadyShown.has(hit.discordUserId)) continue;
      const row = eligible.get(hit.discordUserId);
      if (row) extra.push({ row, match: null, contentHits: hit.hits });
    }
    extra.sort((a, b) => b.row.lastAtMs - a.row.lastAtMs);
    return [...scored, ...extra];
  }, [
    rows,
    query,
    zoneFilter,
    needsReplyOnly,
    isPinned,
    activeContentHits,
    isHandled,
    isMuted,
    showMuted,
  ]);

  const mutedCount = useMemo(
    () => rows.filter((r) => r.hasConversation && isMuted(r)).length,
    [rows, isMuted],
  );

  const unreadIds = useMemo(
    () => rows.filter((c) => c.unreadCount > 0).map((c) => c.discordUserId),
    [rows],
  );

  function markAllRead() {
    startTransition(async () => {
      await Promise.all(unreadIds.map((id) => markConversationRead({ playerDiscordUserId: id })));
    });
  }

  const searching = query.trim().length > 0;

  return (
    <div className="desk-rail">
      <div className="desk-rail-filters">
        <label className="field min-w-0">
          <span className="field-label">Search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="name, role, faction, tag, zone, @handle, message text…"
          />
        </label>
        {searching && (
          <span className="text-xs text-muted">Searching everyone — filters paused.</span>
        )}
        {zoneOptions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <label className="field min-w-0" style={{ flex: "1 1 6rem" }}>
              <span className="field-label">Zone</span>
              <Select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
                <option value="">All</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        )}
        <ZoneScopeToggle
          myZoneNames={myZoneNames}
          filters={{ zone: zoneFilter }}
          setFilters={(fn) => setZoneFilter((prev) => fn({ zone: prev }).zone)}
        />
        <div className="segmented" role="group" aria-label="Reply filter">
          <button
            type="button"
            aria-pressed={needsReplyOnly}
            onClick={() => setNeedsReplyOnly((v) => !v)}
          >
            Needs reply
          </button>
        </div>
        {unreadIds.length > 0 && (
          <button type="button" className="btn-quiet" onClick={markAllRead}>
            Mark all read
          </button>
        )}
        {mutedCount > 0 && (
          <button type="button" className="btn-quiet" onClick={() => setShowMuted((v) => !v)}>
            {showMuted ? `Hide muted (${mutedCount})` : `Show muted (${mutedCount})`}
          </button>
        )}
      </div>

      <div className="desk-queue">
        {visible.map(({ row, match, contentHits: hitCount }) => {
          const href = `/gm/players/${row.discordUserId}`;
          const active = pathname === href;
          const pinned = isPinned(row);
          const handled = isHandled(row);
          const muted = isMuted(row);
          const claimedByOther =
            row.claimedByDiscordUserId && row.claimedByDiscordUserId !== myDiscordUserId;
          return (
            <div
              key={row.discordUserId}
              className="desk-queue-row"
              data-active={active ? "true" : "false"}
              data-muted={muted ? "true" : undefined}
              data-unread={row.unreadCount > 0 ? "true" : undefined}
            >
              <div className="desk-queue-marks">
                <button
                  type="button"
                  className="desk-queue-pin"
                  aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${row.name}` : `Pin ${row.name}`}
                  onClick={() => togglePin(row)}
                >
                  {pinned ? "★" : "☆"}
                </button>
                <button
                  type="button"
                  className="desk-queue-done"
                  aria-pressed={handled}
                  aria-label={
                    handled
                      ? `Mark ${row.name} as needing a reply`
                      : `Mark ${row.name} as needing no reply`
                  }
                  title={handled ? "Needs a reply after all" : "Needs no reply"}
                  onClick={() => toggleHandled(row)}
                >
                  ✓
                </button>
                <button
                  type="button"
                  className="desk-queue-mute"
                  aria-pressed={muted}
                  aria-label={muted ? `Unmute ${row.name}` : `Mute ${row.name}`}
                  title={muted ? "Unmute — back in the inbox" : "Mute — out of the inbox"}
                  onClick={() => toggleMuted(row)}
                >
                  ⊘
                </button>
              </div>
              <Link href={href} className="desk-queue-link">
                <div className="desk-queue-top">
                  <CharacterAvatar
                    characterId={row.characterId}
                    name={row.name}
                    version={row.avatarVersion}
                    catatonic={row.catatonic}
                  />
                  <span className="desk-queue-name">{row.name}</span>
                  {row.username && <span className="text-xs text-muted">@{row.username}</span>}
                  {row.factionZoneName ? <ZoneChip zoneName={row.factionZoneName} /> : null}
                  {row.status && row.status !== "ALIVE" && (
                    <EnumPill map={CHARACTER_STATUS} value={row.status} />
                  )}
                  {row.claimedByDiscordUserId && (
                    <span
                      className="chip"
                      title={claimedByOther ? "Claimed by another GM" : "Claimed by you"}
                    >
                      {claimedByOther ? "Claimed" : "You"}
                    </span>
                  )}
                  {row.lastAtMs > 0 && (
                    <span className="desk-queue-time mono">{relativeTime(row.lastAtMs, now)}</span>
                  )}
                  {row.lastDirection === "INBOUND" && row.unreadCount === 0 && !handled && (
                    <span className="chip text-xs text-muted">awaiting</span>
                  )}
                </div>
                <div className="desk-queue-preview">
                  {row.preview || (
                    <span className="text-muted">
                      {row.roleTitle || "No messages yet"}
                    </span>
                  )}
                </div>
                {match && match.matchedField !== "name" && match.matchedField !== "username" && (
                  <div className="desk-queue-reason">
                    {match.matchedField === "role" && row.roleTitle}
                    {match.matchedField === "faction" && row.factionName}
                    {match.matchedField === "zone" && row.factionZoneName}
                    {match.matchedField === "tag" && matchedTagNames(row.tagNames, query)}
                    {match.matchedField === "preview" && "matched message text"}
                  </div>
                )}
                {hitCount > 0 && (
                  <div className="desk-queue-reason">
                    in messages · {hitCount}
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
          Everyone you have a thread with. Search finds any character, including ones you&apos;ve
          never messaged.
        </span>
      </div>
    </div>
  );
}
