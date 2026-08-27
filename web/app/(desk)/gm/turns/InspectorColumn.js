"use client";

import { useEffect, useState } from "react";
import TagChip from "@/app/components/TagChip";
import FactionLink from "@/app/components/FactionLink";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import MarkdownContent from "@/app/components/MarkdownContent";
import { getCharacterInspector, getArchiveSlice, getDmThread } from "./actions";

// The right-hand inspector: the "quickly pull up the guy he was talking to"
// column. Sheet / Tags / Archive / DMs over whichever character was last
// clicked anywhere in the workspace, with a pin row so the characters an
// arbitration keeps returning to stay one click away.
//
// Fetches are on-demand server actions cached in the Workspace-owned Map
// (`${characterId}:${tab}`) for the life of the page view — an inspector is
// a reference surface, and stale-by-minutes is fine. The refresh affordance
// is switching tabs off and back... or the page-level refresh any staging
// action already does.

const TABS = ["Sheet", "Tags", "Archive", "DMs"];

function useInspectorData(characterId, tab, cache, setCache) {
  // The cache is Workspace-owned state (not a ref — entries are read during
  // render, and react-hooks/refs is an error here). The effect's only job is
  // filling a miss, and its setCache happens after the await — never
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  const key = characterId ? `${characterId}:${tab === "Tags" ? "Sheet" : tab}` : null;
  const entry = key ? (cache.get(key) ?? null) : null;

  useEffect(() => {
    if (!key || !characterId || entry) return undefined;
    let cancelled = false;
    (async () => {
      const fetcher =
        tab === "Archive" ? getArchiveSlice : tab === "DMs" ? getDmThread : getCharacterInspector;
      const res = await fetcher({ characterId });
      if (cancelled) return;
      const value = res?.ok ? { data: res } : { error: res?.error ?? "Couldn't load that." };
      setCache((prev) => (prev.has(key) ? prev : new Map(prev).set(key, value)));
    })();
    return () => {
      cancelled = true;
    };
  }, [key, characterId, tab, entry, setCache]);

  return {
    data: entry?.data ?? null,
    error: entry?.error ?? null,
    loading: Boolean(characterId) && !entry,
  };
}

function SheetView({ data, tab, tagsById, currentTurnNumber }) {
  if (tab === "Tags") {
    return (
      <div className="flex flex-wrap gap-1.5 p-3">
        {data.tags.length ? (
          data.tags.map((ct) => (
            <TagChip
              key={ct.tagId}
              tag={ct.tag ?? tagsById[ct.tagId]}
              quantity={ct.quantity}
              expiresTurn={ct.expiresTurn}
              currentTurn={currentTurnNumber ?? data.currentTurnNumber}
            />
          ))
        ) : (
          <p className="text-sm text-muted">No tags.</p>
        )}
      </div>
    );
  }

  const facts = [
    ["Status", data.status],
    ["Role", data.roleTitle ?? "—"],
    ["Faction", <FactionLink key="f" factionId={data.factionId} name={data.factionName ?? "—"} />],
    ["Location", data.locationLabel],
    ["Resources", `${data.resources} ⬢`],
    ["Tag points", String(data.tagPoints)],
    ["Gambit", data.gambitModifier > 0 ? `+${data.gambitModifier}` : String(data.gambitModifier)],
    ["Acted", data.acted ? "yes" : "no"],
    ["Fear", data.fear ?? "—"],
  ];
  return (
    <dl className="desk-inspector-facts p-3">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt className="field-label">{label}</dt>
          <dd className="mono text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ArchiveView({ data }) {
  if (!data.entries.length) return <p className="p-3 text-sm text-muted">Nothing in the transcript.</p>;
  return (
    <div className="flex flex-col gap-3 p-3">
      {data.entries.map((e) => (
        <div key={e.id}>
          <p className="text-xs text-muted">
            {e.concealedAlias ? `${e.concealedAlias} (${e.characterName})` : e.characterName}
            {e.locationName ? ` · ${e.locationName}` : ""}
            {e.turnNumber != null ? ` · turn ${e.turnNumber}` : ""}
          </p>
          <div className="text-sm">
            <MarkdownContent content={e.content} />
          </div>
        </div>
      ))}
    </div>
  );
}

function DmsView({ data }) {
  if (!data.messages.length) return <p className="p-3 text-sm text-muted">No messages yet.</p>;
  return (
    <div className="flex flex-col gap-2 p-3">
      {data.messages.map((m) => (
        <div
          key={m.id}
          className="rounded-md px-3 py-2 text-sm"
          style={{
            alignSelf: m.direction === "OUTBOUND" ? "flex-end" : "flex-start",
            maxWidth: "90%",
            background: m.direction === "OUTBOUND" ? "var(--accent-solid)" : "var(--field-bg)",
            color: m.direction === "OUTBOUND" ? "var(--on-accent)" : "var(--text)",
            border: m.direction === "OUTBOUND" ? "none" : "1px solid var(--border)",
          }}
        >
          <MarkdownContent content={m.content} />
          <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
            {m.sentAt.slice(0, 16).replace("T", " ")}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function InspectorColumn({
  inspected,
  pinned,
  onInspect,
  onTogglePin,
  cache,
  setCache,
  tagsById,
  currentTurnNumber,
}) {
  const [tab, setTab] = useState("Sheet");
  const { data, error, loading } = useInspectorData(inspected?.characterId ?? null, tab, cache, setCache);

  const isPinned = pinned.some((p) => p.characterId === inspected?.characterId);

  return (
    <aside className="desk-inspector">
      {pinned.length > 0 && (
        <div className="desk-inspector-pins">
          {pinned.map((p) => (
            <button
              key={p.characterId}
              type="button"
              className="chip"
              data-active={p.characterId === inspected?.characterId || undefined}
              onClick={() => onInspect(p.characterId, p.name)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {!inspected ? (
        <p className="p-4 text-sm text-muted">
          Click any character name — in the queue, on the desk, in the tray — to look them up here
          without leaving the workspace.
        </p>
      ) : (
        <>
          <div className="desk-inspector-head">
            <span className="min-w-0 truncate font-medium">{inspected.name}</span>
            <span className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn-quiet"
                aria-pressed={isPinned}
                onClick={() => onTogglePin(inspected)}
              >
                {isPinned ? "Unpin" : "Pin"}
              </button>
              <DevCharacterButton characterId={inspected.characterId} name={inspected.name} />
            </span>
          </div>

          <div className="tab-bar" role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={t === tab}
                data-active={t === tab}
                className="tab-item"
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="desk-inspector-body">
            {loading && <p className="p-3 text-sm text-muted">Loading…</p>}
            {error && <p className="p-3 text-sm form-error">{error}</p>}
            {data && (tab === "Sheet" || tab === "Tags") && (
              <SheetView data={data} tab={tab} tagsById={tagsById} currentTurnNumber={currentTurnNumber} />
            )}
            {data && tab === "Archive" && <ArchiveView data={data} />}
            {data && tab === "DMs" && <DmsView data={data} />}
          </div>
        </>
      )}
    </aside>
  );
}
