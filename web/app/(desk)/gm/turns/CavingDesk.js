"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import { useRefresh } from "@/app/components/useRefresh";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import EffectComposer from "./EffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { CAVING_KIND_LABELS } from "@/lib/cavingLabels";
import { resolveCavingRoll, resolveRequest } from "./actions";
import { mutationErrorMessage } from "@/app/components/useDeskVersion";

// The arbitration desk for one Caving Die roll — see
// docs/systemdocs/CAVING.md. Only a TROUBLE (die 1) row is ever unresolved;
// QUIET (2-5) and FIND (6) are stamped resolved the moment the pass writes
// them, so this desk's real job is monsters: narrate what happened, stage
// whatever effects and DMs the encounter needs, and mark it resolved. No
// lock — unlike a Move, two GMs opening the same roll can't race a solve
// that pays anyone twice.
//
// A FIND row opens here too, showing what was found — with no "Mark resolved"
// button, since it has nothing left to resolve, but with its own Undo. The
// loot landed as a PASSED CAVING_LOOT Request and that row still shows in the
// Requests lens; Undo here just saves the GM the trip, and goes through the
// very same REQUEST_EFFECTS.CAVING_LOOT.undo handler (web/lib/requestEffects.js)
// so there is exactly one way the tag ever comes back off.

export default function CavingDesk({
  roll,
  staged,
  tagCatalog,
  roster,
  presenceZones,
  stagingLocations,
  onInspect,
  onClose,
  registerEscape,
  onOpenDev,
  gmProfiles,
  // Read-only mode, for a roll on a pushed turn opened from the History lens —
  // mirrors MoveHistoryDesk: no composers, no Mark resolved, the notes box
  // disabled. Staged rows still show (an unapplied one stays editable).
  readOnly = false,
  turnLabel = null,
}) {
  const [refresh] = useRefresh();
  const confirm = useConfirm();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();

  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const [gmNotes, setGmNotes] = useState(roll.gmNotes ?? "");
  const [composer, setComposer] = useState(null); // "effect" | "message" | "public" | null
  // Set only by "Stage as message" below, to prefill the composer with the
  // Result box's narration — the same bridge MoveDesk.js uses. A plain
  // "+ Message" clears it first, so it opens empty.
  const [messagePrefill, setMessagePrefill] = useState(null);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const setNotes = useCallback(
    (value) => {
      markDirty();
      setGmNotes(value);
    },
    [markDirty],
  );

  function resolve() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await resolveCavingRoll({ cavingRollId: roll.id, gmNotes });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        markClean();
        refresh();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  // The Requests lens' Undo, reachable from here. resolveRequestImpl is
  // already idempotent on an UNDONE row, so a double-click can't re-grant.
  async function undoFind() {
    setError(null);
    const ok = await confirm({
      title: `Take back ${roll.lootTagName ?? "this find"}?`,
      message: `${roll.characterName} keeps the roll — only the loot comes off the sheet. This is the same Undo the Requests lens runs.`,
      confirmLabel: "Take it back",
      cancelLabel: "Leave it",
    });
    if (!ok) return;

    startTransition(async () => {
      try {
        const res = await resolveRequest({ requestId: roll.lootRequestId, mode: "undo" });
        if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
        // Same as resolve() above: GM notes typed but never marked clean
        // would otherwise leave isAnyDirty() stuck true for the rest of the
        // session, silently pausing the desk's 45s poll.
        markClean();
        refresh();
      } catch {
        setError(mutationErrorMessage());
      }
    });
  }

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <CharacterAvatar characterId={roll.characterId} name={roll.characterName} version={roll.avatarVersion} size={32} />
            <button type="button" className="desk-name" onClick={() => onInspect(roll.characterId, roll.characterName)}>
              {roll.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({roll.discordUsername})</span>
          </h2>
          <p className="text-xs text-muted">
            {roll.roleTitle && <>{roll.roleTitle} · </>}
            {roll.locationName ? <>{roll.locationName} · </> : null}
            {roll.factionZoneName} · ⚀ {roll.die} · {roll.kindLabel ?? CAVING_KIND_LABELS[roll.kind] ?? roll.kind}
            {readOnly && turnLabel ? <> · {turnLabel}</> : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DevCharacterButton
            characterId={roll.characterId}
            name={roll.characterName}
            onOpen={() => onOpenDev?.(roll.characterId, roll.characterName)}
          />
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Close
          </button>
        </div>
      </header>

      {roll.kind === "FIND" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm">
            Rolled a {roll.die} and found <strong>{roll.lootTagName ?? "—"}</strong> ({roll.lootTier ?? "—"}).{" "}
            {roll.lootRequestStatus === "UNDONE"
              ? "That find has been undone — the tag is off the sheet."
              : roll.lootRequestId
                ? "Already granted, and filed as a passed Request."
                : "Already granted. The Request behind it is gone, so undo it by hand from the Dev Panel."}
          </p>
          {roll.lootRequestId && roll.lootRequestStatus !== "UNDONE" && (
            <button type="button" className="btn-quiet" onClick={undoFind} disabled={pending}>
              {pending ? "Working…" : "Undo this find"}
            </button>
          )}
        </div>
      )}

      {roll.kind === "TROUBLE" && (
        <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <label className="field">
            <span className="field-label">Result — what happened down there</span>
            <textarea
              rows={4}
              value={gmNotes}
              disabled={pending || readOnly}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What actually happened here. GM-facing — send it to the player with Stage as message."
            />
          </label>
          {!readOnly && (
            <button
              type="button"
              className="btn-quiet self-start"
              disabled={!gmNotes.trim()}
              onClick={() => {
                setMessagePrefill(gmNotes);
                setComposer("message");
              }}
            >
              Stage as message
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this roll</h3>
          {!readOnly && (
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
          )}
        </div>

        <StagedItems
          effects={staged.effects}
          messages={staged.messages}
          tagCatalog={tagCatalog}
          roster={roster}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
          empty="Nothing staged yet."
        />
      </div>

      {composer === "effect" && (
        <EffectComposer
          cavingRollId={roll.id}
          defaultTarget={{ id: roll.characterId, name: roll.characterName }}
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          stagingLocations={stagingLocations}
          onDone={() => {
            setComposer(null);
            refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "message" && (
        <MessageComposer
          cavingRollId={roll.id}
          defaultRecipients={[{ characterId: roll.characterId, name: roll.characterName }]}
          initialContent={messagePrefill ?? undefined}
          initialRecipients={messagePrefill != null ? [{ characterId: roll.characterId, name: roll.characterName }] : undefined}
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
          cavingRollId={roll.id}
          zones={presenceZones}
          onDone={() => {
            setComposer(null);
            refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}

      {roll.resolvedByUsername && (
        <p className="mt-3 text-xs text-muted">
          Resolved by {roll.resolvedByUsername}
          {roll.resolvedAtLabel ? ` · ${roll.resolvedAtLabel}` : ""}
        </p>
      )}

      <FormError>{error}</FormError>

      {roll.kind === "TROUBLE" && !roll.resolvedAt && !readOnly && (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn" onClick={resolve} disabled={pending}>
            {pending ? "Working…" : "Mark resolved"}
          </button>
        </div>
      )}
    </div>
  );
}
