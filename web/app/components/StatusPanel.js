import { gambitModifierTotal } from "@lifeweb/db/lib/gambitModifier";
import { DISAPPOINTMENT_THRESHOLD } from "@lifeweb/db/lib/hungerPass";
import { ATE_MEAL_SLUG, CATATONIC_SLUG, DISAPPOINTED_SLUG, NOBILITY_SLUG } from "@lifeweb/db/lib/constants";
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
function ThisTurn({ currentAction, openTurn, pendingOffers = [] }) {
  if (!openTurn) return <span className="text-muted">No turn is open.</span>;
  const cutoff = <MoveCutoff window={openTurn.moveWindow} />;
  // A handshake still waiting on the other side (docs/systemdocs/LESSONS.md).
  // Shown above the Move line either way: an offer you made is why your Move
  // isn't filed yet, and one made to you is waiting in your DMs.
  const waiting = pendingOffers.map((o) => (
    <span key={o.id} className="text-muted">
      {o.mine
        ? o.kind === "BIND"
          ? `Waiting for ${o.otherName} to agree to be bound. ‡`
          : `Waiting for ${o.otherName} to accept the lesson${o.tagName ? ` in ${o.tagName}` : ""}. ‡`
        : o.kind === "BIND"
          ? `${o.otherName} wants to bind you — answer in your DMs. ‡`
          : `${o.otherName} offered a lesson${o.tagName ? ` in ${o.tagName}` : ""} — answer in your DMs. ‡`}
    </span>
  ));
  if (!currentAction)
    return (
      <>
        {waiting}
        <span className="text-muted">Not filed yet.</span>
        {cutoff}
      </>
    );

  const { status, moveReviewStatus, resourceRollValue, resourceRollExpression } = currentAction;

  let stateLine;
  if (status === "PENDING_TYPE" || status === "PENDING" || status === "PENDING_OPPOSED") {
    stateLine = <span className="text-muted">Not locked in yet — check your Discord DMs.</span>;
  } else if (moveReviewStatus === "SOLVED") {
    stateLine = <span className="text-positive">Solved.</span>;
  } else {
    // Always empty for a Gambit now: app/(app)/character/page.js strips the
    // die server-side, and this panel's only mount is that page. Kept rather
    // than deleted so the panel stays honest about whatever it is handed —
    // a Routine has never had a die either, and this is the same branch.
    const roll = rollLabel(currentAction);
    // The range, not just the number. A bare "+7 ⬢" is unreadable: the roll's
    // floor moves with GameConfig.productionCoefficient, with the Location's
    // own yield coefficient, and with whatever tools folded into it
    // (LABORING.md), so a player who knows their tier's written rate can't
    // tell a low roll from a missing bonus — which is exactly how "Butcher
    // isn't applying" got reported. The stored expression
    // is already a plain "min-max" string; en-dash it here rather than import
    // formatRangeExpression, which would drag @lifeweb/db into this bundle.
    const range = /^\d+-\d+$/.test(resourceRollExpression ?? "")
      ? resourceRollExpression.replace("-", "–")
      : null;
    const amount = resourceRollValue != null ? `${resourceRollValue > 0 ? "+" : ""}${resourceRollValue} ⬢` : null;
    const payout = amount && range ? `${range} → ${amount}` : amount;
    // Without this the line just loses its middle and reads as if nothing was
    // rolled. Same words the confirm DM uses (bot/src/lib/moveConfirm.js), so
    // the two surfaces promise the same moment.
    const pending = !roll && currentAction.moveKind === "GAMBIT";
    stateLine = (
      <span className="text-muted">
        Locked in{roll ? ` — ${roll}` : ""}
        {payout ? ` (${payout})` : ""}.{" "}
        {pending ? "🎲 The die is cast — you'll see how it fell when the turn ends." : "Results land when the turn ends."}
      </span>
    );
  }

  return (
    <>
      {waiting}
      <span className="field-label">{moveKindLabel(currentAction.moveKind, currentAction.gmNotes)}</span>
      <ExpandableText text={currentAction.description} lines={3} />
      {stateLine}
      {cutoff}
    </>
  );
}

// What holds a carry cap up, as one hover string. Assets are absent on
// purpose: they raise the cap without ever weighing on it (CARRY.md §1).
function carryCapTitle(carry) {
  const lines = [`Base ${carry.baseWeightCap} lb`];
  // Signed, because a body can now push the cap down as well as up: a Cart
  // reads "+4", Frail reads "−0.1" (CARRY.md §1).
  for (const m of carry.breakdown ?? []) {
    lines.push(`${m.name} ${m.bonus > 0 ? "+" : "−"}${Math.abs(m.bonus)}`);
  }
  lines.push(`= ${carry.weightCap} lb, and ${carry.weightHardCap} lb is the most you could ever hold.`);
  return lines.join("\n");
}

export default function StatusPanel({
  character,
  isSelf,
  currentAction,
  openTurn,
  carry = null,
  zoneMoves = null,
  zoneMovesReason = null,
  pendingOffers = [],
}) {
  // Hunger is the only Gambit contributor, and this is the same module the bot
  // rolls against (db/lib/gambitModifier.js) — so what a player reads here is
  // exactly what gets applied.
  const total = gambitModifierTotal(character.tags, { hungerStreak: character.hungerStreak });

  // Same shape tolerance as gambitModifierTotal above: CharacterTag[] with a
  // joined tag. The catatonic tag is granted/cleared only by the turn pass
  // (db/lib/catatonicPass.js), so this row explains itself rather than
  // leaving the player to find one grey chip among their tags.
  const catatonic = character.tags?.some((ct) => (ct?.tag?.slug ?? ct?.slug) === CATATONIC_SLUG);

  // The Nobility dinner tracker. Same reasoning as the Catatonic row: the
  // disappointed tag is granted by a turn pass (db/lib/hungerPass.js) and
  // cleared by eating, so the sheet explains the state rather than leaving a
  // grey chip to be puzzled out — and for a noble who is NOT yet Disappointed
  // it answers the question the tag can't: "how long until it lands?"
  // missedMealStreak counts turn closes without a Fine/Lavish Meal, same
  // authorship rule as hungerStreak above.
  const heldSlugs = new Set((character.tags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug));
  const noble = heldSlugs.has(NOBILITY_SLUG);
  const disappointed = heldSlugs.has(DISAPPOINTED_SLUG);
  const ateMeal = heldSlugs.has(ATE_MEAL_SLUG);
  const missedMeals = character.missedMealStreak ?? 0;
  const missesLeft = DISAPPOINTMENT_THRESHOLD - missedMeals;

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
          {catatonic && (
            <Row label="Condition">
              <span className="text-muted">
                Catatonic — lifts the moment {isSelf ? "you" : "they"} act or speak in character.
              </span>
            </Row>
          )}

          {disappointed && (
            <Row label="Condition">
              <span className="text-muted">Disappointed — a fine meal will fix it.</span>
            </Row>
          )}

          {noble && !disappointed && (
            <Row label="Dinner">
              <span className="text-muted">
                {ateMeal
                  ? "Seen to."
                  : missesLeft <= 1
                    ? `${missedMeals === 1 ? "A day" : `${missedMeals} days`} without a fine meal — Disappointed at turn's end.`
                    : missedMeals === 0
                      ? `No fine meal yet. ${DISAPPOINTMENT_THRESHOLD} missed days and ${isSelf ? "you're" : "they're"} Disappointed.`
                      : `${missedMeals === 1 ? "A day" : `${missedMeals} days`} without a fine meal — ${missesLeft} more and ${isSelf ? "you're" : "they're"} Disappointed.`}
              </span>
            </Row>
          )}

          {/* Where they stand is the Location; the zone is the region it
              sits in, and what the #summary channel belongs to. */}
          <Row label="Location">{character.location?.name ?? "Nowhere ‡"}</Row>

          <Row label="Zone">{character.zone?.name ?? "Unassigned"}</Row>

          {/* Free zone crossings left this turn (CARRY.md §2). Past these a
              crossing spends the Move; at zero — which is what Overburdened
              does — the first one already does. */}
          {zoneMoves != null && (
            <Row label="Zone moves ‡">
              {/* The reason rides in the hover for the same reason the carry
                  cap's breakdown does: a bare 0 leaves a lamed or overloaded
                  player with nothing to act on. */}
              <span
                className="mono"
                title={zoneMovesReason ?? undefined}
                style={zoneMoves === 0 ? { color: "var(--accent-text)" } : undefined}
              >
                {zoneMoves} free ‡
              </span>
            </Row>
          )}

          {/* Load against the carry caps (CARRY.md). `carry` is computed
              server-side by character/page.js for the owner's own sheet
              only; another player's sheet shows the bare balance. Over a
              cap reads in accent — the Overburdened tag says the rest. */}
          <Row label="Resources">
            {carry ? (
              <span className="mono" style={carry.resources > carry.resourcesCap ? { color: "var(--accent-text)" } : undefined}>
                {carry.resources} / {carry.resourcesCap} ⬢
              </span>
            ) : (
              <>{character.resources} ⬢</>
            )}
          </Row>

          {carry && (
            <Row label="Carrying ‡">
              {/* The cap carries a title= breakdown so a player can see what is
                  holding it up — the base, then one line per active
                  multiplier. Native tooltip on purpose: it needs no state, no
                  portal, and it works on the desk and the phone alike. */}
              <span
                className="mono"
                title={carryCapTitle(carry)}
                style={carry.weightUsed > carry.weightCap ? { color: "var(--accent-text)" } : undefined}
              >
                {carry.weightUsed} / {carry.weightCap} lb ‡
              </span>
            </Row>
          )}

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
            <ThisTurn currentAction={currentAction} openTurn={openTurn} pendingOffers={pendingOffers} />
          </Row>
        </dl>

        {isSelf && <ActionGrid />}
      </div>
    </section>
  );
}
