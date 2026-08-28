"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import TagChip from "@/app/components/TagChip";
import FactionLink from "@/app/components/FactionLink";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import MarkdownContent from "@/app/components/MarkdownContent";
import FormError from "@/app/components/FormError";
import DmThread from "@/app/components/DmThread";
import ArchiveContextModal from "./ArchiveContextModal";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { getCharacterInspector, getArchiveSlice, createStagedEffects } from "./actions";
import { getDmThreadPage, sendGmDm } from "@/app/(desk)/gm/players/actions";

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
        tab === "Archive" ? getArchiveSlice : tab === "DMs" ? getDmThreadPage : getCharacterInspector;
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

// A Sheet fact that stages a delta at click — Resources and Tag points are
// the only two, because those are the two `createStagedEffects` payload
// numbers. `onStage` does the server call; this component only owns the
// small input + error state.
function StagedDeltaFact({ display, pendingSuffix, onStage, disabled }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        type="button"
        className="desk-fact-editable mono text-sm"
        title="Stages a change for the turn-end push"
        disabled={disabled}
        onClick={() => {
          setValue("");
          setError(null);
          setEditing(true);
        }}
      >
        {display}
        {pendingSuffix && <span className="desk-fact-pending">{pendingSuffix}</span>}
      </button>
    );
  }

  function submit() {
    const delta = Number.parseInt(value, 10);
    if (!Number.isInteger(delta) || delta === 0) return;
    startTransition(async () => {
      const res = await onStage(delta);
      if (res?.ok) {
        setEditing(false);
      } else {
        setError(res?.error ?? "Couldn't stage that.");
      }
    });
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1">
        <input
          className="mono text-sm"
          style={{ width: "5rem" }}
          value={value}
          placeholder="±0"
          autoFocus
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button type="button" className="btn-quiet" disabled={pending} onClick={submit}>
          Stage
        </button>
        <button type="button" className="btn-quiet" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </span>
      {error && <FormError>{error}</FormError>}
    </span>
  );
}

function SheetView({ data, tab, tagsById, currentTurnNumber, characterId, pending, router }) {
  async function stageResources(delta) {
    const res = await createStagedEffects({ targetCharacterIds: [characterId], resources: delta });
    if (res?.ok) router.refresh();
    return res;
  }

  async function stageTagPoints(delta) {
    const res = await createStagedEffects({ targetCharacterIds: [characterId], tagPoints: delta });
    if (res?.ok) router.refresh();
    return res;
  }

  async function removeTag(tagId) {
    const res = await createStagedEffects({ targetCharacterIds: [characterId], tagOps: [{ tagId, op: "remove" }] });
    if (res?.ok) router.refresh();
    return res;
  }

  if (tab === "Tags") {
    return (
      <div className="flex flex-wrap gap-1.5 p-3">
        {data.tags.length ? (
          data.tags.map((ct) => {
            const isPendingRemove = pending?.removes?.has(ct.tagId);
            return (
              <span key={ct.tagId} className={`flex items-center gap-1 ${isPendingRemove ? "desk-chip-pending" : ""}`}>
                <TagChip
                  tag={ct.tag ?? tagsById[ct.tagId]}
                  quantity={ct.quantity}
                  expiresTurn={ct.expiresTurn}
                  currentTurn={currentTurnNumber ?? data.currentTurnNumber}
                />
                {isPendingRemove ? (
                  <span className="text-xs text-muted">staged −</span>
                ) : (
                  <button
                    type="button"
                    className="desk-chip-x"
                    aria-label={`Stage removing ${ct.tag?.name ?? tagsById[ct.tagId]?.name ?? "tag"}`}
                    onClick={() => removeTag(ct.tagId)}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })
        ) : (
          <p className="text-sm text-muted">No tags.</p>
        )}
      </div>
    );
  }

  const resourcesSuffix = pending?.resources
    ? ` ${pending.resources > 0 ? "+" : "−"}${Math.abs(pending.resources)} ⬢ staged`
    : null;
  const tagPointsSuffix = pending?.tagPoints
    ? ` ${pending.tagPoints > 0 ? "+" : "−"}${Math.abs(pending.tagPoints)} tp staged`
    : null;

  const facts = [
    ["Status", data.status],
    ["Role", data.roleTitle ?? "—"],
    ["Faction", <FactionLink key="f" factionId={data.factionId} name={data.factionName ?? "—"} />],
    ["Zone", data.locationLabel],
    [
      "Resources",
      <StagedDeltaFact
        key="resources"
        display={`${data.resources} ⬢`}
        pendingSuffix={resourcesSuffix}
        onStage={stageResources}
      />,
    ],
    [
      "Tag points",
      <StagedDeltaFact
        key="tagPoints"
        display={String(data.tagPoints)}
        pendingSuffix={tagPointsSuffix}
        onStage={stageTagPoints}
      />,
    ],
    ["Gambit", data.gambitModifier > 0 ? `+${data.gambitModifier}` : String(data.gambitModifier)],
    ["Acted", data.acted ? "yes" : "no"],
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

function ArchiveView({ data, onOpenContext }) {
  if (!data.entries.length) return <p className="p-3 text-sm text-muted">Nothing in the transcript.</p>;
  return (
    <div className="flex flex-col gap-3 p-3">
      {data.entries.map((e) => {
        const row = (
          <>
            <p className="text-xs text-muted">
              {e.concealedAlias ? `${e.concealedAlias} (${e.characterName})` : e.characterName}
              {e.zoneName ? ` · ${e.zoneName}` : ""}
              {e.turnNumber != null ? ` · turn ${e.turnNumber}` : ""}
            </p>
            <div className="text-sm">
              <MarkdownContent content={e.content} />
            </div>
          </>
        );
        if (e.kind !== "MESSAGE") return <div key={e.id}>{row}</div>;
        return (
          <button
            key={e.id}
            type="button"
            className="desk-archive-row"
            onClick={() => onOpenContext(e.id)}
          >
            {row}
          </button>
        );
      })}
    </div>
  );
}

// A thin wrapper over the shared DmThread — the same component the
// /gm/messages inbox uses (compact, for the Inspector's narrower column).
// The fetch/send/cache plumbing is still this file's job (Workspace owns the
// cache), but the thread rendering and the reply form are no longer a
// bespoke second implementation.
function DmsView({ data, characterId, cacheKey, setCache }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  function loadOlder() {
    const oldest = data.messages[0];
    if (!oldest) return;
    startTransition(async () => {
      const res = await getDmThreadPage({
        characterId,
        beforeMs: new Date(oldest.createdAt).getTime(),
        beforeId: oldest.id,
      });
      if (res?.ok) {
        setCache((prev) =>
          new Map(prev).set(cacheKey, {
            data: { ...res, messages: [...res.messages, ...data.messages], hasMore: res.hasMore },
          }),
        );
      }
    });
  }

  function send() {
    const content = draft.trim();
    if (!content) return;
    setError(null);
    startTransition(async () => {
      const res = await sendGmDm({ characterId, content, source: "gm_inspector" });
      if (res?.ok) {
        setDraft("");
        setCache((prev) => new Map(prev).set(cacheKey, { data: res }));
      } else {
        setError(res?.error ?? "Couldn't send that.");
      }
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-y-auto">
        <DmThread messages={data.messages} onLoadOlder={loadOlder} hasMore={data.hasMore} compact />
      </div>
      <div className="field border-t p-3" style={{ borderColor: "var(--border)" }}>
        <textarea
          rows={2}
          maxLength={GM_MESSAGE_MAX_LENGTH}
          value={draft}
          placeholder="Write a message…"
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
        />
        <FormError>{error}</FormError>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-xs text-muted">Sends now, » prefixed — not staged.</span>
          <button type="button" className="btn" disabled={pending || !draft.trim()} onClick={send}>
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
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
  pendingByCharacter,
  onOpenDev,
}) {
  const router = useRouter();
  const [tab, setTab] = useState("Sheet");
  const [contextEntry, setContextEntry] = useState(null);
  const { data, error, loading } = useInspectorData(inspected?.characterId ?? null, tab, cache, setCache);

  const isPinned = pinned.some((p) => p.characterId === inspected?.characterId);
  const pending = pendingByCharacter?.get(inspected?.characterId);
  const cacheKey = inspected ? `${inspected.characterId}:DMs` : null;

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
              <DevCharacterButton
                characterId={inspected.characterId}
                name={inspected.name}
                onOpen={() => onOpenDev?.(inspected.characterId, inspected.name)}
              />
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
              <SheetView
                data={data}
                tab={tab}
                tagsById={tagsById}
                currentTurnNumber={currentTurnNumber}
                characterId={inspected.characterId}
                pending={pending}
                router={router}
              />
            )}
            {data && tab === "Archive" && <ArchiveView data={data} onOpenContext={setContextEntry} />}
            {data && tab === "DMs" && (
              <DmsView data={data} characterId={inspected.characterId} cacheKey={cacheKey} setCache={setCache} />
            )}
          </div>
        </>
      )}
      {contextEntry && (
        <ArchiveContextModal key={contextEntry} archiveEntryId={contextEntry} onClose={() => setContextEntry(null)} />
      )}
    </aside>
  );
}
