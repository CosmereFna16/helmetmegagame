"use client";

import { useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import ZoneChip from "@/app/components/ZoneChip";
import { assignGmZone } from "./actions";

// One GM's zone seat, as a segmented control: no seat, then one button per
// zone. .segmented rather than .tab-bar because this is a control with a
// value, so the pressed state lives in aria-pressed where a screen reader can
// reach it (DESIGN-SYSTEM §5).
export default function GmZonePicker({ discordUserId, zones, currentZoneId }) {
  const [zoneId, setZoneId] = useState(currentZoneId ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const choose = (next) => {
    if (next === zoneId) return;
    setError("");
    const previous = zoneId;
    // Optimistic: the roster is a five-row page and the round trip is one
    // upsert, so waiting for revalidation to repaint the press reads as lag.
    setZoneId(next);
    startTransition(async () => {
      // Branch on { ok }, not try/catch. The action returns its refusal as
      // data now — a caught e.message would be React error #441's redacted
      // text in production, which is what this used to display. The catch
      // stays for a genuine fault, which still throws.
      try {
        const result = await assignGmZone({ discordUserId, zoneId: next });
        if (!result?.ok) {
          setZoneId(previous);
          setError(result?.error ?? "Could not assign that zone.");
        }
      } catch (e) {
        console.error("Failed to assign a GM zone:", e);
        setZoneId(previous);
        setError("Could not assign that zone.");
      }
    });
  };

  return (
    <div>
      <div className="segmented" role="group" aria-label="Zone seat">
        <button type="button" onClick={() => choose("")} aria-pressed={zoneId === ""} disabled={pending}>
          None
        </button>
        {zones.map((z) => (
          <button
            key={z.id}
            type="button"
            onClick={() => choose(z.id)}
            aria-pressed={zoneId === z.id}
            disabled={pending}
          >
            {z.name}
          </button>
        ))}
      </div>
      <div className="mt-2">
        <ZoneChip zoneName={zones.find((z) => z.id === zoneId)?.name ?? null} />
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
