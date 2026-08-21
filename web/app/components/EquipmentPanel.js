"use client";

import { useState, useTransition } from "react";
import ChipLabel from "./ChipLabel";
import { toggleEquip } from "@/app/(app)/character/equipActions";

// Click-to-toggle rather than drag-and-drop. Drag needs a touch fallback on
// phones anyway, and that fallback is exactly this — so building it alone
// costs a fraction of the code, works on every input, and is keyboard
// accessible for free.
//
// This is its own surface rather than an affordance on TagChip because
// TagChip's click already opens the Consume dialog (see TagsPanel.js);
// overloading it would make a consumable-and-equippable tag ambiguous.
export default function EquipmentPanel({ characterTags, slots = 6, isSelf }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(null);

  const equippable = characterTags.filter((ct) => ct.tag.equippable);
  const equipped = equippable.filter((ct) => ct.equipped);
  const available = equippable.filter((ct) => !ct.equipped);
  const full = equipped.length >= slots;

  function toggle(characterTagId) {
    setError(null);
    startTransition(async () => {
      const result = await toggleEquip(characterTagId);
      if (result?.error) setError(result.error);
    });
  }

  // Nothing equippable and nothing equipped — say so once rather than
  // rendering an empty rack of slots at someone with no gear.
  if (equippable.length === 0) {
    return (
      <section className="panel p-4">
        <div className="section-title">
          <h2>Equipment</h2>
          <span className="text-sm text-muted mono">0 / {slots}</span>
        </div>
        <p className="text-sm text-muted">You are carrying nothing you can equip.</p>
      </section>
    );
  }

  return (
    <section className="panel p-4">
      {/* .section-title, not .panel-header: the heading is a flex child beside
          the counter, and panel-header's rule would underline just the word. */}
      <div className="section-title">
        <h2>Equipment</h2>
        <span className="text-sm text-muted mono">
          {equipped.length} / {slots}
        </span>
      </div>

      <div className="equip-slots">
        {Array.from({ length: slots }, (_, i) => {
          const ct = equipped[i];
          if (!ct) {
            return <div key={`empty-${i}`} className="equip-slot is-empty" aria-hidden="true" />;
          }
          return (
            <button
              key={ct.id}
              type="button"
              className="equip-slot"
              onClick={() => isSelf && toggle(ct.id)}
              disabled={!isSelf || pending}
              title={isSelf ? `Unequip ${ct.tag.name}` : ct.tag.name}
              aria-label={isSelf ? `Unequip ${ct.tag.name}` : ct.tag.name}
            >
              <ChipLabel tag={ct.tag} quantity={ct.quantity} />
            </button>
          );
        })}
      </div>

      {isSelf && available.length > 0 && (
        <>
          <p className="field-label mt-3">Carrying</p>
          <div className="flex flex-wrap gap-2">
            {available.map((ct) => (
              <button
                key={ct.id}
                type="button"
                className="equip-add"
                onClick={() => toggle(ct.id)}
                disabled={pending || full}
                title={full ? "No free slots" : `Equip ${ct.tag.name}`}
                aria-label={`Equip ${ct.tag.name}`}
              >
                <ChipLabel tag={ct.tag} quantity={ct.quantity} />
              </button>
            ))}
          </div>
          {full && (
            <p className="mt-2 text-sm text-muted">
              All {slots} slots are full — unequip something first.
            </p>
          )}
        </>
      )}

      {error && <p className="mt-2 text-sm" style={{ color: "var(--danger)" }}>{error}</p>}
    </section>
  );
}
