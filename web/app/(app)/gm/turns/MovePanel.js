"use client";

import FormError from "@/app/components/FormError";
import Modal from "@/app/components/Modal";
import CheckField from "@/app/components/CheckField";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { useConfirm } from "@/app/components/ConfirmProvider";
import CharacterLink from "@/app/components/CharacterLink";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import InfoIcon from "@/app/components/InfoIcon";
import Tooltip from "@/app/components/Tooltip";
import TagChip from "@/app/components/TagChip";
import RequestDialog from "@/app/components/RequestDialog";
import { claimMoveLock, refreshMoveLock, releaseMoveLock, resolveMove, rejectMove } from "./actions";
import FactionLink from "@/app/components/FactionLink";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";

// The Move Adjudication Panel — the half of /gm/turns that ADJUDICATION.md §5
// left as Phase 2. Same shell as RequestPanel.js (dirty guard, confirm dialog,
// { ok, error } results), three sections, and a cooperative lock so two GMs
// don't work the same Move.

const OPPOSED_HELP =
  "Opposed moves affect negatively affect another player. Wait to adjudicate these until all other parties have moved.";

const RESULT_HELP =
  "Only visible to GMs. Write whatever you'd like. Once you're done, message all affected players (or go to the respective channel and respond as Bascinet by typing /gm) to communicate the results.";

const REJECT_HELP = "Deletes the Move and frees up the user's turn. Helpful if the action wasn't notable enough to be a move.";

const HEARTBEAT_MS = 30_000;
const MAX_RESOURCE_DELTA = 20;

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

// Two mutually exclusive options rendered as one control — a GM picks the side
// they mean rather than reasoning about which way a checkbox points.
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

export default function MovePanel({ move, tagsById = {}, readOnly = false, onClose }) {
  const confirm = useConfirm();
  const { markDirty, markClean, guardedClose } = useDirtyGuard({ enabled: !readOnly });

  const [edits, setEdits] = useState({
    moveKind: move?.moveKind ?? "ROUTINE",
    opposed: Boolean(move?.opposed),
    resourceDelta: move?.resourceDelta == null ? "" : String(move.resourceDelta),
    resultMessage: move?.resultMessage ?? "",
    gmNotes: move?.gmNotes ?? "",
  });
  const [notifyPlayer, setNotifyPlayer] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pending, startTransition] = useTransition();

  const actionId = move?.id;
  const lockedRef = useRef(false);

  // Read-only (the eye) deliberately never claims the lock: looking at a Move
  // must not block the GM who intends to actually resolve it.
  useEffect(() => {
    if (!actionId || readOnly) return undefined;
    let cancelled = false;

    (async () => {
      const res = await claimMoveLock({ actionId });
      if (cancelled) return;
      if (!res?.ok) return setError(res?.error ?? "Could not open this Move.");
      lockedRef.current = true;
      setLocked(true);
    })();

    const beat = setInterval(async () => {
      if (!lockedRef.current) return;
      const res = await refreshMoveLock({ actionId });
      if (!res?.ok) {
        lockedRef.current = false;
        setLocked(false);
        setError(res?.error ?? "Your hold on this Move expired.");
      }
    }, HEARTBEAT_MS);

    // Best-effort release when the tab goes away. The TTL is the real
    // guarantee — this just shortens the wait for the next GM in the common
    // case where the browser gets a chance to fire it.
    const onUnload = () => {
      if (lockedRef.current) navigator.sendBeacon?.(`/api/move-lock/release?actionId=${actionId}`);
    };
    window.addEventListener("pagehide", onUnload);

    return () => {
      cancelled = true;
      clearInterval(beat);
      window.removeEventListener("pagehide", onUnload);
      if (lockedRef.current) releaseMoveLock({ actionId });
      lockedRef.current = false;
    };
  }, [actionId, readOnly]);

  const setEdit = useCallback(
    (key, value) => {
      markDirty();
      setEdits((e) => ({ ...e, [key]: value }));
    },
    [markDirty],
  );

  if (!move) return null;
  const solved = move.statusLabel === "Solved";
  const disabled = readOnly || pending;

  function run(mode) {
    setError(null);
    startTransition(async () => {
      const res = await resolveMove({ actionId, mode, edits, notifyPlayer });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      lockedRef.current = false;
      markClean();
      // The Move went through either way — but if the player's DM didn't, the
      // panel stays open to say so. Closing on a silent failure is what made
      // an over-length result look delivered.
      if (res.deliveryFailed) {
        setError("Solved — but the message didn't reach them. Tell them another way.");
        return;
      }
      onClose();
    });
  }

  // Unsolving hands back everything the Solve pushed. Said plainly here rather
  // than discovered afterwards on the player's sheet.
  async function onUnsolve() {
    const ok = await confirm({
      title: "Reopen this solved Move?",
      message: move.appliedSummary
        ? `This hands back ${move.appliedSummary} and returns the Move to the queue.`
        : "This returns the Move to the queue.",
      confirmLabel: "Reopen it",
      cancelLabel: "Leave it solved",
    });
    if (ok) run("unsolve");
  }

  function submitReject(reason) {
    setError(null);
    startTransition(async () => {
      const res = await rejectMove({ actionId, reason });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      if (res.deliveryFailed) {
        // A freed turn the player doesn't know about is a wasted day.
        setError("Move rejected — but they weren't told. Let them know they can act again.");
        return;
      }
      lockedRef.current = false;
      markClean();
      setRejecting(false);
      onClose();
    });
  }

  const close = () => (readOnly ? onClose() : guardedClose(onClose));

  return (
    <>
      <Modal
        title={readOnly ? "Move (read only)" : "Adjudicate Move"}
        width="wide"
        onClose={() => !pending && close()}
        actions={<DevCharacterButton characterId={move.characterId} name={move.characterName} />}
      >
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="field-label">Character</h3>
          <Line label="Player">
            <CharacterLink characterId={move.characterId} name={move.characterName} isGm />{" "}
            <span className="text-muted">({move.discordUsername})</span>
          </Line>
          <Line label="Location">{move.locationLabel}</Line>
          <Line label="Faction">
          <FactionLink factionId={move.factionId} name={move.factionName || "—"} />
        </Line>
          <Line label="Resources">{move.resources} ⬢</Line>
          {move.tags?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {/* The row carries tag IDs; the tag itself comes from the
                  page-level map, which holds one copy of each rather than one
                  per row. A tag missing from the map means it was deleted
                  between the render and now — skip it rather than crash the
                  panel. */}
              {move.tags.map((t) =>
                tagsById[t.tagId] ? (
                  <TagChip
                    key={t.tagId}
                    tag={tagsById[t.tagId]}
                    quantity={t.quantity}
                    expiresTurn={t.expiresTurn}
                    currentTurn={move.currentTurnNumber}
                  />
                ) : null,
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">
              No tags.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="field-label">Situation</h3>
          <Line label="Turn">{move.turnLabel}</Line>
          {/* The whole description, never clamped — this is the view a GM
              adjudicates from. pre-wrap keeps the player's own line breaks. */}
          <p className="text-sm whitespace-pre-wrap">{move.description}</p>

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
            <InfoIcon text={OPPOSED_HELP} />
          </Switch>

          <Line label="Dice">
            {move.rollLabel || <span className="text-muted">—</span>}
          </Line>
          {edits.moveKind !== move.moveKind && (
            <p className="text-xs text-accent">
              {edits.moveKind === "GAMBIT"
                ? "Saving rolls a fresh d6 and applies their current Mood and Hunger."
                : "Saving clears the roll — a Routine never carries one."}
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <h3 className="field-label">Result</h3>

          <label className="field" style={{ width: "12rem" }}>
            <span className="field-label">Resources</span>
            <input
              type="number"
              min={-MAX_RESOURCE_DELTA}
              max={MAX_RESOURCE_DELTA}
              value={edits.resourceDelta}
              disabled={disabled}
              onChange={(e) => setEdit("resourceDelta", e.target.value)}
            />
          </label>
          {move.appliedSummary && (
            <p className="text-xs text-muted">
              Already pushed to their sheet: {move.appliedSummary}.
            </p>
          )}

          <label className="field">
            <span className="field-label flex items-center gap-1.5">
              Result
              <InfoIcon text={RESULT_HELP} />
            </span>
            <textarea
              rows={4}
              value={edits.resultMessage}
              disabled={disabled}
              maxLength={GM_MESSAGE_MAX_LENGTH}
              onChange={(e) => setEdit("resultMessage", e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">GM notes</span>
            <textarea
              rows={2}
              value={edits.gmNotes}
              disabled={disabled}
              onChange={(e) => setEdit("gmNotes", e.target.value)}
            />
          </label>

          {!readOnly && (
            <CheckField
              checked={notifyPlayer}
              disabled={disabled}
              onChange={(e) => setNotifyPlayer(e.target.checked)}
            >
              DM the Result to {move.characterName} when I solve this
            </CheckField>
          )}
        </div>

        {move.reviewedByUsername && (
          <p className="mt-3 text-xs text-muted">
            Solved by {move.reviewedByUsername}
            {move.reviewedAtLabel ? ` · ${move.reviewedAtLabel}` : ""}
          </p>
        )}

        {!readOnly && !locked && !error && (
          <p className="mt-3 text-xs text-muted">
            Claiming this Move…
          </p>
        )}

        <FormError>{error}</FormError>

        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn-quiet" onClick={close} disabled={pending}>
            {readOnly ? "Close" : "Cancel"}
          </button>

          {!readOnly && (
            <>
              <Tooltip text={REJECT_HELP}>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={() => setRejecting(true)}
                  disabled={disabled || !locked}
                >
                  Reject
                </button>
              </Tooltip>

              {solved ? (
                <button type="button" className="btn" onClick={onUnsolve} disabled={disabled || !locked}>
                  {pending ? "Working…" : "Reopen"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => run("save")}
                    disabled={disabled || !locked}
                  >
                    Save
                  </button>
                  <button type="button" className="btn" onClick={() => run("solve")} disabled={disabled || !locked}>
                    {pending ? "Working…" : "Solve"}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </Modal>

      <RequestDialog
        open={rejecting}
        title={`Reject ${move.characterName}'s Move`}
        submitLabel="Reject it"
        busy={pending}
        onCancel={() => !pending && setRejecting(false)}
        onConfirm={submitReject}
      >
        <p className="text-xs text-muted">
          The Move is deleted and their turn frees up. They&apos;re DM&apos;d this reason.
        </p>
      </RequestDialog>
    </>
  );
}
