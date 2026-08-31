"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import FormError from "@/app/components/FormError";
import { useRefresh } from "@/app/components/useRefresh";
import Tooltip from "@/app/components/Tooltip";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useTags } from "@/app/components/TagsProvider";
import { resolveRequest, killRequestTarget } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import { SECTIONS } from "./RequestSections";

// A Request on the desk. Semantics unchanged from the old tab — Requests are
// apply-first: the effect already landed when the player filed it, and the
// GM's verdict is Confirm-with-edits or Undo, right now, not staged. Only
// the surface moved.

function Line({ label, children }) {
  return (
    <p className="text-sm">
      <span className="field-label" style={{ marginRight: 8 }}>
        {label}
      </span>
      {children}
    </p>
  );
}

export default function RequestDesk({ request, onInspect, onClose, registerEscape, onOpenDev }) {
  const [refresh] = useRefresh();
  const effect = request?.effect ?? {};
  const [edits, setEdits] = useState({
    resourcesSpent: String(effect.resourcesSpent ?? 0),
    pointsAwarded: String(effect.pointsAwarded ?? 0),
    bloodDelta: String(effect.bloodDelta ?? 0),
    removeTag: false,
    removeDrained: false,
    restoreHealedTag: false,
  });
  const [gmNotes, setGmNotes] = useState(request?.gmNotes ?? "");
  const [error, setError] = useState(null);
  const [killing, setKilling] = useState(false);
  const [touched, setTouched] = useState(false); // any real edit, not just gmNotes
  const [pending, startTransition] = useTransition();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();
  const confirm = useConfirm();
  // A Request's effect only snapshots tagId/tagName (REQUESTS.md §2 — Undo
  // reads off the snapshot, never live state), so a section that wants a
  // hoverable chip has to resolve the live catalog row itself. Read via
  // context here — a hook, so it can't be called from inside SECTIONS'
  // plain render() functions — and hand the lookup down.
  const { tagsById } = useTags();

  // The workspace's layered Escape deselects through the same dirty guard
  // as the Close button.
  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const section = SECTIONS[request.type];

  function setEdit(key, value) {
    markDirty();
    setTouched(true);
    setEdits((e) => ({ ...e, [key]: value }));
  }

  function run(mode) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await resolveRequest({ requestId: request.id, mode, edits, gmNotes });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        refresh();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  async function onKill() {
    setError(null);
    const ok = await confirm({
      title: `Kill ${effect.targetName ?? "this character"}?`,
      message:
        "This ends their game: the personal Discord role is deleted, the nickname cleared, and Cursed granted. It cannot be undone from here.",
      confirmLabel: "Kill them",
      cancelLabel: "Not yet",
    });
    if (!ok) return;

    setKilling(true);
    try {
      const res = await killRequestTarget({ requestId: request.id });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      refresh();
    } finally {
      setKilling(false);
    }
  }

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <CharacterAvatar
              characterId={request.characterId}
              name={request.characterName}
              version={request.avatarVersion}
              size={32}
            />
            <button
              type="button"
              className="desk-name"
              onClick={() => onInspect(request.characterId, request.characterName)}
            >
              {request.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({request.discordUsername})</span>
          </h2>
          <p className="text-xs text-muted">
            {request.roleTitle && <>{request.roleTitle} · </>}
            {request.typeLabel} · {request.turnLabel} · {request.statusLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {request.discordUserId && (
            <Link href={`/gm/players/${request.discordUserId}`} className="btn-quiet">
              Message →
            </Link>
          )}
          <DevCharacterButton
            characterId={request.characterId}
            name={request.characterName}
            onOpen={() => onOpenDev?.(request.characterId, request.characterName)}
          />
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      <div className="mt-3 flex flex-col gap-2">
        <Line label="Reason">{request.reason}</Line>
        <p className="text-xs text-muted">
          Requests are apply-first: this already happened. Your verdict lands now, not at the push.
          Most requests just need a glance — Mark reviewed and move on.
        </p>
      </div>

      {section && (
        <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="field-label">{section.heading}</h3>
          <div className="flex flex-col gap-3">
            {section.render({ effect, payload: request?.payload ?? {}, edits, setEdit, onKill, killing, tagsById })}
          </div>
        </div>
      )}

      <label className="field mt-4">
        <span className="field-label">GM notes</span>
        <textarea
          rows={2}
          value={gmNotes}
          onChange={(e) => {
            markDirty();
            setGmNotes(e.target.value);
          }}
        />
      </label>

      <FormError>{error}</FormError>

      {request.reviewedByUsername && (
        <p className="mt-3 text-xs text-muted">
          Reviewed by {request.reviewedByUsername}
          {request.reviewedAtLabel ? ` · ${request.reviewedAtLabel}` : ""}
        </p>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <Tooltip text="Reverse the change entirely and mark the request Undone">
          <button type="button" className="btn-quiet" onClick={() => run("undo")} disabled={pending}>
            Undo
          </button>
        </Tooltip>
        <Tooltip
          text={
            touched
              ? "Apply your edits — a real change marks the request Edited"
              : "Stamp it reviewed. With no edits it stays Passed."
          }
        >
          <button type="button" className="btn" onClick={() => run("confirm")} disabled={pending}>
            {pending ? "Working…" : touched ? "Save edits" : "Mark reviewed"}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
