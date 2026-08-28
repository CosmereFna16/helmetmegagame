"use client";

import FormError from "@/app/components/FormError";
import { useCallback, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { travelTo } from "./travelActions";

// The drawn Ravenheart plate. It is the only ground now — the Bare/Plate
// toggle and its remembered choice went with the pointcrawl, because a zone
// region only means anything drawn over the art it was traced from.
const PLATE_SRC = "/assets/Map_Basic.png";

const TIER_LABEL = {
  here: "You are here",
  cost: "Costs your Move",
  spent: "Costs your Move",
  noroad: "No road",
};

// Reachable means clickable: `cost` is the only tier a player can act on
// (an unplaced character's whole map is `cost`, priced at nothing).
const isReachable = (tier) => tier === "cost";

export default function MapPanel({
  regions,
  currentId,
  hasCharacter,
  unplaced,
  turnOpen,
}) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The "you are here" region moves the moment travel is confirmed, instead
  // of waiting out the server action + refresh round trip. Reverts on its own
  // if the action errors (the transition ends without currentId changing).
  const [optimisticId, setOptimisticId] = useOptimistic(currentId);
  const [status, setStatus] = useState(null);

  const here = optimisticId ? regions.find((r) => r.id === optimisticId) ?? null : null;
  const destinations = regions
    .filter((r) => r.tier === "cost" || r.tier === "spent")
    .sort((a, b) => a.name.localeCompare(b.name));

  const travel = useCallback(
    async (region) => {
      if (pending) return;
      if (!isReachable(region.tier)) return;

      const ok = await confirm({
        title: `Travel to ${region.name}?`,
        message: unplaced
          ? `You haven't been placed yet, so arriving in ${region.name} is free — it doesn't spend your Move.`
          : `${here?.name ?? "Nowhere"} → ${region.name}. This spends your Move for the turn.`,
        confirmLabel: "Set out",
        cancelLabel: "Stay put",
      });
      if (!ok) return;

      startTransition(async () => {
        setOptimisticId(region.id);
        const result = await travelTo(region.id);
        if (result?.error) {
          setStatus({ error: result.error });
          return;
        }
        setStatus({
          message: result.free
            ? `Arrived in ${result.name}.`
            : `Travelled to ${result.name}. Your Move is spent.`,
        });
        router.refresh();
      });
    },
    [confirm, here, pending, router, setOptimisticId, unplaced],
  );

  return (
    <>
      <div className="panel p-4">
        <div className="mb-3">
          <div className="panel-header mb-0">{here ? here.name : "Off the map"}</div>
          <p className="mt-1 text-xs text-muted">
            {here
              ? `${destinations.length} way${destinations.length === 1 ? "" : "s"} out`
              : "Your character hasn't been placed anywhere yet."}
          </p>
        </div>

        <div className="map-plate">
          {/* A ground is a full-bleed decorative backdrop at a size the layout
              already fixes, so next/image's sizing machinery buys nothing
              here. Same call as CharacterSheet's avatar. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="map-ground" src={PLATE_SRC} alt="" />
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="panel-header">Where you can go</h2>

        {!hasCharacter && (
          <p className="text-sm text-muted">
            You don&apos;t have a living character, so the map is read only.
          </p>
        )}
        {unplaced && (
          <p className="text-sm text-muted">
            You haven&apos;t been placed yet. Your first arrival is free — pick anywhere.
          </p>
        )}
        {hasCharacter && !unplaced && destinations.length === 0 && (
          <p className="text-sm text-muted">Nowhere connects to where you stand.</p>
        )}

        {destinations.length > 0 && (
          <ul className="map-dests">
            {destinations.map((region) => (
              <li key={region.id}>
                <button
                  type="button"
                  className="map-dest"
                  data-tier={region.tier}
                  disabled={!isReachable(region.tier) || pending}
                  onClick={() => travel(region)}
                >
                  <span className="map-dest-mark" />
                  <span className="map-dest-body">
                    <span className="map-dest-name">{region.name}</span>
                    <span className="map-dest-note">{region.note}</span>
                  </span>
                  <span className="map-dest-tier">{TIER_LABEL[region.tier]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {!turnOpen && !unplaced && hasCharacter && (
          <p className="mt-3 text-xs text-muted">
            No turn is open, so travel — which always spends a Move — has to wait.
          </p>
        )}
        {status?.error && <FormError className="mt-3">{status.error}</FormError>}
        {status?.message && !status.error && (
          <p className="mt-3 text-sm" style={{ color: "var(--positive)" }} role="status">
            {status.message}
          </p>
        )}
      </div>
    </>
  );
}
