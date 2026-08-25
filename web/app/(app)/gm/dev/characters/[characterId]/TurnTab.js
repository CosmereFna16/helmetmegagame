"use client";

import Link from "next/link";

// The open turn, read-only, with a jump into the real adjudication surface.
//
// Deliberately not an inline Move editor: /gm/turns already owns that, with
// the cooperative lock, the dirty guard, Solve/Reject and the dice invariant
// on a Kind switch. A second editor here would be a second copy of all of it
// and would have to take the same lock anyway. The two verbs a GM wants from
// this panel — give the turn back, burn the turn — are in the action bar.
export default function TurnTab({ character, openTurn, action, defaultEffort }) {
  return (
    <>
      <section className="panel flex flex-col gap-3 p-4">
        <h2 className="panel-header">
          {openTurn ? `Turn ${openTurn.number} — ${openTurn.phase}` : "No turn is open"}
        </h2>

        {!action ? (
          <p className="text-sm text-muted">
            {character.name} hasn&apos;t acted this turn
          </p>
        ) : (
          <>
            <dl className="dev-state-strip">
              <div>
                <dt className="field-label">Kind</dt>
                <dd className="mono text-sm">{action.moveKind}</dd>
              </div>
              <div>
                <dt className="field-label">Status</dt>
                <dd className="mono text-sm">{action.moveReviewStatus}</dd>
              </div>
              <div>
                <dt className="field-label">Opposed</dt>
                <dd className="mono text-sm">{action.opposed ? "yes" : "no"}</dd>
              </div>
              <div>
                <dt className="field-label">Resources</dt>
                <dd className="mono text-sm">
                  {action.resourceDelta ? `${action.resourceDelta > 0 ? "+" : ""}${action.resourceDelta} ⬢` : "—"}
                </dd>
              </div>
              <div>
                <dt className="field-label">Dice</dt>
                <dd className="mono text-sm">
                  {action.diceRoll == null
                    ? "—"
                    : `${action.diceRoll}${action.diceModifier ? ` (${action.diceModifier > 0 ? "+" : ""}${action.diceModifier})` : ""}`}
                </dd>
              </div>
            </dl>

            <p className="text-sm">» {action.description}</p>
            {action.gmNotes && <p className="text-sm text-muted">GM notes: {action.gmNotes}</p>}

            <Link href="/gm/turns" className="btn-quiet self-start">
              Adjudicate in /gm/turns
            </Link>
          </>
        )}
      </section>

      <section className="panel flex flex-col gap-2 p-4">
        <h2 className="panel-header">Default Move</h2>
        {defaultEffort ? (
          <>
            <p className="text-sm">» {defaultEffort.description}</p>
            <p className="text-sm text-muted">
              Filed automatically at the close of any turn they don&apos;t act on, as a Routine.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">None set.</p>
        )}
      </section>
    </>
  );
}
