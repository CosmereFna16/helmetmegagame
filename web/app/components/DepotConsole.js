"use client";

import { useState } from "react";
import Tooltip from "./Tooltip";
import DepotOrderTab from "./DepotOrderTab";
import DepotPriceListTab from "./DepotPriceListTab";
import DepotHoldTab from "./DepotHoldTab";
import DepotBankTab from "./DepotBankTab";
import DepotStationTab from "./DepotStationTab";
import DepotLedgerTab from "./DepotLedgerTab";

// The Merchant's console. See docs/systemdocs/DEPOT.md.
//
// The shape of this page is one decision: a status strip that never leaves the
// screen, and tabs underneath. The Depot has four pieces of state that can
// each ruin your day — the generator, the shuttle clock, the turret and the
// balance — and all four matter no matter which job you happen to be doing.
// Hiding them behind a tab is how you end up ordering three hundred obols of
// coal on a dead generator.
//
// Nothing here is authoritative. Every disabled control is a hint; the server
// actions re-check the licence, the standing, the power and the money inside
// their transactions, because a disabled input is not a lock.

const TABS = [
  { key: "order", label: "Order" },
  { key: "prices", label: "Price List" },
  { key: "hold", label: "Hold" },
  { key: "bank", label: "Bank" },
  { key: "station", label: "Station" },
  { key: "ledger", label: "Ledger" },
];

// Fuel is shown in TURNS rather than units, because "4 turns" is the number a
// Merchant actually plans around and "80/100" is not.
function FuelGauge({ fuel, fuelMax, turnsLeft, on }) {
  const pct = fuelMax > 0 ? Math.max(0, Math.min(100, Math.round((fuel / fuelMax) * 100))) : 0;
  // Amber at two turns, red at one. The colour is the warning; the number is
  // the detail behind it.
  const tone = !on || turnsLeft <= 1 ? "danger" : turnsLeft <= 2 ? "warning" : "positive";
  return (
    <Tooltip text={`${fuel} of ${fuelMax} units in the tank. The generator burns a fixed amount every turn; at zero it shuts itself off and nothing at the Depot works.`}>
      <span className="depot-stat">
        <span className="depot-stat-label">Generator</span>
        <span className={`depot-gauge depot-gauge-${tone}`} aria-hidden="true">
          <span className="depot-gauge-fill" style={{ width: `${pct}%` }} />
        </span>
        <span className="mono">
          {turnsLeft == null ? `${fuel}` : `${turnsLeft}t`}
        </span>
        <span className={`depot-lamp depot-lamp-${on ? "on" : "off"}`}>{on ? "ON" : "OFF"}</span>
      </span>
    </Tooltip>
  );
}

function ShuttleStat({ shuttleState, turnsLeft }) {
  const text =
    shuttleState === "DOCKED"
      ? turnsLeft == null
        ? "on the pad"
        : `on the pad · leaves in ${turnsLeft}`
      : shuttleState === "INBOUND"
        ? "inbound"
        : "at the station";
  return (
    <Tooltip text="The shuttle sits on the landing pad for at most six turns and then flies back on its own, loaded or not. Anything still on the pad when it goes stays on the pad. ‡">
      <span className="depot-stat">
        <span className="depot-stat-label">Shuttle</span>
        <span className={shuttleState === "DOCKED" ? "text-accent" : "text-muted"}>{text}</span>
      </span>
    </Tooltip>
  );
}

function TurretStat({ armed, face }) {
  return (
    <Tooltip
      text={
        armed
          ? `Armed. It will fire on everyone in the depot except ${face || "nobody — no face is on file, so it will fire on everyone"}.`
          : "Disarmed. A lump of metal in the ceiling."
      }
    >
      <span className="depot-stat">
        <span className="depot-stat-label">Turret</span>
        <span className={`depot-lamp depot-lamp-${armed ? "armed" : "off"}`}>
          {armed ? "ARMED" : "SAFE"}
        </span>
      </span>
    </Tooltip>
  );
}

export default function DepotConsole(props) {
  const { depot, greetingName, readOnly, atDepot, powered } = props;
  const [tab, setTab] = useState("order");

  const shuttleTurnsLeft =
    depot.shuttleState === "DOCKED" && depot.shuttleTurn != null && props.turnNumber != null
      ? Math.max(0, (depot.shuttleMaxTurns ?? 6) - (props.turnNumber - depot.shuttleTurn))
      : null;

  const Body = {
    order: DepotOrderTab,
    prices: DepotPriceListTab,
    hold: DepotHoldTab,
    bank: DepotBankTab,
    station: DepotStationTab,
    ledger: DepotLedgerTab,
  }[tab];

  return (
    <div className="flex flex-col gap-4">
      <section className="panel depot-cockpit">
        <div className="depot-cockpit-head">
          <span className="depot-greeting">
            {greetingName ? `Good evening, ${greetingName}.` : "The Depot. ‡"}
          </span>
          <span className="depot-cockpit-money">
            <Tooltip text="The station's account, in obols — one for every ⬢ it is worth. It is the Depot's money, not yours: hand the licence to someone else and the balance goes with it. ‡">
              <span className="depot-balance mono">{depot.accountObols} ¢</span>
            </Tooltip>
          </span>
        </div>
        <div className="depot-cockpit-stats">
          <FuelGauge
            fuel={depot.generatorFuel}
            fuelMax={depot.fuelMax}
            turnsLeft={props.fuelTurnsLeft}
            on={depot.generatorOn}
          />
          <ShuttleStat shuttleState={depot.shuttleState} turnsLeft={shuttleTurnsLeft} />
          <TurretStat armed={depot.turretArmed} face={depot.merchantFace} />
        </div>
      </section>

      {/* One banner, in priority order, rather than three stacked. The most
          blocking thing is the only thing worth reading. */}
      {readOnly ? (
        <p className="depot-notice">
          Read-only. You can see the state of the station; running it wants the Merchant&apos;s
          Licence. ‡
        </p>
      ) : !atDepot ? (
        <p className="depot-notice">
          You are not at the Depot. The readings are live, but nothing down here answers a
          keyboard three zones away. ‡
        </p>
      ) : !powered ? (
        <p className="depot-notice depot-notice-danger">
          The generator is out. Nothing works until it is running again — the Station tab has the
          switch and the coal. ‡
        </p>
      ) : null}

      <nav className="depot-tabs" aria-label="Depot sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={t.key === tab ? "depot-tab depot-tab-on" : "depot-tab"}
            aria-current={t.key === tab ? "page" : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Keyed, so switching tabs resets each one's search box and page
          number rather than carrying a stale filter across. */}
      <Body key={tab} {...props} shuttleTurnsLeft={shuttleTurnsLeft} />
    </div>
  );
}
