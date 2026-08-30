"use client";

import Link from "next/link";
import { useEffect } from "react";
import TagChip from "@/app/components/TagChip";
import GmAvatar from "@/app/components/GmAvatar";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import StagedItems from "./StagedItems";

// One Move on a turn that has already been pushed. The same card as MoveDesk,
// minus everything that would change something: no lock, no composers, no
// Solve, no Reject. What is left is the record — what they declared, what
// actually paid, the Result a GM wrote, and what the player was told.
//
// Not quite read-only, though, and deliberately so: StagedItems keeps Edit and
// Delete on a row the push never carried (the missed-push case) and Resend on
// one whose delivery failed. Those are the two things about a past turn that
// can still genuinely need doing, and the tray already offers them.

export default function MoveHistoryDesk({
  move,
  turnLabel,
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
  // No dirty guard — there is nothing here to lose. Escape just closes.
  useEffect(() => {
    registerEscape?.(() => onClose());
    return () => registerEscape?.(null);
  }, [registerEscape, onClose]);

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
            {move.locationLabel} · {move.factionName || "No faction"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {move.discordUserId && (
            <Link href={`/gm/players/${move.discordUserId}`} className="btn-quiet">
              Message →
            </Link>
          )}
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
          <button type="button" className="btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="chip">Turn {turnLabel ?? "—"}</span>
        <span className="chip text-xs text-muted">{move.statusLabel}</span>
      </div>

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
          <div className="flex flex-col gap-1">
            <span className="field-label">Kind</span>
            <span className="text-sm">{move.kindLabel}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="field-label">Dice</span>
            <span className="mono text-sm">{move.rollLabel || "—"}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="field-label">Declared</span>
            <span className="mono text-sm">{move.declaredLabel ?? "—"}</span>
          </div>
          {/* What the push actually moved, from the appliedEffects snapshot —
              the declared numbers are what was asked for, this is what paid. */}
          <div className="flex flex-col gap-1">
            <span className="field-label">Paid</span>
            <span className="mono text-sm">{move.paidLabel || "—"}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <h3 className="field-label">Result — the canon of what happened</h3>
        {move.resultMessage ? (
          <p className="desk-move-text text-sm">{move.resultMessage}</p>
        ) : (
          <p className="text-sm text-muted">No result recorded.</p>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <h3 className="field-label">Sent on this Move</h3>
        <StagedItems
          effects={staged.effects}
          messages={staged.messages}
          tagCatalog={tagCatalog}
          roster={roster}
          presenceZones={presenceZones}
          onInspect={onInspect}
          gmProfiles={gmProfiles}
          empty="Nothing was staged on this Move."
        />
      </div>

      {move.reviewedByUsername && (
        <p className="mt-3 flex items-center gap-1 text-xs text-muted">
          <GmAvatar profile={gmProfiles?.[move.reviewedByDiscordUserId]} size={13} />
          Solved by {move.reviewedByUsername}
          {move.reviewedAtLabel ? ` · ${move.reviewedAtLabel}` : ""}
        </p>
      )}
    </div>
  );
}
