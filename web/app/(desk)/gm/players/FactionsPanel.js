"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import FactionLink from "@/app/components/FactionLink";
import CharacterLink from "@/app/components/CharacterLink";
import RequestDialog from "@/app/components/RequestDialog";
import Select from "@/app/components/Select";
import IconButton from "@/app/components/IconButton";
import { ResourcesIcon } from "@/app/components/icons";
import { useRefresh } from "@/app/components/useRefresh";
import { transferSiloResources } from "./actions";

// The all-factions overview, the Factions tab of the Players panel.
//
// It used to be the GM branch of /faction. That page now redirects a GM here,
// so this is the only copy. Clicking a faction's name stays in this desk —
// highlightFactionId/onSelectFaction (RosterTable.js) mark and scroll to its
// row here instead of navigating away. Its Manage link is the door back to
// /faction's still-live per-faction detail view (member roles, add/remove,
// Silo history) — this table only ever shows a member count, not the roster.

// Same tint the desk uses for a claimed conversation row — color-mix over
// --accent-text rather than a dedicated background token, since none exists
// for this weight of highlight (globals.css).
const HIGHLIGHT_STYLE = { background: "color-mix(in srgb, var(--accent-text) 14%, transparent)" };

function buildChildrenMap(factions) {
  const map = new Map();
  for (const f of factions) {
    const key = f.parentFactionId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  return map;
}

// Renders a faction row plus its subject factions indented beneath it,
// recursively — keeps the hierarchy visible in the flat overview table
// instead of needing a separate page per level.
function FactionRows({ factions, childrenMap, depth, showSilo, highlightFactionId, onSelectFaction, onTransfer }) {
  return factions.flatMap((f) => {
    const leader = f.characters.find((c) => c.isLeader);
    const children = childrenMap.get(f.id) ?? [];
    return [
      <tr
        key={f.id}
        id={`faction-row-${f.id}`}
        style={f.id === highlightFactionId ? HIGHLIGHT_STYLE : undefined}
      >
        <td style={{ paddingLeft: `calc(10px + ${depth * 1.25}rem)` }}>
          {depth > 0 ? "↳ " : ""}
          <FactionLink factionId={f.id} name={f.name} onSelect={onSelectFaction} />
        </td>
        <td>{f.characters.length}</td>
        <td>
          <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm />
        </td>
        {showSilo && (
          <td>
            <span className="mono">{f.silo} ⬢</span>{" "}
            <IconButton icon={ResourcesIcon} label={`Move ⬢ for ${f.name}`} onClick={() => onTransfer(f.id)} />
          </td>
        )}
        <td>
          <Link href={`/faction?factionId=${f.id}`} className="btn-quiet">
            Manage &rarr;
          </Link>
        </td>
      </tr>,
      ...FactionRows({
        factions: children,
        childrenMap,
        depth: depth + 1,
        showSilo,
        highlightFactionId,
        onSelectFaction,
        onTransfer,
      }),
    ];
  });
}

// GMs previously had NO way to move ⬢ into or out of a faction Silo short of
// a superadmin overwriting the raw number on /gm/dev/factions. This is that
// door: any GM, immediate (not staged — see web/lib/gmTransfer.js), covering
// every counterparty a Silo can trade with, including another Silo, which
// has no staging model on the turn desk to fight and no reach gate to
// satisfy (a GM isn't standing anywhere on the map).
function TransferDialog({ faction, otherFactions, characters, onClose }) {
  const [refresh] = useRefresh();
  const [direction, setDirection] = useState("deposit"); // "deposit" | "withdraw", relative to `faction`
  const [counterpartyKey, setCounterpartyKey] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const factionKey = `faction:${faction.id}`;

  async function onConfirm(reason) {
    setError(null);
    setPending(true);
    const fromKey = direction === "withdraw" ? factionKey : counterpartyKey;
    const toKey = direction === "withdraw" ? counterpartyKey : factionKey;
    const res = await transferSiloResources({ fromKey, toKey, amount, reason });
    setPending(false);
    if (!res?.ok) return setError(res?.error ?? "Something went wrong.");
    onClose();
    refresh();
  }

  return (
    <RequestDialog
      open
      title={`Move ⬢ for the ${faction.name} Silo`}
      submitLabel="Transfer"
      busy={pending}
      error={error}
      canSubmit={Boolean(counterpartyKey) && Number(amount) > 0}
      onCancel={onClose}
      onConfirm={onConfirm}
    >
      <label className="field">
        <span className="field-label">Direction</span>
        <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="deposit">Deposit into the {faction.name} Silo</option>
          <option value="withdraw">Withdraw from the {faction.name} Silo</option>
        </Select>
      </label>
      <label className="field">
        <span className="field-label">{direction === "withdraw" ? "Pay to" : "Paid by"}</span>
        <Select value={counterpartyKey} onChange={(e) => setCounterpartyKey(e.target.value)}>
          <option value="">— pick one —</option>
          <optgroup label="Characters">
            {characters.map((c) => (
              <option key={c.id} value={`character:${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other Silos">
            {otherFactions.map((f) => (
              <option key={f.id} value={`faction:${f.id}`}>
                {f.name} Silo · {f.silo} ⬢
              </option>
            ))}
          </optgroup>
        </Select>
      </label>
      <label className="field" style={{ width: "10rem" }}>
        <span className="field-label">Amount</span>
        <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </label>
    </RequestDialog>
  );
}

export default function FactionsPanel({ factions, highlightFactionId, onSelectFaction }) {
  const unaffiliated = factions.filter((f) => f.name === "Unaffiliated");
  const rest = factions.filter((f) => f.name !== "Unaffiliated");
  const childrenMap = buildChildrenMap(rest);
  const topLevel = rest.filter((f) => !f.parentFactionId);
  const tableRef = useRef(null);
  const [transferFactionId, setTransferFactionId] = useState(null);

  // Every named character in the roster, flattened out of the faction rows
  // this panel already has — the "pay a character out of the Silo" leg
  // reuses data already on the page rather than fetching a second roster.
  // Keyed on `factions` (the actual prop) rather than the locally-filtered
  // `rest`, which is a fresh array every render and defeats memoization.
  const characters = useMemo(
    () =>
      factions
        .filter((f) => f.name !== "Unaffiliated")
        .flatMap((f) => f.characters)
        .map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [factions],
  );

  const transferFaction = rest.find((f) => f.id === transferFactionId) ?? null;

  // Scroll the highlighted row into view whenever the selection changes —
  // arriving here from another player-desk route (the Dossier column) or a
  // click on this same table both land on the row, not just the tab.
  useEffect(() => {
    if (!highlightFactionId || !tableRef.current) return;
    const row = tableRef.current.querySelector(`#faction-row-${highlightFactionId}`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightFactionId]);

  return (
    <div className="panel overflow-x-auto" ref={tableRef}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>Leader</th>
            <th>Silo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {FactionRows({
            factions: topLevel,
            childrenMap,
            depth: 0,
            showSilo: true,
            highlightFactionId,
            onSelectFaction,
            onTransfer: setTransferFactionId,
          })}
          {unaffiliated.map((f) => {
            const leader = f.characters.find((c) => c.isLeader);
            return (
              <tr
                key={f.id}
                id={`faction-row-${f.id}`}
                style={{
                  borderTop: "2px solid var(--border)",
                  ...(f.id === highlightFactionId ? HIGHLIGHT_STYLE : {}),
                }}
              >
                <td>
                  <FactionLink factionId={f.id} name={f.name} onSelect={onSelectFaction} />
                </td>
                <td>{f.characters.length}</td>
                <td>
                  <CharacterLink characterId={leader?.id} name={leader?.name ?? "-"} isGm />
                </td>
                {/* Unaffiliated has no Silo — db/lib/parties.js#resolveParty
                    rejects it as a transfer party, so no button here. */}
                <td>{f.silo} ⬢</td>
                <td>
                  <Link href={`/faction?factionId=${f.id}`} className="btn-quiet">
                    Manage &rarr;
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {transferFaction && (
        <TransferDialog
          faction={transferFaction}
          otherFactions={rest.filter((f) => f.id !== transferFaction.id)}
          characters={characters}
          onClose={() => setTransferFactionId(null)}
        />
      )}
    </div>
  );
}
