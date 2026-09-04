"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotSendShuttle, openCrate } from "@/app/(app)/depot/actions";
import RequestDialog from "./RequestDialog";
import TagChip from "./TagChip";
import Tooltip from "./Tooltip";
import EmptyState from "./EmptyState";

// What is on the landing pad, and the button that sends it up.
//
// The pad is a real room — a private thread gated on the Depot Keycard — so
// this panel is a VIEW of a stash, not a separate inventory. Anything here can
// also be picked up by hand by anyone who can get into the room, which is the
// point: a shipment sitting on the pad is a shipment that can be robbed.
export default function DepotHoldTab({ pad, crates, depot, disabled, shuttleTurnsLeft }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(null); // "send" | a crate row
  const [error, setError] = useState(null);

  const docked = depot.shuttleState === "DOCKED";
  // The shuttle sells GOODS. Loose ⬢ in the stash stay where they are — the
  // Bank's ⬢ counter is marginless and always open, so there is no reason to
  // fly them up. An obol is one ⬢, so the payout is just the goods total. The
  // same arithmetic the server does; see the depot's sendShuttle action.
  const payout = pad.rows.reduce((s, r) => s + (r.sellPrice ?? 0) * r.quantity, 0);

  function submitSend(reason) {
    startTransition(async () => {
      const result = await depotSendShuttle({ reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      refresh();
    });
  }

  function submitOpen(reason) {
    const crate = confirming;
    startTransition(async () => {
      const result = await openCrate({ tagId: crate.id, reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel p-5">
        <h2 className="panel-header">The Landing Pad</h2>
        <p className="mt-1 text-sm text-muted">
          {docked
            ? `The shuttle is on the pad${shuttleTurnsLeft != null ? `, and leaves on its own in ${shuttleTurnsLeft} turn${shuttleTurnsLeft === 1 ? "" : "s"}` : ""}. ‡`
            : "The pad is empty of anything that flies. What is stacked on it stays where it is. ‡"}
        </p>

        {pad.rows.length === 0 && !pad.resources ? (
          <EmptyState>Nothing on the pad. ‡</EmptyState>
        ) : (
          <ul className="depot-list mt-4">
            {pad.rows.map((row) => (
              <li key={row.id}>
                <TagChip tag={row.tag} />
                <span className="mono">
                  ×{row.quantity}
                  {row.sellPrice ? ` · ${row.sellPrice * row.quantity} ¢` : ""}
                </span>
              </li>
            ))}
            {pad.resources > 0 && (
              <li>
                <span>Resources in the stash</span>
                <span className="mono">{pad.resources} ⬢</span>
              </li>
            )}
          </ul>
        )}

        <dl className="depot-totals">
          <div>
            <dt>Sends up as</dt>
            <dd className="mono">{payout} ¢</dd>
          </div>
        </dl>

        <Tooltip text="Everything on the pad goes up and comes back as obols, one for every ⬢ it is worth. ‡">
          <button
            type="button"
            className="btn mt-4"
            disabled={disabled || pending || !docked}
            onClick={() => setConfirming("send")}
          >
            Load it up and send it back
          </button>
        </Tooltip>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">Crates you are carrying</h2>
        <p className="mt-1 text-sm text-muted">
          A crate has to be opened before anything inside it is yours. A sealed one wants a Depot
          Keycard. ‡
        </p>
        {crates.length === 0 ? (
          <EmptyState>You are not carrying any crates. ‡</EmptyState>
        ) : (
          <ul className="depot-list mt-4">
            {crates.map((crate) => (
              <li key={crate.id}>
                <span className="depot-crate-line">
                  <span>{crate.name}</span>
                  <span className="depot-manifest mono">{crate.description}</span>
                </span>
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={pending || !crate.canOpen}
                  onClick={() => setConfirming(crate)}
                >
                  {crate.canOpen ? "Open" : "Sealed"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirming === "send" && (
        <RequestDialog
          open
          title="Send the shuttle back"
          submitLabel="Send it up"
          busy={pending}
          error={error}
          onCancel={() => setConfirming(null)}
          onConfirm={submitSend}
        >
          <p className="text-sm text-muted">
            Everything on the pad goes with it, and {payout} ¢ lands in the account.
            This is the only way Resources become obols. ‡
          </p>
        </RequestDialog>
      )}

      {confirming && confirming !== "send" && (
        <RequestDialog
          open
          title={`Open ${confirming.name}`}
          submitLabel="Crack it open"
          busy={pending}
          error={error}
          onCancel={() => setConfirming(null)}
          onConfirm={submitOpen}
        >
          <p className="text-sm text-muted">
            The crate is destroyed and whatever is inside goes into your hands. Mind your carry
            weight. ‡
          </p>
        </RequestDialog>
      )}
    </div>
  );
}
