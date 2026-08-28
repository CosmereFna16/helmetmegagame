"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import ZoneChip from "@/app/components/ZoneChip";
import { assignGmZones } from "./actions";

// One GM's zone seats, as a segmented multi-toggle: All, then one button per
// seat zone. .segmented rather than .tab-bar because these are controls with a
// value, so the pressed state lives in aria-pressed where a screen reader can
// reach it (DESIGN-SYSTEM §5). Each zone button toggles independently — a GM
// may hold several — and "All" is the cleared state, named for what the GM's
// tables then show rather than for the empty set.
export default function GmZonePicker({ discordUserId, zones, currentZoneIds }) {
  const [zoneIds, setZoneIds] = useState(currentZoneIds ?? []);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const commit = (next) => {
    setError("");
    const previous = zoneIds;
    // Optimistic: the roster is a five-row page and the round trip is one
    // transaction, so waiting for revalidation to repaint the press reads as
    // lag.
    setZoneIds(next);
    startTransition(async () => {
      // Branch on { ok }, not try/catch. The action returns its refusal as
      // data now — a caught e.message would be React error #441's redacted
      // text in production, which is what this used to display. The catch
      // stays for a genuine fault, which still throws.
      try {
        const result = await assignGmZones({ discordUserId, zoneIds: next });
        if (!result?.ok) {
          setZoneIds(previous);
          setError(result?.error ?? "Could not assign those zones.");
        }
      } catch (e) {
        console.error("Failed to assign GM zones:", e);
        setZoneIds(previous);
        setError("Could not assign those zones.");
      }
    });
  };

  const toggle = (id) =>
    commit(zoneIds.includes(id) ? zoneIds.filter((z) => z !== id) : [...zoneIds, id]);

  // The zones prop is already in canonical order, so deriving the chips from
  // it rather than from zoneIds keeps them in that order however they were
  // clicked.
  const seated = zones.filter((z) => zoneIds.includes(z.id));

  return (
    <div>
      <div className="segmented" role="group" aria-label="Zone seats">
        <button
          type="button"
          onClick={() => zoneIds.length > 0 && commit([])}
          aria-pressed={zoneIds.length === 0}
          disabled={pending}
        >
          All
        </button>
        {zones.map((z) => (
          <button
            key={z.id}
            type="button"
            onClick={() => toggle(z.id)}
            aria-pressed={zoneIds.includes(z.id)}
            disabled={pending}
          >
            {z.name}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {seated.length === 0 ? (
          <ZoneChip zoneName={null} />
        ) : (
          seated.map((z) => <ZoneChip key={z.id} zoneName={z.name} />)
        )}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
