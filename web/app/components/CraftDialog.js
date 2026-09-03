"use client";

import PartySelect from "./PartySelect";
import Select from "./Select";

// The body of the Craft dialog (docs/systemdocs/CRAFTING.md). State lives in
// RequestActionsProvider like every other mode — this is the form.
//
// Two jobs in one dialog. Pick a project you already have going and the
// form becomes Continue / Cancel for it; pick nothing and it's the recipe
// menu (the provider's TagPicker, passed in as `picker`), a quantity for a
// stackable, and who pays. A recipe with turns is this turn's Move, and the
// form says so before the confirm does.

export default function CraftDialog({
  projects,
  projectId,
  onProject,
  projectChoice,
  onProjectChoice,
  picker,
  chosen,
  stacking,
  quantity,
  onQuantity,
  payerKey,
  onPayer,
  parties,
  selfId,
  hasMoved,
}) {
  const project = projects.find((p) => p.id === projectId) ?? null;
  const turns = chosen?.requirementTurns ?? 1;
  const qty = Math.max(1, Number(quantity) || 1);
  const cost = (chosen?.requirementResources ?? 0) * (chosen?.stackable ? qty : 1);

  return (
    <>
      {projects.length > 0 && (
        <label className="field">
          <span className="field-label">In progress ‡</span>
          <Select value={projectId} onChange={(e) => onProject(e.target.value)}>
            <option value="">Start something new… ‡</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.quantity > 1 ? `${p.quantity}× ` : ""}
                {p.tagName} — {p.turnsDone} of {p.turnsNeeded} turns ‡
              </option>
            ))}
          </Select>
        </label>
      )}

      {project ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="craft-project"
                checked={projectChoice === "continue"}
                onChange={() => onProjectChoice("continue")}
                disabled={hasMoved || project.workedThisTurn}
              />
              Keep working on it ‡
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="craft-project"
                checked={projectChoice === "cancel"}
                onChange={() => onProjectChoice("cancel")}
              />
              Give it up ‡
            </label>
          </div>
          <p className="text-xs text-muted">
            {project.workedThisTurn
              ? "You've already put this turn into it. Come back next turn. ‡"
              : hasMoved
                ? "You've used your Move this turn, so the work waits. ‡"
                : `One more turn of work — your Move for this turn. ${project.turnsNeeded - project.turnsDone === 1 ? "That finishes it." : `${project.turnsNeeded - project.turnsDone} to go.`} ‡`}
            {project.resourcesCost
              ? ` The ${project.resourcesCost} ⬢ went into materials when you started and don't come back. ‡`
              : ""}
          </p>
        </>
      ) : (
        <>
          {picker}
          {chosen && (
            <>
              {stacking && (
                <label className="field" style={{ width: "10rem" }}>
                  <span className="field-label">How many?</span>
                  <input type="number" min="1" max="99" value={quantity} onChange={(e) => onQuantity(e.target.value)} />
                </label>
              )}
              {cost > 0 && (
                <PartySelect
                  label="Paid for by ‡"
                  value={payerKey}
                  onChange={onPayer}
                  hint="Choose who pays… ‡"
                  characters={parties?.characters ?? []}
                  rooms={parties?.rooms ?? []}
                  selfId={selfId}
                />
              )}
              <p className="text-xs text-muted">
                {turns === 0
                  ? "Dead Simple: no Move needed, up to 4 a turn. ‡"
                  : turns === 1
                    ? "One turn of work — this is your Move for the turn. ‡"
                    : `${turns} turns of work. This turn is the first; come back here to continue. ‡`}
                {cost > 0 ? ` Costs ${cost} ⬢, paid now. ‡` : " Costs nothing. ‡"}
                {turns > 0 && hasMoved ? " You've already used your Move this turn. ‡" : ""}
              </p>
            </>
          )}
        </>
      )}
    </>
  );
}
