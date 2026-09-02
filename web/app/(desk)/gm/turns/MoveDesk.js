"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FormError from "@/app/components/FormError";
import { useRefresh } from "@/app/components/useRefresh";
import TagChip from "@/app/components/TagChip";
import Tooltip from "@/app/components/Tooltip";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import RequestDialog from "@/app/components/RequestDialog";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import useMoveLock from "./useMoveLock";
import EffectComposer from "./EffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import { resolveMove, rejectMove } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";
import { RESULT_BOX_MAX_LENGTH } from "@/lib/constants";
import { stagingReaches } from "@/lib/moveRows";

// The arbitration desk for one Move. Everything a GM does here STAGES: the
// Result box is the canon of what happened (GM-facing, one field — gmNotes
// carries machine markers only and never renders), the composers queue
// messages and effects, and Solve marks the staging complete. Nothing
// touches the player until the turn-end push. The two exceptions are Reject
// (deletes the Move, frees the turn, tells them now) and the lock this desk
// claims so two GMs don't work the same row.

const REJECT_HELP =
  "Deletes the Move and frees up their turn — the misclick escape hatch, or a Move that shouldn't have been one. They're DM'd the reason immediately.";

function Switch({ label, value, options, onChange, disabled, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="field-label flex items-center gap-1.5">
        {label}
        {children}
      </span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
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

export default function MoveDesk({
  move,
  staged,
  tagsById,
  tagCatalog,
  roster,
  presenceZones,
  currentTurnNumber,
  onInspect,
  onClose,
  registerEscape,
  onOpenDev,
  gmProfiles,
}) {
  const [refresh] = useRefresh();
  const router = useRouter();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();
  const confirm = useConfirm();
  const { locked, error: lockError } = useMoveLock(move.id);

  // The workspace's layered Escape deselects through the same dirty guard
  // as the Close button.
  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const [edits, setEdits] = useState({
    moveKind: move.moveKind,
    resultMessage: move.resultMessage ?? "",
  });
  const [composer, setComposer] = useState(null); // "effect" | "message" | "public" | null
  // Set only by "Stage as message" below, to prefill the composer with the
  // LOCAL (possibly unsaved) Result text. The plain "+ Message" button
  // leaves this null, so the composer opens blank as before.
  const [messagePrefill, setMessagePrefill] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // Read off the enum, not the display label — a live lock never masks this
  // any more (moveRows.js), but the enum is still the one thing that can't
  // drift if the label's wording ever does.
  const solved = move.reviewStatus === "SOLVED";
  const disabled = pending || !locked;

  const setEdit = useCallback(
    (key, value) => {
      markDirty();
      setEdits((e) => ({ ...e, [key]: value }));
    },
    [markDirty],
  );

  // Solving is the last moment anyone looks at this Move, and the Result box
  // is GM-facing — it is never sent. A Move whose outcome lives only there
  // reaches its player as silence, and for a Gambit that silence is total
  // (Gambits are excluded from the passed-Routine fallback DM). So say so
  // before the GM walks away from it.
  async function run(mode) {
    setError(null);
    if (
      mode === "solve" &&
      edits.resultMessage.trim() &&
      !stagingReaches(move.characterId, staged)
    ) {
      const ok = await confirm({
        title: `Nothing you've staged reaches ${move.characterName}`,
        message:
          "The Result box is GM-facing and is never sent. Stage it as a message first, or solve anyway if they hear about this another way.",
        confirmLabel: "Solve anyway",
        cancelLabel: "Back to staging",
      });
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const res = await resolveMove({ actionId: move.id, mode, edits });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        refresh();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  function submitReject(reason) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await rejectMove({ actionId: move.id, reason });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        setRejecting(false);
        if (res.deliveryFailed) {
          setError("Move rejected — but they weren't told. Let them know they can act again.");
        } else {
          onClose();
        }
        refresh();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  // "rolled 5–12 ⬢ → +8", built server-side with the rest of the DTO
  // (web/lib/moveRows.js) so the history desk reads the same string.
  const declared = move.declaredLabel;

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <CharacterAvatar characterId={move.characterId} name={move.characterName} version={move.avatarVersion} size={32} />
            <button type="button" className="desk-name" onClick={() => onInspect(move.characterId, move.characterName)}>
              {move.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({move.discordUsername})</span>
          </h2>
          <p className="text-xs text-muted">
            {move.roleTitle && <>{move.roleTitle} · </>}
            {move.locationLabel} · {move.factionName || "No faction"} · {move.resources} ⬢ on hand
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Straight to their conversation on the player desk. The reverse
              link lives on that desk's Canon tab, so the two are one loop. */}
          {move.discordUserId && (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => guardedClose(() => router.push(`/gm/players/${move.discordUserId}`))}
            >
              Message →
            </button>
          )}
          {/* Everything they did before this turn, in the inspector's Moves
              tab — "what did this person do last time" without leaving the
              row you're adjudicating. */}
          <button
            type="button"
            className="btn-quiet"
            onClick={() => onInspect(move.characterId, move.characterName, "Moves")}
          >
            Past moves
          </button>
          <DevCharacterButton
            characterId={move.characterId}
            name={move.characterName}
            onOpen={() => onOpenDev?.(move.characterId, move.characterName)}
          />
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
          {move.isTravel ? (
            <div className="flex flex-col gap-1">
              <span className="field-label">Kind</span>
              <span className="text-sm text-muted">Travel — auto-filed, no Routine/Gambit to pick</span>
            </div>
          ) : (
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
          )}
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
              ? "Saving rolls a fresh d6 and applies their current Hunger."
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
            maxLength={RESULT_BOX_MAX_LENGTH}
            onChange={(e) => setEdit("resultMessage", e.target.value)}
            placeholder="What actually happened here. GM-facing — tell the players with staged messages below."
          />
        </label>
        <button
          type="button"
          className="btn-quiet self-start"
          disabled={!edits.resultMessage.trim()}
          onClick={() => {
            setMessagePrefill(edits.resultMessage);
            setComposer("message");
          }}
        >
          Stage as message
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this Move</h3>
          <div className="flex gap-2">
            <button type="button" className="btn-quiet" onClick={() => setComposer("effect")}>
              + Effect
            </button>
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setMessagePrefill(null);
                setComposer("message");
              }}
            >
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
          presenceZones={presenceZones}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
          empty="Nothing staged yet."
        />
      </div>

      {composer === "effect" && (
        <EffectComposer
          moveId={move.id}
          defaultTarget={{ id: move.characterId, name: move.characterName }}
          declaredDelta={move.resourceDelta ?? null}
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
          moveId={move.id}
          defaultRecipients={[{ characterId: move.characterId, name: move.characterName }]}
          initialContent={messagePrefill ?? undefined}
          initialRecipients={messagePrefill != null ? [{ characterId: move.characterId, name: move.characterName }] : undefined}
          roster={roster}
          onDone={() => {
            setComposer(null);
            setMessagePrefill(null);
            refresh();
          }}
          onCancel={() => {
            setComposer(null);
            setMessagePrefill(null);
          }}
        />
      )}
      {composer === "public" && (
        <PublicComposer
          moveId={move.id}
          defaultZoneId={move.zoneId}
          zones={presenceZones}
          onDone={() => {
            setComposer(null);
            refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {move.reviewedByUsername && (
        <p className="mt-3 flex items-center gap-1 text-xs text-muted">
          <GmAvatar profile={gmProfiles?.[move.reviewedByDiscordUserId]} size={13} />
          Solved by {move.reviewedByUsername}
          {move.reviewedAtLabel ? ` · ${move.reviewedAtLabel}` : ""}
        </p>
      )}

      {!locked && !lockError && <p className="mt-3 text-xs text-muted">Claiming this Move…</p>}
      <FormError>{error ?? lockError}</FormError>

      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <Tooltip text={REJECT_HELP}>
          <button
            type="button"
            className="btn-danger"
            onClick={() => setRejecting(true)}
            disabled={disabled}
          >
            Reject
          </button>
        </Tooltip>

        {/* Save is always here — a solved Move stays freely editable, since
            the status guard it used to sit behind protected nothing (Solve is
            bookkeeping; nothing pays until the push). That's what stranded
            last night's edit: Save refused to touch a Solved row, and the
            only way out was Reopen, which the desk's own lock-masked status
            was hiding the button for. */}
        <button type="button" className="btn-quiet" onClick={() => run("save")} disabled={disabled}>
          {pending ? "Working…" : "Save"}
        </button>
        {solved ? (
          <button type="button" className="btn" onClick={() => run("unsolve")} disabled={disabled}>
            {pending ? "Working…" : "Reopen"}
          </button>
        ) : (
          <Tooltip text="Marks the staging complete. Nothing applies until the push.">
            <button type="button" className="btn" onClick={() => run("solve")} disabled={disabled}>
              {pending ? "Working…" : "Solve"}
            </button>
          </Tooltip>
        )}
      </div>

      <RequestDialog
        open={rejecting}
        title={`Reject ${move.characterName}'s Move`}
        submitLabel="Reject it"
        busy={pending}
        onCancel={() => !pending && setRejecting(false)}
        onConfirm={submitReject}
      >
        <p className="text-xs text-muted">
          The Move is deleted and their turn frees up. They&apos;re DM&apos;d this reason right away.
          Anything staged on it stays, detached, in the tray.
        </p>
      </RequestDialog>
    </div>
  );
}
