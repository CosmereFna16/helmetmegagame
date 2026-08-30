import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { moveKindLabel, rollLabel } from "@/lib/moves";
import TagPointsValue from "./TagPointsValue";
import ActionGrid from "./ActionGrid";
import ExpandableText from "./ExpandableText";

// A labelled row, so Zone / Resources / Gambit line up on one grid instead
// of each being its own ad-hoc flex line. `stacked` swaps the value cell to a
// column for content that clamps onto multiple lines (the Move description)
// — the default flex-wrap row fights a CSS line-clamp otherwise.
function Row({ label, children, stacked = false }) {
  return (
    <>
      <dt className="field-label" style={{ alignSelf: stacked ? "start" : "center" }}>
        {label}
      </dt>
      <dd className={`m-0 text-sm ${stacked ? "flex flex-col items-start gap-1" : "flex flex-wrap items-center gap-2"}`}>
        {children}
      </dd>
    </>
  );
}

// Rendered on the server, so a viewer-local time isn't available — and the
// game's clock is Chicago anyway (turns roll at 00:00/12:00 CT), which is what
// the handbook and the Discord announcement both quote. Labelled CT so nobody
// reads it as their own wall clock.
const CT_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});

// The Move cutoff (db/lib/turnClock.js), attached to the turn by
// app/(app)/character/page.js. Absent when there is no lock this turn — a
// manually advanced short turn, or auto-advance switched off.
function MoveCutoff({ window: moveWindow }) {
  if (!moveWindow?.hasLock) return null;
  return moveWindow.locked ? (
    <span className="text-muted">
      Moves are locked for this turn — the next turn opens at {CT_TIME.format(new Date(moveWindow.endsAt))} CT.
    </span>
  ) : (
    <span className="text-muted">Moves lock at {CT_TIME.format(new Date(moveWindow.cutoffAt))} CT.</span>
  );
}

// The player's own read of the Move they filed this turn — the same row the
// bot's DM confirms, just left standing where they can check it later
// instead of scrolling Discord. Player-facing wording, not the GM workflow
// enums (moveReviewStatus's "Passed"/"Open" mean nothing to a player).
function ThisTurn({ currentAction, openTurn }) {
  if (!openTurn) return <span className="text-muted">No turn is open.</span>;
  const cutoff = <MoveCutoff window={openTurn.moveWindow} />;
  if (!currentAction)
    return (
      <>
        <span className="text-muted">Not filed yet.</span>
        {cutoff}
      </>
    );

  const { status, moveReviewStatus, resourceRollValue } = currentAction;

  let stateLine;
  if (status === "PENDING_TYPE" || status === "PENDING" || status === "PENDING_OPPOSED") {
    stateLine = <span className="text-muted">Not locked in yet — check your Discord DMs.</span>;
  } else if (moveReviewStatus === "SOLVED") {
    stateLine = <span className="text-positive">Solved.</span>;
  } else {
    const roll = rollLabel(currentAction);
    const payout = resourceRollValue != null ? `${resourceRollValue > 0 ? "+" : ""}${resourceRollValue} ⬢` : null;
    stateLine = (
      <span className="text-muted">
        Locked in{roll ? ` — ${roll}` : ""}
        {payout ? ` (${payout})` : ""}. Results land when the turn ends.
      </span>
    );
  }

  return (
    <>
      <span className="field-label">{moveKindLabel(currentAction.moveKind, currentAction.gmNotes)}</span>
      <ExpandableText text={currentAction.description} lines={3} />
      {stateLine}
      {cutoff}
    </>
  );
}

export default function StatusPanel({ character, isSelf, currentAction, openTurn }) {
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

          <Row label="This turn" stacked>
            <ThisTurn currentAction={currentAction} openTurn={openTurn} />
          </Row>
        </dl>

        {isSelf && <ActionGrid />}
      </div>
    </section>
  );
}
