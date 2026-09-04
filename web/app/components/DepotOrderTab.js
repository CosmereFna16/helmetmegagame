"use client";

import { useMemo, useState, useTransition } from "react";
import { useRefresh } from "./useRefresh";
import { depotOrder, depotCallShuttle } from "@/app/(app)/depot/actions";
import { FilterBar, TableScroll, SortHeader, useTableState } from "./DataTable";
import Pager from "./Pager";
import RequestDialog from "./RequestDialog";
import TagChip from "./TagChip";
import Tooltip from "./Tooltip";

// The working table: what the station stocks, what it pays back, and the
// spread between the two. The margin column is the reason this is a table and
// not a shelf of cards — a Merchant is comparing numbers, and comparing
// numbers wants them in a column.
//
// The margin shown is what the DEPOT makes, not what he does: buy at 8 and
// sell back at 3 and you are down 5. His actual profit comes from selling to
// Ravenheart at whatever Ravenheart will bear, which is not a number this app
// knows. The column is there so he can see how badly the station would gouge
// him if he changed his mind, which is the real decision at the counter.
const SEARCH_FIELDS = [(r) => r.name, (r) => r.description];
const FILTER_DEFS = [{ key: "group", label: "Kind", value: (r) => r.groupName ?? "" }];

// The catalog prices in ⬢ and the account pays in obols, so the rows show ⬢
// and the total shows both. Converting per row would print fractions at every
// line and round a cart of cheap things into nonsense; the server converts the
// same way, on the total. See db/lib/depotState.js#obolsToPay.
function toObols(resources, rate) {
  return Math.ceil(Math.max(0, resources) / Math.max(1, rate));
}

export default function DepotOrderTab({ wares, depot, disabled, manifest }) {
  const [refresh] = useRefresh();
  const [pending, startTransition] = useTransition();
  const [cart, setCart] = useState(() => new Map());
  const [confirming, setConfirming] = useState(null); // "order" | "call"
  const [error, setError] = useState(null);

  const table = useTableState({
    rows: wares,
    searchFields: SEARCH_FIELDS,
    filterDefs: FILTER_DEFS,
    initialSort: { key: "price", dir: "asc" },
  });

  const cartLines = useMemo(
    () =>
      [...cart.entries()]
        .map(([id, quantity]) => ({ ...wares.find((w) => w.id === id), quantity }))
        .filter((l) => l.id && l.quantity > 0),
    [cart, wares],
  );
  const cartResources = cartLines.reduce((s, l) => s + l.price * l.quantity, 0);
  const cartTotal = toObols(cartResources, depot.obolRate);
  const after = (depot.accountObols ?? 0) - cartTotal;
  const affordable = after >= 0;

  function bump(id, delta) {
    setCart((prev) => {
      const next = new Map(prev);
      const n = (next.get(id) ?? 0) + delta;
      if (n <= 0) next.delete(id);
      else next.set(id, Math.min(99, n));
      return next;
    });
  }

  function submitOrder(reason) {
    startTransition(async () => {
      const result = await depotOrder({
        items: cartLines.map((l) => ({ tagId: l.id, quantity: l.quantity })),
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCart(new Map());
      setConfirming(null);
      refresh();
    });
  }

  function submitCall(reason) {
    startTransition(async () => {
      const result = await depotCallShuttle({ reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      refresh();
    });
  }

  const shuttleAway = depot.shuttleState === "AWAY";

  return (
    <div className="depot-split">
      <section className="panel p-5">
        <h2 className="panel-header">Order</h2>
        <p className="mt-1 text-sm text-muted">
          What the orbital station will put on a shuttle. Obols leave the account when you order;
          the goods arrive when you call the shuttle down. ‡
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <FilterBar
            filterDefs={FILTER_DEFS}
            filters={table.filters}
            setFilters={table.setFilters}
            options={table.options}
            query={table.query}
            setQuery={table.setQuery}
            searchLabel="Search wares"
          />

          <TableScroll minWidth="40rem">
            <thead>
              <tr>
                <SortHeader label="Ware" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Buy" sortKey="price" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Sell" sortKey="sellPrice" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Margin" sortKey="margin" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Held" sortKey="held" sort={table.sort} onSort={table.toggleSort} />
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {table.pageRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <TagChip tag={row.tag} />
                    {row.sealed && (
                      <Tooltip text="Ships sealed. Its crate prints no manifest, and only a Depot Keycard opens it.">
                        <span className="depot-seal">SEALED</span>
                      </Tooltip>
                    )}
                  </td>
                  <td className="mono">{row.price} ⬢</td>
                  <td className="mono text-muted">{row.sellPrice == null ? "—" : `${row.sellPrice} ⬢`}</td>
                  <td className={`mono ${row.margin != null && row.margin < 0 ? "text-danger" : "text-muted"}`}>
                    {row.margin == null ? "—" : `${row.margin > 0 ? "+" : ""}${row.margin} ⬢`}
                  </td>
                  <td className="mono text-muted">{row.held || "—"}</td>
                  <td className="depot-stepper-cell">
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={disabled || !cart.get(row.id)}
                      onClick={() => bump(row.id, -1)}
                      aria-label={`One fewer ${row.name}`}
                    >
                      −
                    </button>
                    <span className="mono depot-stepper-count">{cart.get(row.id) ?? 0}</span>
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={disabled}
                      onClick={() => bump(row.id, 1)}
                      aria-label={`One more ${row.name}`}
                    >
                      +
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
          <Pager
            page={table.page}
            totalPages={table.totalPages}
            total={table.total}
            unit="wares"
            onPage={table.setPage}
          />
        </div>
      </section>

      <section className="panel p-5 depot-aside">
        <h2 className="panel-header">Manifest</h2>

        {manifest.length > 0 && (
          <div className="depot-pending">
            <span className="depot-stat-label">Already ordered, waiting on the shuttle</span>
            <ul className="depot-list">
              {manifest.map((l, i) => (
                <li key={`${l.tagId}-${i}`}>
                  <span>{l.name}</span>
                  <span className="mono">×{l.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cartLines.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing picked yet. ‡</p>
        ) : (
          <ul className="depot-list mt-3">
            {cartLines.map((l) => (
              <li key={l.id}>
                <span>{l.name}</span>
                <span className="mono">
                  ×{l.quantity} · {l.price * l.quantity} ⬢
                </span>
              </li>
            ))}
          </ul>
        )}

        <dl className="depot-totals">
          <div>
            <dt>Order</dt>
            <dd className="mono">
              {cartResources} ⬢ = {cartTotal} ¢
            </dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd className="mono">{depot.accountObols} ¢</dd>
          </div>
          <div className={affordable ? undefined : "text-danger"}>
            <dt>After</dt>
            <dd className="mono">{after} ¢</dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            className="btn"
            disabled={disabled || pending || !cartLines.length || !affordable}
            onClick={() => setConfirming("order")}
          >
            Place order
          </button>
          <Tooltip
            text={
              shuttleAway
                ? "Brings the shuttle down with everything ordered so far, packed into crates on the landing pad. An empty manifest still brings it — you need it down to load anything going up."
                : "It is already on the pad."
            }
          >
            <button
              type="button"
              className="btn-quiet w-full"
              disabled={disabled || pending || !shuttleAway}
              onClick={() => setConfirming("call")}
            >
              Call the shuttle down
            </button>
          </Tooltip>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      {confirming === "order" && (
        <RequestDialog
          open
          title="Place the order"
          submitLabel="Order"
          busy={pending}
          error={error}
          onCancel={() => setConfirming(null)}
          onConfirm={submitOrder}
        >
          <p className="text-sm text-muted">
            {cartResources} ⬢ of goods, which is {cartTotal} ¢ out of the account now. The goods arrive as crates the next time you call
            the shuttle down. ‡
          </p>
        </RequestDialog>
      )}

      {confirming === "call" && (
        <RequestDialog
          open
          title="Call the shuttle down"
          submitLabel="Call it down"
          busy={pending}
          error={error}
          onCancel={() => setConfirming(null)}
          onConfirm={submitCall}
        >
          <p className="text-sm text-muted">
            It lands on the pad and stays for up to {depot.shuttleMaxTurns} turns, then leaves on
            its own. Anything still on the pad when it goes stays behind. ‡
          </p>
        </RequestDialog>
      )}
    </div>
  );
}
