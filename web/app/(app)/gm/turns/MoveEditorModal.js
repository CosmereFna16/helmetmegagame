"use client";

import { formatTurnLabel } from "@/lib/turnFormat";
import CharacterLink from "../../../components/CharacterLink";
import FactionLink from "../../../components/FactionLink";
import { updateMove } from "../actions";
import PartyRows from "./PartyRows";

const PIPELINE_LABELS = {
  PENDING_TYPE: "Waiting on the player to choose Routine or Gambit in Discord.",
  PENDING_OPPOSED: "Waiting on the player to say whether it's Opposed in Discord.",
  PENDING: "Waiting on the player to confirm in Discord.",
};

export default function MoveEditorModal({ move, otherCharacters, onClose }) {
  const confirmed = move.status === "CONFIRMED" || move.status === "ADJUDICATED";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: "40rem" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="text-lg font-bold">
            <CharacterLink characterId={move.characterId} name={move.characterName} /> —{" "}
            {formatTurnLabel(move.turnNumber, move.turnPhase)}
          </h2>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          <FactionLink factionId={move.factionId} name={move.factionName || "No faction"} /> — {move.zoneName || "No zone"}
          {move.diceRoll != null ? ` — rolled ${move.diceRoll}` : ""}
          {move.resourceDelta ? ` — ${move.resourceDelta > 0 ? "+" : ""}${move.resourceDelta} resources` : ""}
        </p>
        <p className="mt-3 text-sm">{move.description}</p>

        {!confirmed && (
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            {PIPELINE_LABELS[move.status] ?? "Not yet confirmed."}
          </p>
        )}

        <form action={updateMove} className="mt-4 flex flex-col gap-4" onSubmit={onClose}>
          <input type="hidden" name="actionId" value={move.id} />

          <div className="flex flex-wrap gap-6">
            <fieldset className="field">
              <span className="field-label">Move kind</span>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="moveKind"
                    value="ROUTINE"
                    defaultChecked={move.moveKind !== "GAMBIT"}
                  />
                  Routine
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="moveKind" value="GAMBIT" defaultChecked={move.moveKind === "GAMBIT"} />
                  Gambit
                </label>
              </div>
            </fieldset>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="opposed" defaultChecked={move.opposed} />
              Opposed
            </label>

            <label className="field">
              <span className="field-label">Status</span>
              <select name="moveReviewStatus" defaultValue={move.moveReviewStatus ?? "OPEN"}>
                <option value="OPEN">Open</option>
                <option value="WAITING_FOR_OPPONENTS">Waiting for Opponents</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="SOLVED">Solved</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field-label">Resource ⬢ change (applied to the player&apos;s resources once marked Solved)</span>
            <input type="number" name="resourceDelta" defaultValue={move.resourceDelta ?? 0} />
          </label>

          <label className="field">
            <span className="field-label">Outcome (GM-facing only — not sent to the player)</span>
            <textarea name="resultMessage" rows={3} defaultValue={move.resultMessage ?? ""} />
          </label>

          <label className="field">
            <span className="field-label">Other Notes (GM-facing only)</span>
            <textarea name="gmNotes" rows={3} defaultValue={move.gmNotes ?? ""} />
          </label>

          <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <h3 className="mb-1 font-bold">Message players</h3>
            <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>
              Nothing above is sent automatically — privately DM anyone about this Move&apos;s outcome here.
            </p>
            <PartyRows characters={otherCharacters} />
          </div>

          <button type="submit" className="btn self-start">
            Save
          </button>
        </form>
      </div>
    </div>
  );
}
