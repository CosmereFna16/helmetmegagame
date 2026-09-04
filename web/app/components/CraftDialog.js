"use client";

import PartySelect from "./PartySelect";
import Select from "./Select";
import { needsWorkshop } from "@/lib/tagRequests";
import QuantityField from "./QuantityField";

// The body of the Craft dialog (docs/systemdocs/CRAFTING.md). State lives in
// RequestActionsProvider like every other mode — this is the form.
//
// Two jobs in one dialog. Pick something you already have going and the
// form becomes Continue / Cancel for it; pick nothing and it's the recipe
// menu (the provider's TagPicker, passed in as `picker`), a quantity for a
// stackable, and who pays. A recipe with turns is this turn's Move, and the
// form says so before the confirm does.
//
// "Something you have going" is two lists, not one. A CraftProject is yours
// alone; a build site standing where you are is anybody's to lend a turn to
// (db/lib/structures.js), so the two share the one dropdown under separate
// groups. The pick crosses as a prefixed key because a select has one value
// and these are two id spaces.

export default function CraftDialog({
  projects,
  projectId,
  // Build sites UNDER_CONSTRUCTION at this Location, and which one is picked.
  sites = [],
  siteId = "",
  // Takes "" | "project:<id>" | "site:<id>".
  onPick,
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
  hasWorkshop = false,
}) {
  const project = projects.find((p) => p.id === projectId) ?? null;
  const site = sites.find((s) => s.id === siteId) ?? null;
  const inProgress = project ? `project:${project.id}` : site ? `site:${site.id}` : "";
  const projectOptions = projects.map((p) => (
    <option key={p.id} value={`project:${p.id}`}>
      {p.quantity > 1 ? `${p.quantity}× ` : ""}
      {p.tagName} — {p.turnsDone} of {p.turnsNeeded} turns ‡
    </option>
  ));
  const turns = chosen?.requirementTurns ?? 1;
  const qty = Math.max(1, Number(quantity) || 1);
  const cost = (chosen?.requirementResources ?? 0) * (chosen?.stackable ? qty : 1);
  // Smith's work needs a forge in reach (SMITHING.md). Said here so a player
  // sees it before committing; craftRequest re-checks it regardless.
  const wantsWorkshop = chosen ? needsWorkshop(chosen) : false;

  return (
    <>
      {(projects.length > 0 || sites.length > 0) && (
        <label className="field">
          <span className="field-label">In progress ‡</span>
          <Select value={inProgress} onChange={(e) => onPick(e.target.value)}>
            <option value="">Start something new… ‡</option>
            {/* Grouped only when there is a second group to tell them apart
                from — one list of your own projects reads better bare. */}
            {projects.length > 0 &&
              (sites.length > 0 ? (
                <optgroup label="Your work ‡">{projectOptions}</optgroup>
              ) : (
                projectOptions
              ))}
            {sites.length > 0 && (
              <optgroup label="Build sites here ‡">
                {sites.map((s) => (
                  <option key={s.id} value={`site:${s.id}`}>
                    {s.typeName} ({s.turnsDone}/{s.turnsNeeded}) ‡
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </label>
      )}

      {site ? (
        <>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="craft-project"
                checked={projectChoice === "continue"}
                onChange={() => onProjectChoice("continue")}
                disabled={hasMoved}
              />
              Keep working on it ‡
            </label>
            {/* Only the person who opened the site may call it off, and
                cancelBuildSite refuses anyone else regardless. */}
            {site.mine && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="craft-project"
                  checked={projectChoice === "cancel"}
                  onChange={() => onProjectChoice("cancel")}
                />
                Give it up ‡
              </label>
            )}
          </div>
          <p className="text-xs text-muted">
            {hasMoved
              ? "You've used your Move this turn, so the work waits. ‡"
              : `One more turn of work — your Move for this turn. ${site.turnsNeeded - site.turnsDone === 1 ? "That finishes it." : `${site.turnsNeeded - site.turnsDone} to go.`} ‡`}
          </p>
        </>
      ) : project ? (
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
              {/* 99 is the server's own clamp (craftRequestImpl's parseCount),
                  not an arbitrary UI bound. The per-turn caps on Dead Simple
                  and medical work are enforced server-side and can't be known
                  here. */}
              {stacking && (
                <QuantityField
                  label="How many? ‡"
                  max={99}
                  value={quantity}
                  onChange={onQuantity}
                />
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
                  ? chosen.requirementPerTurn != null
                    ? `No Move needed, up to ${chosen.requirementPerTurn} a turn. ‡`
                    : "Dead Simple: no Move needed, up to 4 a turn. ‡"
                  : turns === 1
                    ? "One turn of work — this is your Move for the turn. ‡"
                    : `${turns} turns of work. This turn is the first; come back here to continue. ‡`}
                {cost > 0 ? ` Costs ${cost} ⬢, paid now. ‡` : " Costs nothing. ‡"}
                {turns > 0 && hasMoved ? " You've already used your Move this turn. ‡" : ""}
              </p>
              {wantsWorkshop && (
                <p className={`text-xs ${hasWorkshop ? "text-muted" : "text-accent"}`}>
                  {hasWorkshop
                    ? "Smith's work, and you have Workshop Equipment to hand. ‡"
                    : "Smith's work: you need Workshop Equipment, held or set up where you're standing. ‡"}
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
