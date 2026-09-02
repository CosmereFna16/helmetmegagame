"use client";

import DesirePanel from "./DesirePanel";

// The self-set goal panel: what your character wants. Used to be a two-tab
// shell shared with the Fear mechanic (now removed); kept as its own
// component rather than inlining DesirePanel into CharacterSheet, since a
// second panel — a Fear track, say — is plausible again later and this is
// the natural place for it to slot back in.
export default function GoalsPanel({
  desireSlots = 2,
  slotLockTurns = 2,
  slotStates = [],
  catalog = [],
  families = [],
  familyGroups = [],
  lockNotes = [],
  addiction = null,
  openTurnNumber,
  desiresEnabled = true,
}) {
  return (
    <section className="panel p-4">
      <DesirePanel
        desireSlots={desireSlots}
        slotLockTurns={slotLockTurns}
        slotStates={slotStates}
        catalog={catalog}
        families={families}
        familyGroups={familyGroups}
        lockNotes={lockNotes}
        addiction={addiction}
        desiresEnabled={desiresEnabled}
      />
    </section>
  );
}
