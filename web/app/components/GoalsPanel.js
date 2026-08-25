"use client";

import { useState } from "react";
import DesirePanel from "./DesirePanel";
import FearPanel from "./FearPanel";

// The two self-set goals — what your character wants and what they dread —
// sharing one panel. Rendered CONDITIONALLY rather than both-mounted-one-
// hidden: switching tabs unmounts the other body, which is what discards its
// stale error line and half-typed form without an effect syncing state. Same
// reasoning as RequestDialog only mounting its body while open.
export default function GoalsPanel({
  desire,
  desireCooldownUntilTurn,
  fear,
  fearSetTurnNumber,
  fearLastFulfilledTurn,
  openTurnNumber,
}) {
  const [tab, setTab] = useState("desire");

  return (
    <section className="panel p-4">
      <div className="tab-bar">
        <button
          type="button"
          className="tab-item"
          data-active={tab === "desire"}
          onClick={() => setTab("desire")}
        >
          Desire
        </button>
        <button
          type="button"
          className="tab-item"
          data-active={tab === "fear"}
          onClick={() => setTab("fear")}
        >
          Fear
        </button>
      </div>

      <div className="mt-4">
        {tab === "desire" ? (
          <DesirePanel
            desire={desire}
            cooldownUntilTurn={desireCooldownUntilTurn}
            openTurnNumber={openTurnNumber}
          />
        ) : (
          <FearPanel
            text={fear}
            setTurnNumber={fearSetTurnNumber}
            lastFulfilledTurn={fearLastFulfilledTurn}
            openTurnNumber={openTurnNumber}
          />
        )}
      </div>
    </section>
  );
}
