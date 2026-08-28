"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import StatusPill from "@/app/components/StatusPill";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import EffectComposer from "./EffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import { deleteStagedEffect, deleteStagedMessage, resendStagedMessage } from "./actions";
import { effectSummary, effectState, messageState, tagNameLookup, truncate } from "./stagedFormat";

// The staged-row lists the desk and the tray share: every row shows what it
// will do at the push, who queued it, and edit/delete — which stay live right
// up until the push freezes the row (sentAt / appliedAt). `data-row-id` is
// how the interactive push preview scrolls a row into view and flashes it
// (Workspace#revealStagedRow).

export function StagedEffectRow({ effect, tagNames, tagCatalog, roster, presenceZones, onInspect, showBatch, gmProfiles }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const state = effectState(effect);
  const frozen = effect.applied || Boolean(effect.appliedError);

  function onDelete() {
    const batch = showBatch && effect.batchId;
    startTransition(async () => {
      await deleteStagedEffect(batch ? { batchId: effect.batchId } : { stagedEffectId: effect.id });
      router.refresh();
    });
  }

  return (
    <div className="desk-staged-row" data-kind="effect" data-row-id={effect.id}>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <button
            type="button"
            className="desk-name inline-flex items-center gap-1"
            onClick={() => onInspect?.(effect.targetCharacterId, effect.targetName)}
          >
            <CharacterAvatar
              characterId={effect.targetCharacterId}
              name={effect.targetName}
              version={effect.targetAvatarVersion}
              size={16}
            />
            {effect.targetName}
          </button>{" "}
          <span className="mono">{effectSummary(effect, tagNames)}</span>
        </p>
        <p className="text-xs text-muted flex items-center gap-1">
          {showBatch && effect.batchId ? "Mass apply · " : ""}
          <GmAvatar profile={gmProfiles?.[effect.createdByDiscordUserId]} size={13} />
          by {effect.createdByUsername}
          {effect.turnNumber != null ? ` · turn ${effect.turnNumber}` : ""}
          {effect.appliedError ? ` · ${effect.appliedError}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
        {!frozen && (
          <>
            <button type="button" className="btn-quiet" onClick={() => setEditing(true)} disabled={pending}>
              Edit
            </button>
            <button type="button" className="btn-quiet" onClick={onDelete} disabled={pending}>
              Delete
            </button>
          </>
        )}
      </div>
      {editing && (
        <EffectComposer
          existing={effect}
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

export function StagedMessageRow({ message, roster, presenceZones, onInspect, gmProfiles }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [resendError, setResendError] = useState(null);

  const state = messageState(message);
  const frozen = message.sent;
  // The push writes DbNull on a clean send, but an empty array would be
  // truthy — check for actual entries rather than presence.
  const failureCount = Array.isArray(message.deliveryFailures) ? message.deliveryFailures.length : 0;
  const canResend = message.sent && failureCount > 0;

  function onDelete() {
    startTransition(async () => {
      await deleteStagedMessage({ stagedMessageId: message.id });
      router.refresh();
    });
  }

  function onResend() {
    setResendError(null);
    startTransition(async () => {
      const res = await resendStagedMessage({ stagedMessageId: message.id });
      if (!res?.ok) return setResendError(res?.error ?? "Something went wrong.");
      router.refresh();
    });
  }

  return (
    <div className="desk-staged-row" data-kind={message.kind.toLowerCase()} data-row-id={message.id}>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {message.kind === "PUBLIC" ? (
            <span className="chip">Public{message.zoneName ? ` · ${message.zoneName}` : ""}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {message.recipients.length ? (
                message.recipients.map((r) => (
                  <button
                    key={r.characterId}
                    type="button"
                    className="chip desk-name inline-flex items-center gap-1"
                    onClick={() => onInspect?.(r.characterId, r.name)}
                  >
                    <CharacterAvatar characterId={r.characterId} name={r.name} version={r.avatarVersion} size={16} />
                    {r.name}
                  </button>
                ))
              ) : (
                <span className="chip">no recipients</span>
              )}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm">» {truncate(message.content)}</p>
        <p className="text-xs text-muted flex items-center gap-1">
          <GmAvatar profile={gmProfiles?.[message.createdByDiscordUserId]} size={13} />
          by {message.createdByUsername}
          {message.turnNumber != null ? ` · turn ${message.turnNumber}` : ""}
          {message.deliveryFailures
            ? ` · failed: ${(Array.isArray(message.deliveryFailures) ? message.deliveryFailures : [])
                .map((f) => f.name ?? f.error)
                .join(", ")}`
            : ""}
        </p>
        {resendError && <p className="form-error">{resendError}</p>}
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
        {canResend && (
          <button type="button" className="btn-quiet" onClick={onResend} disabled={pending}>
            {pending ? "Resending…" : "Resend"}
          </button>
        )}
        {!frozen && (
          <>
            <button type="button" className="btn-quiet" onClick={() => setEditing(true)} disabled={pending}>
              Edit
            </button>
            <button type="button" className="btn-quiet" onClick={onDelete} disabled={pending}>
              Delete
            </button>
          </>
        )}
      </div>
      {editing &&
        (message.kind === "PUBLIC" ? (
          <PublicComposer
            existing={message}
            zones={presenceZones}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <MessageComposer
            existing={message}
            roster={roster}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        ))}
    </div>
  );
}

export default function StagedItems({ effects, messages, tagCatalog, roster, presenceZones, onInspect, empty, gmProfiles }) {
  const tagNames = useMemo(() => tagNameLookup(tagCatalog), [tagCatalog]);

  if (!effects.length && !messages.length) {
    return <p className="text-sm text-muted">{empty ?? "Nothing staged."}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {effects.map((e) => (
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
      {messages.map((m) => (
        <StagedMessageRow
          key={m.id}
          message={m}
          roster={roster}
          presenceZones={presenceZones}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
        />
      ))}
    </div>
  );
}
