"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/components/ConfirmProvider";
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

export default function StagingTray({
  stagedEffects,
  stagedMessages,
  moves,
  roster,
  zones,
  tagCatalog,
  onInspect,
  onOpenPreview,
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [composer, setComposer] = useState(null);
  const [pending, startTransition] = useTransition();

  const tagNames = useMemo(() => tagNameLookup(tagCatalog), [tagCatalog]);

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
      router.refresh();
    });
  }

  return (
    <section className="desk-tray" data-open={open || undefined}>
      <button type="button" className="desk-tray-bar" onClick={() => setOpen((o) => !o)}>
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
        <span className="text-xs text-muted">{open ? "▾ collapse" : "▴ expand"}</span>
      </button>

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

          {effectGroups.batches.map((group) => (
            <div key={group[0].batchId} className="desk-tray-batch">
              <p className="text-xs text-muted">
                Mass apply · {group.length} targets · {group.map((g) => g.targetName).join(", ")}
              </p>
              <StagedEffectRow
                effect={group[0]}
                tagNames={tagNames}
                tagCatalog={tagCatalog}
                roster={roster}
                onInspect={onInspect}
                showBatch
              />
            </div>
          ))}
          {effectGroups.singles.map((e) => (
            <StagedEffectRow
              key={e.id}
              effect={e}
              tagNames={tagNames}
              tagCatalog={tagCatalog}
              roster={roster}
              onInspect={onInspect}
            />
          ))}
          {stagedMessages.map((m) => (
            <StagedMessageRow key={m.id} message={m} roster={roster} zones={zones} onInspect={onInspect} />
          ))}
          {stagedEffects.length + stagedMessages.length === 0 && (
            <p className="text-sm text-muted">Nothing staged for this turn yet.</p>
          )}
        </div>
      )}

      {composer === "effect" && (
        <EffectComposer
          roster={roster}
          tagCatalog={tagCatalog}
          onDone={() => {
            setComposer(null);
            router.refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "message" && (
        <MessageComposer
          roster={roster}
          onDone={() => {
            setComposer(null);
            router.refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "public" && (
        <PublicComposer
          zones={zones}
          onDone={() => {
            setComposer(null);
            router.refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
    </section>
  );
}
