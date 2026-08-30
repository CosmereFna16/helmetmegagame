"use client";

import DesirePanel from "./DesirePanel";

// The self-set goal panel: what your character wants. Used to be a two-tab
// shell shared with the Fear mechanic (now removed); kept as its own
// component rather than inlining DesirePanel into CharacterSheet, since a
// second goal is plausible again later and this is the natural place for it
// to slot back in.
export default function GoalsPanel({
  desires,
  maxActiveDesires,
  desireCooldownUntilTurn,
  openTurnNumber,
}) {
  return (
    <section className="panel p-4">
      <DesirePanel
        desires={desires}
        maxActiveDesires={maxActiveDesires}
        cooldownUntilTurn={desireCooldownUntilTurn}
        openTurnNumber={openTurnNumber}
      />
    </section>
  );
}
