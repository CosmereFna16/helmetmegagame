"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FormError from "@/app/components/FormError";
import DevCharacterButton from "@/app/components/DevCharacterButton";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import EffectComposer from "./EffectComposer";
import MessageComposer from "./MessageComposer";
import PublicComposer from "./PublicComposer";
import StagedItems from "./StagedItems";
import { resolveCavingRoll } from "./actions";

// The arbitration desk for one Caving Die roll — see
// docs/systemdocs/CAVING.md. Only a TROUBLE (die 1) row is ever unresolved;
// QUIET (2-5) and FIND (6) are stamped resolved the moment the pass writes
// them, so this desk's real job is monsters: narrate what happened, stage
// whatever effects and DMs the encounter needs, and mark it resolved. No
// lock — unlike a Move, two GMs opening the same roll can't race a solve
// that pays anyone twice.
//
// A FIND row still opens here (mostly for the record — the loot already
// landed as a PASSED CAVING_LOOT Request, undoable from the Requests lens),
// and shows what was found without a "Mark resolved" button, since it has
// nothing left to resolve.

const KIND_LABEL = { TROUBLE: "Trouble", QUIET: "Quiet", FIND: "Find" };

export default function CavingDesk({
  roll,
  staged,
  tagCatalog,
  roster,
  zones,
  presenceZones,
  onInspect,
  onClose,
  registerEscape,
  onOpenDev,
}) {
  const router = useRouter();
  const { markDirty, markClean, guardedClose } = useDirtyGuard();

  useEffect(() => {
    registerEscape?.(() => guardedClose(onClose));
    return () => registerEscape?.(null);
  }, [registerEscape, guardedClose, onClose]);

  const [gmNotes, setGmNotes] = useState(roll.gmNotes ?? "");
  const [composer, setComposer] = useState(null); // "effect" | "message" | "public" | null
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
      const res = await resolveCavingRoll({ cavingRollId: roll.id, gmNotes });
      if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
      markClean();
      router.refresh();
    });
  }

  return (
    <div className="desk-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">
            <button type="button" className="desk-name" onClick={() => onInspect(roll.characterId, roll.characterName)}>
              {roll.characterName}
            </button>{" "}
            <span className="text-muted text-sm">({roll.discordUsername})</span>
          </h2>
          <p className="text-xs text-muted">
            {roll.factionZoneName} · ⚀ {roll.die} · {KIND_LABEL[roll.kind] ?? roll.kind}
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
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm">
            Found <strong>{roll.lootTagName ?? "—"}</strong> ({roll.lootTier ?? "—"}). Already granted as a
            passed Request — undo it from the Requests lens if this shouldn&apos;t have happened.
          </p>
        </div>
      )}

      {roll.kind === "TROUBLE" && (
        <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <label className="field">
            <span className="field-label">GM notes — what happened down there</span>
            <textarea
              rows={4}
              value={gmNotes}
              disabled={pending}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Monster, hazard, whatever this 1 turned into. GM-facing — tell the player with a staged message below."
            />
          </label>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="field-label">Staged on this roll</h3>
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
          presenceZones={presenceZones}
          onInspect={onInspect}
          empty="Nothing staged yet. Effects change sheets; messages land as DMs; public posts hit the summary channel — all at the push."
        />
      </div>

      {composer === "effect" && (
        <EffectComposer
          cavingRollId={roll.id}
          defaultTarget={{ id: roll.characterId, name: roll.characterName }}
          roster={roster}
          tagCatalog={tagCatalog}
          presenceZones={presenceZones}
          onDone={() => {
            setComposer(null);
            router.refresh();
          }}
          onCancel={() => setComposer(null)}
        />
      )}
      {composer === "message" && (
        <MessageComposer
          cavingRollId={roll.id}
          defaultRecipients={[{ characterId: roll.characterId, name: roll.characterName }]}
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
          cavingRollId={roll.id}
          zones={zones}
          onDone={() => {
            setComposer(null);
            router.refresh();
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

      {roll.kind === "TROUBLE" && !roll.resolvedAt && (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <button type="button" className="btn" onClick={resolve} disabled={pending}>
            {pending ? "Working…" : "Mark resolved"}
          </button>
        </div>
      )}
    </div>
  );
}
