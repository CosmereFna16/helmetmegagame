"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import TagChip from "./TagChip";
import { useRefresh } from "./useRefresh";
import FactionLink from "./FactionLink";
import DevCharacterButton from "./DevCharacterButton";
import MarkdownContent from "./MarkdownContent";
import FormError from "./FormError";
import DmThread from "./DmThread";
import ArchiveContextModal from "./ArchiveContextModal";
import CustomTagDialog from "./CustomTagDialog";
import Tooltip from "./Tooltip";
import useSubmitOnEnter from "./useSubmitOnEnter";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import {
  getCharacterInspector,
  getArchiveSlice,
  getCharacterMoveHistory,
  createStagedEffects,
} from "@/app/(desk)/gm/turns/actions";
import { getDmThreadPage, sendGmDm } from "@/app/(desk)/gm/players/actions";
import { scoreMatch } from "@/lib/fuzzySearch";

// The right-hand inspector: the "quickly pull up the guy he was talking to"
// column. Sheet / Tags / Moves / Archive / DMs over whichever character was
// last clicked anywhere in the workspace, with a pin row so the characters an
// arbitration keeps returning to stay one click away.
//
// Both /gm/turns (Workspace.js) and /gm/players (InspectorHost.js) mount it;
// desk-specific sections arrive through `tabPreludes` rather than a tab of
// their own. Fetches are on-demand server actions cached in the
// Workspace-owned Map for the life of the page view.

const BASE_TABS = ["Sheet", "Tags", "Moves", "Archive", "DMs"];

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
        tab === "Archive"
          ? getArchiveSlice
          : tab === "DMs"
            ? getDmThreadPage
            : tab === "Moves"
              ? getCharacterMoveHistory
              : getCharacterInspector;
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
    loading: Boolean(key) && !entry,
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

// Gunboat's words, verbatim, on every custom-tag door.
const CUSTOM_TAG_TOOLTIP =
  "Use this for things that would affect adjudications—not just little bracelets or something.";

function SheetView({
  data,
  tab,
  tagsById,
  currentTurnNumber,
  characterId,
  characterName,
  pending,
  refresh,
  customTag,
}) {
  const [creatingTag, setCreatingTag] = useState(false);
  async function stageResources(delta) {
    const res = await createStagedEffects({ targetCharacterIds: [characterId], resources: delta });
    if (res?.ok) refresh();
    return res;
  }

  async function stageTagPoints(delta) {
    const res = await createStagedEffects({ targetCharacterIds: [characterId], tagPoints: delta });
    if (res?.ok) refresh();
    return res;
  }

  const [, startTagTransition] = useTransition();
  function removeTag(tagId) {
    startTagTransition(async () => {
      const res = await createStagedEffects({ targetCharacterIds: [characterId], tagOps: [{ tagId, op: "remove" }] });
      if (res?.ok) refresh();
    });
  }

  if (tab === "Tags") {
    return (
      <div className="flex flex-wrap gap-1.5 p-3">
        {/* The custom-tag door. The desk decides whether it stages or grants
            (the adjudication desk is mid-push, so it defaults to staging);
            the dialog itself is the one shared component behind every door. */}
        {customTag && (
          <div className="flex w-full justify-end">
            <Tooltip text={CUSTOM_TAG_TOOLTIP}>
              <button type="button" className="btn-quiet" onClick={() => setCreatingTag(true)}>
                + Custom tag
              </button>
            </Tooltip>
          </div>
        )}
        {creatingTag && customTag && (
          <CustomTagDialog
            categories={customTag.categories ?? []}
            groups={customTag.groups}
            tags={customTag.tags ?? []}
            characters={[{ id: characterId, name: characterName ?? "this character" }]}
            defaultAssignIds={[characterId]}
            mode={customTag.mode ?? "apply"}
            allowStage
            onClose={() => setCreatingTag(false)}
            onCreated={() => {
              setCreatingTag(false);
              // The grant (or the staged row) landed server-side; the desk
              // reload is what brings it back into this tab.
              refresh();
            }}
          />
        )}
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

// "What has this person actually been doing?" — their Moves on turns that
// have already been pushed, newest first. PAST turns only: on the player desk
// the Canon prelude above already owns this turn, and on the adjudication desk
// the open turn is the queue itself, so this view is the part neither of them
// covers. Each row deep-links the read-only history desk.
function MovesView({ data }) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="field-label">Past turns</p>
      {!data.rows.length && <p className="text-sm text-muted">Nothing on any past turn.</p>}
      {data.rows.map((r) => (
        <Link key={r.id} href={`/gm/turns/history/${r.id}`} className="desk-archive-row">
          <p className="text-xs text-muted">
            Turn {r.turnLabel} · {r.kindLabel} · {r.reviewLabel}
            {r.rollLabel ? ` · ${r.rollLabel}` : ""}
          </p>
          {(r.declaredLabel || r.paidLabel) && (
            <p className="mono text-xs text-muted">
              {r.declaredLabel ? `declared ${r.declaredLabel}` : ""}
              {r.declaredLabel && r.paidLabel ? " · " : ""}
              {r.paidLabel ? `paid ${r.paidLabel}` : ""}
            </p>
          )}
          <p className="text-sm">{r.description}</p>
          {r.resultMessage && <p className="text-sm text-muted">Result: {r.resultMessage}</p>}
          {r.messages.map((m) => (
            <p key={m.id} className="text-xs text-muted">
              » {m.content}
              {m.recipientNames.length ? ` — to ${m.recipientNames.join(", ")}` : ""}
            </p>
          ))}
        </Link>
      ))}
    </div>
  );
}

function ArchiveView({ data, onOpenContext, characterId, cacheKey, setCache }) {
  const [pending, startTransition] = useTransition();

  function loadOlder() {
    const oldest = data.entries[0];
    if (!oldest) return;
    startTransition(async () => {
      const res = await getArchiveSlice({
        characterId,
        beforeMs: new Date(oldest.sentAt).getTime(),
        beforeId: oldest.id,
      });
      if (res?.ok) {
        setCache((prev) =>
          new Map(prev).set(cacheKey, {
            data: { entries: [...res.entries, ...data.entries], hasMore: res.hasMore },
          }),
        );
      }
    });
  }

  if (!data.entries.length) return <p className="p-3 text-sm text-muted">Nothing in the transcript.</p>;
  return (
    <div className="flex flex-col gap-3 p-3">
      {data.hasMore && (
        <button type="button" className="btn-quiet self-center" disabled={pending} onClick={loadOlder}>
          {pending ? "Loading…" : "Load older"}
        </button>
      )}
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
// The fetch/send/cache plumbing is this file's job (Workspace owns the
// cache); DmThread owns the rendering and the reply form.
function DmsView({ data, characterId, cacheKey, setCache }) {
  const [draft, setDraft] = useState("");
  const draftOver = draft.length > GM_MESSAGE_MAX_LENGTH;
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();
  // Not inside a <form> — the hook's callback form fires `send` directly
  // instead of calling requestSubmit() on a form that doesn't exist here.
  const onKeyDown = useSubmitOnEnter(send);

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
    // Same guards as the Send button's own `disabled` — Enter must not be
    // able to do what the button refuses.
    if (pending || draftOver) return;
    const content = draft.trim();
    if (!content) return;
    setError(null);
    startTransition(async () => {
      const res = await sendGmDm({ characterId, content, source: "gm_inspector" });
      if (res?.ok) {
        setDraft("");
        // sendGmDm also returns a fresh tail page; the inspector's thread is a
        // short compact view, so appending the one written row is enough here.
        setCache((prev) =>
          new Map(prev).set(cacheKey, {
            data: { ...data, messages: [...data.messages, res.message].filter(Boolean) },
          }),
        );
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
        {/* No maxLength: a long paste stays visible and trimmable rather than
            being silently cut. Over the cap, Send just refuses. */}
        <textarea
          rows={2}
          value={draft}
          placeholder="Write a message…"
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <FormError>{error}</FormError>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={draftOver ? "text-xs text-danger" : "text-xs text-muted"}>
            {draftOver
              ? `${draft.length} / ${GM_MESSAGE_MAX_LENGTH} — too long to send.`
              : "Sends now, » prefixed — not staged."}
          </span>
          <button type="button" className="btn" disabled={pending || !draft.trim() || draftOver} onClick={send}>
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

const SEARCH_RESULT_LIMIT = 8;

// The "look someone up without leaving the desk" box, sitting above the pin
// row. Filters the roster page.js already ships to the client with scoreMatch
// (web/lib/fuzzySearch.js) over name, role, faction, username and zone.
function InspectorSearch({ roster, onInspect }) {
  const [query, setQuery] = useState("");

  const results = query.trim()
    ? roster
        .map((c) => ({
          character: c,
          match: scoreMatch(query, {
            name: c.name,
            role: c.roleTitle,
            faction: c.factionName,
            username: c.username,
            zone: c.zoneName,
          }),
        }))
        .filter((r) => r.match)
        .sort((a, b) => b.match.score - a.match.score)
        .slice(0, SEARCH_RESULT_LIMIT)
    : [];

  const pick = (c) => {
    onInspect(c.id, c.name);
    setQuery("");
  };

  return (
    <div className="desk-inspector-search">
      <input
        type="text"
        className="control"
        placeholder="Look up a character…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
      />
      {results.length > 0 && (
        <ul className="desk-inspector-search-results">
          {results.map(({ character: c, match }) => (
            <li key={c.id}>
              <button type="button" className="btn-quiet" onClick={() => pick(c)}>
                <span className="truncate">{c.name}</span>
                {match.matchedField !== "name" && (
                  <span className="text-xs text-muted">
                    {match.matchedField === "username" && c.username
                      ? `@${c.username}`
                      : match.matchedField === "role"
                        ? c.roleTitle
                        : match.matchedField === "faction"
                          ? c.factionName
                          : c.zoneName}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function InspectorColumn({
  inspected,
  pinned,
  roster,
  onInspect,
  onTogglePin,
  cache,
  setCache,
  tagsById,
  currentTurnNumber,
  pendingByCharacter,
  onOpenDev,
  // Desk-specific sections rendered ABOVE a base tab's own body:
  // { [tabKey]: (ctx) => node }, ctx being { inspected, currentTurnNumber,
  // refresh }. A prelude owns its own fetching and never takes a slot in the
  // shared per-(character, tab) cache.
  tabPreludes = {},
  // Buttons that belong beside the pins (the player desk's "Message pinned").
  pinsActions = null,
  emptyHint,
  // { mode, categories, tags, groups } — omit to hide the custom-tag door.
  customTag = null,
  // { tab, token } — a desk asking the column to jump to a tab ("Past moves"
  // lands on Moves). A request, not a controlled value: it is honoured once
  // and then the GM is free to click away.
  requestedTab = null,
}) {
  const [refresh] = useRefresh();
  // Which tab is showing, plus the token of the last request honoured — one
  // piece of state so a new request is applied DURING render rather than from
  // an effect (react-hooks/set-state-in-effect is an error in this repo).
  // Same discipline InspectorHost uses for its `override`.
  const [tabState, setTabState] = useState({ tab: "Sheet", token: null });
  let current = tabState;
  if (requestedTab && requestedTab.token !== tabState.token) {
    current = { tab: requestedTab.tab, token: requestedTab.token };
    setTabState(current);
  }
  const tab = current.tab;
  const setTab = (next) => setTabState((s) => ({ ...s, tab: next }));
  const [contextEntry, setContextEntry] = useState(null);
  const { data, error, loading } = useInspectorData(inspected?.characterId ?? null, tab, cache, setCache);

  const isPinned = pinned.some((p) => p.characterId === inspected?.characterId);
  const pending = pendingByCharacter?.get(inspected?.characterId);
  const cacheKey = inspected ? `${inspected.characterId}:DMs` : null;
  const archiveCacheKey = inspected ? `${inspected.characterId}:Archive` : null;
  const inspectedRoster = roster?.find((c) => c.id === inspected?.characterId);
  const inspectedUsername = inspectedRoster?.username;
  const inspectedRole = inspectedRoster?.roleTitle;

  return (
    <aside className="desk-inspector">
      {roster && <InspectorSearch roster={roster} onInspect={onInspect} />}
      {(pinned.length > 0 || pinsActions) && (
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
          {pinsActions}
        </div>
      )}

      {!inspected ? (
        <p className="p-4 text-sm text-muted">
          {emptyHint ??
            "Click any character name — in the queue, on the desk, in the tray — to look them up here without leaving the workspace."}
        </p>
      ) : (
        <>
          <div className="desk-inspector-head">
            <span className="min-w-0 flex flex-col">
              <span className="truncate">
                <span className="font-medium">{inspected.name}</span>
                {inspectedUsername && <span className="ml-1.5 text-xs text-muted">@{inspectedUsername}</span>}
              </span>
              {inspectedRole && <span className="text-xs text-muted truncate">{inspectedRole}</span>}
            </span>
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
            {BASE_TABS.map((t) => (
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
            {/* Above the branches on purpose: a prelude paints straight away
                instead of waiting on the base tab's fetch. */}
            {tabPreludes[tab]?.({ inspected, currentTurnNumber, refresh })}
            {loading && <p className="p-3 text-sm text-muted">Loading…</p>}
            {error && <p className="p-3 text-sm form-error">{error}</p>}
            {data && (tab === "Sheet" || tab === "Tags") && (
              <SheetView
                data={data}
                tab={tab}
                tagsById={tagsById}
                currentTurnNumber={currentTurnNumber}
                characterId={inspected.characterId}
                characterName={inspected.name}
                pending={pending}
                refresh={refresh}
                customTag={customTag}
              />
            )}
            {data && tab === "Moves" && <MovesView data={data} />}
            {data && tab === "Archive" && (
              <ArchiveView
                data={data}
                onOpenContext={setContextEntry}
                characterId={inspected.characterId}
                cacheKey={archiveCacheKey}
                setCache={setCache}
              />
            )}
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
