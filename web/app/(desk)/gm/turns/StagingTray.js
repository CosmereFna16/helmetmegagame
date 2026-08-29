"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useRefresh } from "@/app/components/useRefresh";
import { StagedEffectRow, StagedMessageRow } from "./StagedItems";
import EffectComposer from "./EffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import { retargetMissedStaging } from "./actions";
import { tagNameLookup } from "./stagedFormat";

// The bottom tray: everything queued for the push, in one honest list —
// including rows detached from a rejected Move, mass-apply batches, and the
// missed-push banner for rows a resolved turn's push never carried. The
// unattached composers live here too: not every message narrates a Move.

const KIND_FILTERS = [
  { value: "all", label: "All" },
  { value: "effects", label: "Effects" },
  { value: "messages", label: "Messages" },
  { value: "public", label: "Public" },
];

function matchesQuery(needle, ...haystacks) {
  if (!needle) return true;
  return haystacks.some((h) => h && String(h).toLowerCase().includes(needle));
}

// An effect row matches on target, staging GM, or any of its staged tags.
function effectMatches(effect, query, tagNames) {
  const tagLabels = (effect.tagOps ?? []).map((t) => tagNames.get(t.tagId) ?? "");
  return matchesQuery(query, effect.targetName, effect.createdByUsername, ...tagLabels);
}

// A message matches on any recipient, its content, the staging GM, or a
// public post's zone.
function messageMatches(message, query) {
  const recipientNames = (message.recipients ?? []).map((r) => r.name);
  return matchesQuery(query, message.content, message.createdByUsername, message.zoneName, ...recipientNames);
}

function batchMatches(group, query, tagNames) {
  return group.some((e) => effectMatches(e, query, tagNames));
}

export default function StagingTray({
  stagedEffects,
  stagedMessages,
  moves,
  roster,
  presenceZones,
  tagCatalog,
  onInspect,
  onOpenPreview,
  open,
  setOpen,
  expanded,
  setExpanded,
  revealSignal,
  gmProfiles,
}) {
  const [refresh] = useRefresh();
  const confirm = useConfirm();
  const [composer, setComposer] = useState(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("all"); // "all" | "effects" | "messages" | "public"
  const [pending, startTransition] = useTransition();

  const tagNames = useMemo(() => tagNameLookup(tagCatalog), [tagCatalog]);
  const normalizedQuery = query.trim().toLowerCase();

  function toggleExpand() {
    setExpanded((e) => {
      const next = !e;
      if (next) setOpen(true);
      return next;
    });
  }

  // The interactive push preview's click-through: Workspace flips open+
  // expanded and bumps revealSignal in one go, so by the time this effect
  // runs the row is in the DOM. Pure DOM work (scroll + a class toggled off
  // by its own timeout) — no state, so it's safe past the mount that just
  // opened the tray.
  useEffect(() => {
    if (!revealSignal?.id) return undefined;
    const el = document.querySelector(`[data-row-id="${revealSignal.id}"]`);
    if (!el) return undefined;
    el.scrollIntoView({ block: "center" });
    el.classList.add("desk-flash");
    const timeout = setTimeout(() => el.classList.remove("desk-flash"), 1200);
    return () => clearTimeout(timeout);
  }, [revealSignal]);

  const pendingEffects = stagedEffects.filter((e) => !e.applied && !e.missed);
  const pendingPrivate = stagedMessages.filter((m) => !m.sent && !m.missed && m.kind === "PRIVATE");
  const pendingPublic = stagedMessages.filter((m) => !m.sent && !m.missed && m.kind === "PUBLIC");
  const missedEffects = stagedEffects.filter((e) => e.missed);
  const missedMessages = stagedMessages.filter((m) => m.missed);

  const solvedCount = moves.filter((m) => m.statusLabel === "Solved").length;
  const openCount = moves.filter((m) => m.statusLabel === "Open").length;

  // Batches collapse to one line each; singles render as themselves.
  const effectGroups = useMemo(() => {
    const byBatch = new Map();
    const singles = [];
    for (const e of stagedEffects) {
      if (!e.batchId) {
        singles.push(e);
        continue;
      }
      const group = byBatch.get(e.batchId) ?? [];
      group.push(e);
      byBatch.set(e.batchId, group);
    }
    return { batches: [...byBatch.values()], singles };
  }, [stagedEffects]);

  const showEffects = kindFilter === "all" || kindFilter === "effects";
  const showPrivate = kindFilter === "all" || kindFilter === "messages";
  const showPublic = kindFilter === "all" || kindFilter === "public";

  const filteredBatches = showEffects
    ? effectGroups.batches.filter((group) => batchMatches(group, normalizedQuery, tagNames))
    : [];
  const filteredSingles = showEffects
    ? effectGroups.singles.filter((e) => effectMatches(e, normalizedQuery, tagNames))
    : [];
  const filteredMessages = stagedMessages.filter((m) => {
    if (m.kind === "PUBLIC" ? !showPublic : !showPrivate) return false;
    return messageMatches(m, normalizedQuery);
  });

  const totalRows = effectGroups.batches.length + effectGroups.singles.length + stagedMessages.length;
  const shownRows = filteredBatches.length + filteredSingles.length + filteredMessages.length;
  const filtering = Boolean(normalizedQuery) || kindFilter !== "all";

  async function retargetAll() {
    const ok = await confirm({
      title: "Carry the missed staging forward?",
      message: `${missedEffects.length + missedMessages.length} row(s) move onto the current turn and go out with the next push.`,
      confirmLabel: "Carry forward",
      cancelLabel: "Leave them",
    });
    if (!ok) return;
    startTransition(async () => {
      await retargetMissedStaging({
        effectIds: missedEffects.map((e) => e.id),
        messageIds: missedMessages.map((m) => m.id),
      });
      refresh();
    });
  }

  return (
    <section className="desk-tray" data-open={open || undefined} data-expanded={expanded || undefined}>
      <div className="desk-tray-bar">
        <button type="button" className="desk-tray-bar-toggle" onClick={() => setOpen((o) => !o)}>
          <span className="flex flex-wrap items-center gap-3 text-sm">
            <strong>Push tray</strong>
            <span className="mono">{pendingPrivate.length} ✉</span>
            <span className="mono">{pendingEffects.length} effects</span>
            <span className="mono">{pendingPublic.length} public</span>
            <span className="text-muted">
              {solvedCount} solved · {openCount} open{openCount ? " (will close silently)" : ""}
            </span>
            {missedEffects.length + missedMessages.length > 0 && (
              <span className="form-error">
                {missedEffects.length + missedMessages.length} missed last push
              </span>
            )}
          </span>
          {/* "show/hide" rather than "expand", so it doesn't read as a second
              copy of the full-screen Expand button sitting right beside it. */}
          <span className="text-xs text-muted">{open ? "▾ hide" : "▴ show"}</span>
        </button>
        <button type="button" className="btn-quiet" onClick={toggleExpand}>
          {expanded ? "⤡ Shrink" : "⤢ Expand"}
        </button>
      </div>

      {open && (
        <div className="desk-tray-body">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-quiet" onClick={() => setComposer("effect")}>
              + Effect
            </button>
            <button type="button" className="btn-quiet" onClick={() => setComposer("message")}>
              + Message
            </button>
            <button type="button" className="btn-quiet" onClick={() => setComposer("public")}>
              + Public
            </button>
            <button type="button" className="btn-quiet" onClick={onOpenPreview}>
              Preview push
            </button>
            {missedEffects.length + missedMessages.length > 0 && (
              <button type="button" className="btn" onClick={retargetAll} disabled={pending}>
                Carry missed rows forward
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="field" style={{ width: "14rem" }}>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter staged rows…"
              />
            </label>
            <div className="segmented">
              {KIND_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={kindFilter === f.value}
                  onClick={() => setKindFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {filtering && (
              <span className="text-xs text-muted">
                {shownRows} of {totalRows} shown
              </span>
            )}
          </div>

          {filteredBatches.map((group) => (
            <div key={group[0].batchId} className="desk-tray-batch">
              <p className="text-xs text-muted">
                Mass apply · {group.length} targets · {group.map((g) => g.targetName).join(", ")}
              </p>
              <StagedEffectRow
                effect={group[0]}
                tagNames={tagNames}
                tagCatalog={tagCatalog}
                roster={roster}
                presenceZones={presenceZones}
                onInspect={onInspect}
                gmProfiles={gmProfiles}
                showBatch
              />
            </div>
          ))}
          {filteredSingles.map((e) => (
            <StagedEffectRow
              key={e.id}
              effect={e}
              tagNames={tagNames}
              tagCatalog={tagCatalog}
              roster={roster}
              presenceZones={presenceZones}
              onInspect={onInspect}
              gmProfiles={gmProfiles}
            />
          ))}
          {filteredMessages.map((m) => (
            <StagedMessageRow
              key={m.id}
              message={m}
              roster={roster}
              presenceZones={presenceZones}
              onInspect={onInspect}
              gmProfiles={gmProfiles}
            />
          ))}
          {stagedEffects.length + stagedMessages.length === 0 && (
            <p className="text-sm text-muted">Nothing staged for this turn yet.</p>
          )}
          {stagedEffects.length + stagedMessages.length > 0 && shownRows === 0 && (
            <p className="text-sm text-muted">Nothing matches that filter.</p>
          )}
        </div>
      )}

      {composer === "effect" && (
        <EffectComposer
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          onDone={() => {
            setComposer(null);
            refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "message" && (
        <MessageComposer
          roster={roster}
          onDone={() => {
            setComposer(null);
            refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "public" && (
        <PublicComposer
          zones={presenceZones}
          onDone={() => {
            setComposer(null);
            refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
    </section>
  );
}
