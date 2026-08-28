import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import TagPointsValue from "./TagPointsValue";
import ActionGrid from "./ActionGrid";

// A labelled row, so Zone / Resources / Gambit line up on one grid instead
// of each being its own ad-hoc flex line.
function Row({ label, children }) {
  return (
    <>
      <dt className="field-label" style={{ alignSelf: "center" }}>
        {label}
      </dt>
      <dd className="m-0 flex flex-wrap items-center gap-2 text-sm">{children}</dd>
    </>
  );
}

export default function StatusPanel({ character, isSelf }) {
  // Hunger is the only Gambit contributor, and this is the same module the bot
  // rolls against (db/lib/gambitModifier.js) — so what a player reads here is
  // exactly what gets applied.
  const total = gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak });

  return (
    <section className="panel p-4">
      <h2 className="panel-header">Status</h2>

      {/* The readout and the Actions block side by side, rather than the
          actions stacked under a divider at the bottom. Everything a player
          does now lives in that grid, so it earns the space next to the
          numbers it acts on — and the panel stays about as tall as the <dl>
          alone used to be. Below `sm` the grid drops underneath. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <dl
          className="grid min-w-0 flex-1 gap-x-4 gap-y-2"
          style={{ gridTemplateColumns: "auto minmax(0, 1fr)", margin: 0 }}
        >
          <Row label="Zone">{character.zone?.name ?? "Unassigned"}</Row>

          <Row label="Resources">{character.resources} ⬢</Row>

          <Row label="Gambit">
            {total ? (
              <span style={{ color: "var(--accent-text)" }}>{total} to the die</span>
            ) : (
              <span className="text-muted">No modifier</span>
            )}
          </Row>

          <Row label="Tag Points">
            <TagPointsValue points={character.tagPoints} />
          </Row>
        </dl>

        {isSelf && <ActionGrid />}
      </div>
    </section>
  );
}
