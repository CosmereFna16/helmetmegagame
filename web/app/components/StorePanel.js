"use client";

import { useMemo, useState, useTransition } from "react";
import { useRefresh } from "@/app/components/useRefresh";
import PointBuy from "@/app/components/PointBuy";
import FormError from "@/app/components/FormError";
import { useConfirm } from "@/app/components/ConfirmProvider";
import {
  tagsById as buildTagsById,
  effectiveTotalCost,
} from "@/lib/characterCreation";
import { buyTags } from "@/app/(app)/store/actions";

// The mid-game tag store's cart + checkout button; everything else is
// PointBuy. Used to be the whole content of the /store page (StoreClient.js);
// it now mounts as the body of a Modal opened from the Tags panel of the
// character sheet, so a shopping trip never leaves the sheet. `onDone` closes
// that modal after a successful purchase — the buy action itself, and the
// server-side re-checks behind it, are untouched (web/app/(app)/store/actions.js).
export default function StorePanel({ tags, budget, heldTags, onDone }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const [refresh] = useRefresh();

  // Same arithmetic as PointBuy's own readout and the server's re-check —
  // only used to keep the Buy button honest.
  const byId = useMemo(() => buildTagsById(tags), [tags]);
  const heldIds = useMemo(() => heldTags.map((t) => t.id), [heldTags]);
  const selected = tags.filter((t) => selectedIds.includes(t.id));
  const total = effectiveTotalCost(selected, byId, heldIds);
  const blocked = pending || selected.length === 0 || total > budget;

  const checkout = async () => {
    setError("");
    const ok = await confirm({
      title: "Confirm purchase",
      message:
        total < 0
          ? `Take ${selected.length} tag${selected.length === 1 ? "" : "s"} and gain ${-total} Tag Point${-total === 1 ? "" : "s"}? It applies immediately, can't be removed later, and a GM reviews it afterwards.`
          : `Buy ${selected.length} tag${selected.length === 1 ? "" : "s"} for ${total} Tag Point${total === 1 ? "" : "s"}? It applies immediately, and a GM reviews it afterwards.`,
      confirmLabel: "Buy",
    });
    if (!ok) return;
    startTransition(async () => {
      const result = await buyTags({ tagIds: selectedIds });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelectedIds([]);
      refresh();
      onDone?.();
    });
  };

  // No negativeCap/negativeHeld: the drawback cap is a CHARACTER CREATION
  // rule (TAGS.md §4a) and stops existing once play starts. The store used to
  // pass it as a read-only readout on the assumption that no drawback was ever
  // purchasableAfterStart; the Addictions are the deliberate exception, and a
  // cap the store neither enforces nor can move is noise on the shelf.
  // PointBuy renders nothing at all for a null cap.
  return (
    <PointBuy
      tags={tags}
      budget={budget}
      grantedTags={heldTags}
      afterStartOnly
      selectedIds={selectedIds}
      onChange={setSelectedIds}
      actions={
        <div className="flex flex-col gap-2">
          <button type="button" className="btn" disabled={blocked} onClick={checkout}>
            {pending ? "Buying…" : selected.length ? `Buy for ${total} points` : "Buy"}
          </button>
          <FormError>{error}</FormError>
        </div>
      }
    />
  );
}
