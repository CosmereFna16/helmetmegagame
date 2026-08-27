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

// The plate is authored as percentages of a 4:3 field, so the SVG is one
// fixed 1000 x 750 viewBox and a coordinate is just a multiplication.
const VIEW_W = 1000;
const VIEW_H = 750;
const sx = (x) => x * (VIEW_W / 100);
const sy = (y) => y * (VIEW_H / 100);

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
  groupLabels,
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

  // Tiers come from the server relative to currentId, so while the optimistic
  // position differs, the destination reads "here" and everything else reads
  // as spent — the walk is in flight, and nothing is walkable until the
  // refresh recomputes the real tiers anyway.
  const tierOf = (region) => {
    if (optimisticId === currentId) return region.tier;
    if (region.id === optimisticId) return "here";
    if (region.tier === "here" || region.tier === "cost") return "spent";
    return region.tier;
  };

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

          {/* The regions are decoration as far as assistive tech is
              concerned: the destination list below carries the same zones as
              real buttons, and is the keyboard and screen-reader path. */}
          <svg
            className="map-regions"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {regions.map((region) => {
              if (!region.polygon) return null;
              const tier = tierOf(region);
              const walkable = isReachable(tier) && !pending;
              return (
                <polygon
                  key={region.id}
                  className="map-region"
                  data-tier={tier}
                  data-walkable={walkable ? "true" : "false"}
                  points={region.polygon.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")}
                  onClick={walkable ? () => travel(region) : undefined}
                />
              );
            })}

            {/* Zone names, including the Caves group — which owns no region,
                only a point over its levels. */}
            {[...regions, ...groupLabels].map((label) =>
              typeof label.labelX === "number" && typeof label.labelY === "number" ? (
                <text
                  key={`label-${label.id}`}
                  className="map-region-label"
                  x={sx(label.labelX)}
                  y={sy(label.labelY)}
                >
                  {label.name}
                </text>
              ) : null,
            )}
          </svg>
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
