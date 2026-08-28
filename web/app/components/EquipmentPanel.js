"use client";

import Tooltip from "./Tooltip";
import FormError from "@/app/components/FormError";
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
//
// `embedded` renders this as a sub-section of TagsPanel.js instead of its own
// `.panel` card — the equipped rack is just a view over the same held-tags
// data the Tags panel already has, so it earns a heading, not a whole card.
// The equip/unequip interaction underneath is unchanged either way.
export default function EquipmentPanel({ characterTags, slots = 6, isSelf, embedded = false }) {
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

  const Wrapper = embedded ? "div" : "section";
  const wrapperClassName = embedded ? "" : "panel p-4";

  // Nothing equippable and nothing equipped — say so once rather than
  // rendering an empty rack of slots at someone with no gear.
  if (equippable.length === 0) {
    return (
      <Wrapper className={wrapperClassName}>
        <div className="section-title">
          <h2>Equipped</h2>
          <span className="text-sm text-muted mono">0 / {slots}</span>
        </div>
        <p className="text-sm text-muted">You&apos;re not carrying any equippable items.</p>
      </Wrapper>
    );
  }

  return (
    <Wrapper className={wrapperClassName}>
      {/* .section-title, not .panel-header: the heading is a flex child beside
          the counter, and panel-header's rule would underline just the word. */}
      <div className="section-title">
        <h2>Equipped</h2>
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
            <Tooltip key={ct.id} text={isSelf ? `Unequip ${ct.tag.name}` : ct.tag.name}>
              <button
                type="button"
                className="equip-slot"
                onClick={() => isSelf && toggle(ct.id)}
                disabled={!isSelf || pending}
                aria-label={isSelf ? `Unequip ${ct.tag.name}` : ct.tag.name}
              >
                <ChipLabel tag={ct.tag} quantity={ct.quantity} />
              </button>
            </Tooltip>
          );
        })}
      </div>

      {isSelf && available.length > 0 && (
        <>
          <p className="field-label mt-3">Carrying</p>
          <div className="flex flex-wrap gap-2">
            {available.map((ct) => (
              /* "No free slots" is the ONLY explanation of why this button is
                 dead, and a native title= never fires on a disabled element in
                 several browsers — so the one case that most needed a tooltip
                 was the one case that never showed one. HoverCard wraps the
                 button rather than living on it, so it works regardless. */
              <Tooltip key={ct.id} text={full ? "No free slots" : `Equip ${ct.tag.name}`}>
                <button
                  type="button"
                  className="equip-add"
                  onClick={() => toggle(ct.id)}
                  disabled={pending || full}
                  aria-label={`Equip ${ct.tag.name}`}
                >
                  <ChipLabel tag={ct.tag} quantity={ct.quantity} />
                </button>
              </Tooltip>
            ))}
          </div>
          {full && (
            <p className="mt-2 text-sm text-muted">
              All {slots} slots are full — unequip something first.
            </p>
          )}
        </>
      )}

      <FormError>{error}</FormError>
    </Wrapper>
  );
}
