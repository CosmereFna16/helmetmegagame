"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FormError from "@/app/components/FormError";
import TagChip from "@/app/components/TagChip";
import Tooltip from "@/app/components/Tooltip";
import RequestDialog from "@/app/components/RequestDialog";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import useMoveLock from "./useMoveLock";
import EffectComposer from "./EffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import { resolveMove, rejectMove } from "./actions";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";

// The arbitration desk for one Move. Everything a GM does here STAGES: the
// Result box is the canon of what happened (GM-facing, one field — gmNotes
// carries machine markers only and never renders), the composers queue
// messages and effects, and Solve marks the staging complete. Nothing
// touches the player until the turn-end push. The two exceptions are Unlock
// (the old Reject — deletes the Move, frees the turn, tells them now) and
// the lock this desk claims so two GMs don't work the same row.

const OPPOSED_HELP =
  "Opposed moves negatively affect another player. Stage these once every party involved has locked in.";

const UNLOCK_HELP =
  "Deletes the Move and frees up their turn — the misclick escape hatch, or a Move that shouldn't have been one. They're DM'd the reason immediately.";

function Switch({ label, value, options, onChange, disabled, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label flex items-center gap-1.5">
        {label}
        {children}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            className={o.value === value ? "btn" : "btn-quiet"}
            aria-pressed={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// "+3 ⬢ declared" / "5–12 ⬢ declared, rolled +8"
function declaredLine(move) {
  const parts = [];
  if (move.resourceRollExpression) parts.push(`rolled ${move.resourceRollExpression.replace("-", "–")} ⬢`);
  if (move.resourceDelta != null) {
    parts.push(`${move.resourceDelta > 0 ? "+" : ""}${move.resourceDelta} ⬢`);
  }
  return parts.length ? parts.join(" → ") : null;
}

export default function MoveDesk({
  move,
  staged,
  tagsById,
  tagCatalog,
  roster,
  zones,
  currentTurnNumber,
  onInspect,
  onClose,
  registerEscape,
}) {
  const router = useRouter();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();
  const { locked, error: lockError } = useMoveLock(move.id);

  // The workspace's layered Escape deselects through the same dirty guard
  // as the Close button.
  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const [edits, setEdits] = useState({
    moveKind: move.moveKind,
    opposed: Boolean(move.opposed),
    resultMessage: move.resultMessage ?? "",
  });
  const [composer, setComposer] = useState(null); // "effect" | "message" | "public" | null
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const solved = move.statusLabel === "Solved";
  const disabled = pending || !locked;

  const setEdit = useCallback(
    (key, value) => {
      markDirty();
      setEdits((e) => ({ ...e, [key]: value }));
    },
    [markDirty],
  );

  function run(mode) {
    setError(null);
    startTransition(async () => {
      const res = await resolveMove({ actionId: move.id, mode, edits });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      router.refresh();
    });
  }

  function submitUnlock(reason) {
    setError(null);
    startTransition(async () => {
      const res = await rejectMove({ actionId: move.id, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      setUnlocking(false);
      if (res.deliveryFailed) {
        setError("Move unlocked — but they weren't told. Let them know they can act again.");
      } else {
        onClose();
      }
      router.refresh();
    });
  }

  const declared = declaredLine(move);

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">
            <button type="button" className="desk-name" onClick={() => onInspect(move.characterId, move.characterName)}>
              {move.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({move.discordUsername})</span>
          </h2>
          <p className="text-xs text-muted">
            {move.locationLabel} · {move.factionName || "No faction"} · {move.resources} ⬢ on hand
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DevCharacterButton characterId={move.characterId} name={move.characterName} />
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      {move.tags?.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {move.tags.map((t) =>
            tagsById[t.tagId] ? (
              <TagChip
                key={t.tagId}
                tag={tagsById[t.tagId]}
                quantity={t.quantity}
                expiresTurn={t.expiresTurn}
                currentTurn={currentTurnNumber}
              />
            ) : null,
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <blockquote className="desk-move-text">» {move.description}</blockquote>
        <div className="flex flex-wrap items-end gap-4">
          <Switch
            label="Kind"
            value={edits.moveKind}
            disabled={disabled}
            onChange={(v) => setEdit("moveKind", v)}
            options={[
              { value: "ROUTINE", label: "Routine" },
              { value: "GAMBIT", label: "Gambit" },
            ]}
          />
          <Switch
            label="Opposed"
            value={edits.opposed}
            disabled={disabled}
            onChange={(v) => setEdit("opposed", v)}
            options={[
              { value: false, label: "No" },
              { value: true, label: "Yes" },
            ]}
          >
            <Tooltip text={OPPOSED_HELP}>
              <span className="text-muted">?</span>
            </Tooltip>
          </Switch>
          <div className="flex flex-col gap-1">
            <span className="field-label">Dice</span>
            <span className="mono text-sm">{move.rollLabel || "—"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="field-label">Declared</span>
            <span className="mono text-sm">{declared ?? "—"}</span>
          </div>
        </div>
        {edits.moveKind !== move.moveKind && (
          <p className="text-xs text-accent">
            {edits.moveKind === "GAMBIT"
              ? "Saving rolls a fresh d6 and applies their current Mood and Hunger."
              : "Saving clears the roll — a Routine never carries one."}
          </p>
        )}
        {declared && (
          <p className="text-xs text-muted">
            Declared numbers pay out at the push whether or not you Solve. Disagree? Stage an
            offsetting effect below.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <label className="field">
          <span className="field-label">Result — the canon of what happened</span>
          <textarea
            rows={4}
            value={edits.resultMessage}
            disabled={disabled}
            maxLength={GM_MESSAGE_MAX_LENGTH}
            onChange={(e) => setEdit("resultMessage", e.target.value)}
            placeholder="What actually happened here. GM-facing — tell the players with staged messages below."
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this Move</h3>
          <div className="flex gap-2">
            <button type="button" className="btn-quiet" onClick={() => setComposer("effect")}>
              + Effect
            </button>
            <button type="button" className="btn-quiet" onClick={() => setComposer("message")}>
              + Message
            </button>
            <button type="button" className="btn-quiet" onClick={() => setComposer("public")}>
              + Public
            </button>
          </div>
        </div>

        <StagedItems
          effects={staged.effects}
          messages={staged.messages}
          tagCatalog={tagCatalog}
          roster={roster}
          zones={zones}
          onInspect={onInspect}
          empty="Nothing staged yet. Effects change sheets; messages land as DMs; public posts hit the summary channel — all at the push."
        />
      </div>

      {composer === "effect" && (
        <EffectComposer
          moveId={move.id}
          defaultTarget={{ id: move.characterId, name: move.characterName }}
          declaredDelta={move.resourceDelta ?? null}
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
          moveId={move.id}
          defaultRecipients={[{ characterId: move.characterId, name: move.characterName }]}
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
          moveId={move.id}
          zones={zones}
          onDone={() => {
            setComposer(null);
            router.refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {move.reviewedByUsername && (
        <p className="mt-3 text-xs text-muted">
          Solved by {move.reviewedByUsername}
          {move.reviewedAtLabel ? ` · ${move.reviewedAtLabel}` : ""}
        </p>
      )}

      {!locked && !lockError && <p className="mt-3 text-xs text-muted">Claiming this Move…</p>}
      <FormError>{error ?? lockError}</FormError>

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <Tooltip text={UNLOCK_HELP}>
          <button
            type="button"
            className="btn-danger"
            onClick={() => setUnlocking(true)}
            disabled={disabled}
          >
            Unlock
          </button>
        </Tooltip>

        {solved ? (
          <button type="button" className="btn" onClick={() => run("unsolve")} disabled={disabled}>
            {pending ? "Working…" : "Reopen"}
          </button>
        ) : (
          <>
            <button type="button" className="btn-quiet" onClick={() => run("save")} disabled={disabled}>
              Save
            </button>
            <Tooltip text="Marks the staging complete. Nothing applies until the push.">
              <button type="button" className="btn" onClick={() => run("solve")} disabled={disabled}>
                {pending ? "Working…" : "Solve"}
              </button>
            </Tooltip>
          </>
        )}
      </div>

      <RequestDialog
        open={unlocking}
        title={`Unlock ${move.characterName}'s Move`}
        submitLabel="Unlock it"
        busy={pending}
        onCancel={() => !pending && setUnlocking(false)}
        onConfirm={submitUnlock}
      >
        <p className="text-xs text-muted">
          The Move is deleted and their turn frees up. They&apos;re DM&apos;d this reason right away.
          Anything staged on it stays, detached, in the tray.
        </p>
      </RequestDialog>
    </div>
  );
}
