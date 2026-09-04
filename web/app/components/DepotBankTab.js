"use client";

import { useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotAtm, depotCredit, depotExchange } from "@/app/(app)/depot/actions";
import RequestDialog from "./RequestDialog";
import Tooltip from "./Tooltip";

// The ATM and the Company's line.
//
// This is the panel that makes the Merchant a banker rather than a shopkeeper.
// The account is a number; obols are objects. The ATM is the door between
// them, and it is the ONLY door — every coin in Ravenheart came out of this
// button, which is why lending is a thing he can actually do and nobody else
// can.
export default function DepotBankTab({ depot, heldObols, creditAvailable, resources, disabled }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null); // { kind, direction }
  const [amount, setAmount] = useState(1);
  const [error, setError] = useState(null);

  function ask(kind, direction, max) {
    setDialog({ kind, direction, max });
    setAmount(Math.min(1, max) || 1);
    setError(null);
  }

  function submit(reason) {
    const n = Math.max(1, Math.min(Number(amount) || 0, dialog.max));
    startTransition(async () => {
      const result =
        dialog.kind === "exchange"
          ? await depotExchange({ direction: dialog.direction, obols: n, reason })
          : await (dialog.kind === "atm" ? depotAtm : depotCredit)({
              direction: dialog.direction,
              amount: n,
              reason,
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDialog(null);
      refresh();
    });
  }

  const debt = depot.debtObols ?? 0;
  const cap = depot.creditCapObols ?? 0;
  const pct = cap > 0 ? Math.min(100, Math.round((debt / cap) * 100)) : 0;

  return (
    <div className="depot-split">
      <section className="panel p-5">
        <h2 className="panel-header">The ATM</h2>
        <p className="mt-1 text-sm text-muted">
          Coins out of the account, or coins back into it. An obol is worth one ⬢, and only at
          this counter — anywhere else it is a coin somebody has to agree to take. ‡
        </p>

        <dl className="depot-totals">
          <div>
            <dt>Account</dt>
            <dd className="mono">{depot.accountObols} ¢</dd>
          </div>
          <div>
            <dt>In your pocket</dt>
            <dd className="mono">{heldObols} ¢</dd>
          </div>
        </dl>

        <div className="mt-4 flex gap-2">
          <Tooltip text="Takes obols out of the account as physical coins you can carry, spend, lend, or lose. ‡">
            <button
              type="button"
              className="btn"
              disabled={disabled || pending || !depot.accountObols}
              onClick={() => ask("atm", "WITHDRAW", depot.accountObols)}
            >
              Withdraw
            </button>
          </Tooltip>
          <Tooltip text="Puts coins you are carrying back into the account. ‡">
            <button
              type="button"
              className="btn-quiet"
              disabled={disabled || pending || !heldObols}
              onClick={() => ask("atm", "DEPOSIT", heldObols)}
            >
              Deposit
            </button>
          </Tooltip>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">The ⬢ Counter</h2>
        <p className="mt-1 text-sm text-muted">
          Your own float, both ways, with no spread. One obol is one ⬢ whichever way it goes —
          you do not charge yourself a margin to use your own till. What this counter really does
          is make the number on your sheet into coins you can hand over, and back again. ‡
        </p>

        <dl className="depot-totals">
          <div>
            <dt>Account</dt>
            <dd className="mono">{depot.accountObols} ¢</dd>
          </div>
          <div>
            <dt>Your Resources</dt>
            <dd className="mono">{resources} ⬢</dd>
          </div>
        </dl>

        <div className="mt-4 flex gap-2">
          <Tooltip text="Turns obols in the account into Resources on your sheet, one for one. ‡">
            <button
              type="button"
              className="btn"
              disabled={disabled || pending || !depot.accountObols}
              onClick={() => ask("exchange", "BUY_RESOURCES", depot.accountObols)}
            >
              Buy ⬢
            </button>
          </Tooltip>
          <Tooltip text="Turns Resources on your sheet into obols in the account, one for one. ‡">
            <button
              type="button"
              className="btn-quiet"
              disabled={disabled || pending || resources < 1}
              onClick={() => ask("exchange", "SELL_RESOURCES", resources)}
            >
              Sell ⬢
            </button>
          </Tooltip>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="panel-header">The Company&apos;s Line</h2>
        <p className="mt-1 text-sm text-muted">
          Credit advanced against the business, in obols. Nothing in the code punishes a standing
          balance — the Company is not code. ‡
        </p>

        <div className="depot-meter" role="img" aria-label={`${debt} of ${cap} obols drawn`}>
          <span className="depot-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <dl className="depot-totals">
          <div>
            <dt>Drawn</dt>
            <dd className="mono">
              {debt} / {cap} ¢
            </dd>
          </div>
          <div>
            <dt>Still available</dt>
            <dd className="mono">{creditAvailable} ¢</dd>
          </div>
        </dl>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn"
            disabled={disabled || pending || !creditAvailable}
            onClick={() => ask("credit", "DRAW", creditAvailable)}
          >
            Draw
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={disabled || pending || !debt || !depot.accountObols}
            onClick={() => ask("credit", "REPAY", Math.min(debt, depot.accountObols))}
          >
            Repay
          </button>
        </div>
        {error && !dialog && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      {dialog && (
        <RequestDialog
          open
          title={
            dialog.kind === "exchange"
              ? dialog.direction === "BUY_RESOURCES"
                ? "Buy Resources"
                : "Sell Resources"
              : dialog.kind === "atm"
              ? dialog.direction === "WITHDRAW"
                ? "Withdraw obols"
                : "Deposit obols"
              : dialog.direction === "DRAW"
                ? "Draw on the line"
                : "Repay the line"
          }
          submitLabel="Confirm"
          busy={pending}
          error={error}
          onCancel={() => setDialog(null)}
          onConfirm={submit}
        >
          <label className="field">
            <span className="field-label">Amount (¢)</span>
            <input
              type="number"
              min="1"
              max={dialog.max}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <p className="mt-2 text-xs text-muted">
            At most {dialog.max} ¢
            {dialog.kind === "exchange" ? ", and an obol is one ⬢ either way" : ""}. ‡
          </p>
        </RequestDialog>
      )}
    </div>
  );
}
