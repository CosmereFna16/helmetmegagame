"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Pager from "@/app/components/Pager";
import AuditFeed from "./AuditFeed";
import AuditFilters from "./AuditFilters";
import AuditInspector from "./AuditInspector";
import { exportAudit } from "./exportActions";

// The audit desk's client shell.
//
// Two different kinds of state, held two different ways on purpose:
//
//   FILTERS live in the URL. The log is unbounded, so filtering has to happen
//   in Postgres, and a view worth having is a view worth pasting at another
//   GM. Every control writes through `set` below, which rewrites the query
//   string inside a transition and lets the server re-render.
//
//   SELECTION is local. The page already shipped every row on screen, so
//   picking one is a lookup, not a fetch — the URL is updated with
//   history.replaceState so the permalink stays right without re-running the
//   RSC tree. Same trick as the adjudication desk's Workspace.
//
// Presentation state (relative vs absolute time, density, whether the live
// tail is running) is local and deliberately not in the URL: it is how one
// person likes to read, not what they are looking at.

const REFRESH_MS = 20_000;

export default function AuditDesk({
  entries,
  names,
  pinned,
  selectedId,
  total,
  pageSize,
  filters,
  openTurn,
  typeCounts,
  actors,
  characters,
  factions,
  zones,
  turnNumbers,
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(selectedId ?? null);
  const [absoluteTime, setAbsoluteTime] = useState(false);
  const [density, setDensity] = useState("comfortable");
  const [live, setLive] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");

  // What the newest row was the last time the reader actually looked. The
  // badge counts forward from it rather than from the last refresh, so a tail
  // running while a GM reads something else accumulates instead of resetting.
  const seenTopId = useRef(entries[0]?.id ?? null);
  const [freshCount, setFreshCount] = useState(0);

  const page = filters.page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Rewrites the query string. `null` clears everything; anything else is a
  // patch, and any change resets to page 1 — landing on page 7 of a filter
  // that now has two pages is the classic way to show an empty screen.
  const set = useCallback(
    (patch) => {
      const next = patch === null ? emptyFilters() : { ...filters, ...patch, page: 1 };
      router.push(hrefFor(next), { scroll: false });
    },
    [filters, router],
  );

  const goToPage = useCallback(
    (n) => router.push(hrefFor({ ...filters, page: n }), { scroll: false }),
    [filters, router],
  );

  // Selection is a local pick plus a URL rewrite that does NOT re-render.
  const select = useCallback(
    (id) => {
      setSelected(id);
      const url = id ? `/gm/audit/${id}${window.location.search}` : `/gm/audit${window.location.search}`;
      window.history.replaceState(null, "", url);
    },
    [],
  );

  // Live tail. Paused while the tab is hidden — a background tab polling every
  // 20 seconds is pure cost — and stoppable, because a GM reading one entry
  // should not have the list move under them.
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [live, router]);

  // Count what has arrived since the reader last looked at the top of the
  // list. Only meaningful on page 1 of an unfiltered-by-date view; elsewhere
  // "newest" is not what the page is showing.
  useEffect(() => {
    if (page !== 1) return;
    const top = entries[0]?.id ?? null;
    if (!seenTopId.current) {
      seenTopId.current = top;
      return;
    }
    if (top === seenTopId.current) return;
    const index = entries.findIndex((e) => e.id === seenTopId.current);
    setFreshCount(index === -1 ? entries.length : index);
  }, [entries, page]);

  const acknowledge = () => {
    seenTopId.current = entries[0]?.id ?? null;
    setFreshCount(0);
  };

  const current = useMemo(() => {
    if (!selected) return null;
    return entries.find((e) => e.id === selected) ?? (pinned?.id === selected ? pinned : null);
  }, [entries, pinned, selected]);

  const download = async (format) => {
    setExporting(true);
    setNotice("");
    try {
      const result = await exportAudit({ params: toQueryObject(filters), format });
      if (!result?.ok) {
        setNotice(result?.error ?? "Could not build that export.");
        return;
      }
      const blob = new Blob([result.text], {
        type: format === "json" ? "application/json" : "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(result.truncated ? `Exported the newest ${result.count} entries.` : `Exported ${result.count} entries.`);
    } catch (e) {
      console.error("Audit export failed:", e);
      setNotice("Could not build that export.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="desk-shell">
      <header className="desk-header">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-base">Audit</h1>
          {openTurn && (
            <span className="chip">
              Turn {openTurn.number} · {openTurn.phase === "DAWN" ? "Dawn" : "Dusk"}
            </span>
          )}
          <span className="text-muted text-xs mono">{total.toLocaleString()} entries</span>
          {freshCount > 0 && (
            <button type="button" className="chip" onClick={acknowledge}>
              {freshCount} new
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {notice && <span className="text-muted text-xs">{notice}</span>}
          <div className="segmented" role="group" aria-label="Time format">
            <button type="button" aria-pressed={!absoluteTime} onClick={() => setAbsoluteTime(false)}>
              Ago
            </button>
            <button type="button" aria-pressed={absoluteTime} onClick={() => setAbsoluteTime(true)}>
              Clock
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Density">
            <button
              type="button"
              aria-pressed={density === "comfortable"}
              onClick={() => setDensity("comfortable")}
            >
              Roomy
            </button>
            <button type="button" aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>
              Tight
            </button>
          </div>
          <button type="button" className="btn-quiet" aria-pressed={live} onClick={() => setLive((v) => !v)}>
            {live ? "Pause live" : "Go live"}
          </button>
          <button type="button" className="btn-secondary" disabled={exporting} onClick={() => download("csv")}>
            CSV
          </button>
          <button type="button" className="btn-quiet" disabled={exporting} onClick={() => download("json")}>
            JSON
          </button>
        </div>
      </header>

      <div className="desk-body">
        <div className="desk-rail">
          <AuditFilters
            filters={filters}
            set={set}
            typeCounts={typeCounts}
            actors={actors}
            characters={characters}
            factions={factions}
            zones={zones}
            turnNumbers={turnNumbers}
          />
        </div>

        <main className="desk-main audit-main">
          <AuditFeed
            entries={entries}
            names={names}
            selectedId={selected}
            onSelect={select}
            absoluteTime={absoluteTime}
            density={density}
            emptyMessage="Nothing matches these filters."
          />
          <Pager page={page} totalPages={totalPages} total={total} unit="entries" onPage={goToPage} />
        </main>

        <AuditInspector entry={current} names={names} onFilter={set} />
      </div>
    </div>
  );
}

// The filter state back into a query string. A module-level function rather
// than a closure, so the two useCallbacks above can list it as a dependency
// without it changing identity on every render.
function hrefFor(next) {
  const params = new URLSearchParams();
  const put = (key, value) => value && params.append(key, value);
  put("q", next.q);
  for (const v of next.families) put("family", v);
  for (const v of next.types) put("type", v);
  for (const v of next.actors) put("actor", v);
  put("actorKind", next.actorKind);
  for (const v of next.targets) put("target", v);
  for (const v of next.factions) put("faction", v);
  for (const v of next.zones) put("zone", v);
  put("turnFrom", next.turnFrom);
  put("turnTo", next.turnTo);
  put("preset", next.preset);
  put("from", next.from);
  put("to", next.to);
  if (next.page > 1) put("page", String(next.page));
  const qs = params.toString();
  // Back to the bare list, not to the selected entry: a filter change is a new
  // question, and keeping the old row pinned answers the previous one.
  return qs ? `/gm/audit?${qs}` : "/gm/audit";
}

function emptyFilters() {
  return {
    q: "",
    families: [],
    types: [],
    actors: [],
    actorKind: "",
    targets: [],
    factions: [],
    zones: [],
    turnFrom: "",
    turnTo: "",
    preset: "",
    from: "",
    to: "",
    page: 1,
  };
}

// The filter state as the plain object parseAuditParams() expects, for the
// export action — it re-parses rather than trusting a shape the client built.
function toQueryObject(f) {
  return {
    q: f.q,
    family: f.families,
    type: f.types,
    actor: f.actors,
    actorKind: f.actorKind,
    target: f.targets,
    faction: f.factions,
    zone: f.zones,
    turnFrom: f.turnFrom,
    turnTo: f.turnTo,
    preset: f.preset,
    from: f.from,
    to: f.to,
  };
}
