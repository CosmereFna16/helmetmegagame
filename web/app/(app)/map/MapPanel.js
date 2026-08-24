"use client";

import FormError from "@/app/components/FormError";
import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { travelTo } from "./travelActions";

// The two grounds the pointcrawl can be laid over. Plate is the drawn
// Ravenheart map, and it deliberately carries **no** pointcrawl — nodes,
// labels and roads are all hidden over it, because a rhombus grid on top of a
// hand-drawn map fights the drawing rather than reading over it. Travel still
// works from the destination list below, which is why that list is always
// rendered rather than being a mobile-only fallback.
const GROUNDS = [
  { key: "bare", label: "Bare", src: null, pointcrawl: true },
  { key: "plate", label: "Plate", src: "/assets/Map_Basic.png", pointcrawl: false },
];

const STORAGE_KEY = "lifeweb:map-ground";

// The remembered ground is read through useSyncExternalStore rather than an
// effect: localStorage doesn't exist on the server, so the server snapshot is
// null (Bare) and React re-renders with the real value after hydration —
// no mismatch, and no setState inside an effect, which is an error in this
// repo (see react-hooks/set-state-in-effect). Nothing outside this tab ever
// writes the key, so there is nothing to subscribe to.
const noSubscription = () => () => {};

function readStoredGround() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and browsers set to block site data both throw here.
    return null;
  }
}

const TIER_LABEL = {
  here: "You are here",
  free: "Free",
  cost: "Costs your Move",
  spent: "Costs your Move",
  noroad: "No road",
};

export default function MapPanel({ nodes, roads, currentId, hasCharacter, turnOpen }) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(null);
  const [chosenKey, setChosenKey] = useState(null);
  const storedKey = useSyncExternalStore(noSubscription, readStoredGround, () => null);
  const ground = GROUNDS.find((g) => g.key === (chosenKey ?? storedKey)) ?? GROUNDS[0];

  const chooseGround = (next) => {
    setChosenKey(next.key);
    try {
      window.localStorage.setItem(STORAGE_KEY, next.key);
    } catch {
      /* ignore */
    }
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = nodes.filter((n) => typeof n.x === "number" && typeof n.y === "number");
  const here = currentId ? byId.get(currentId) : null;
  const destinations = nodes
    .filter((n) => n.tier === "free" || n.tier === "cost" || n.tier === "spent")
    .sort((a, b) => a.name.localeCompare(b.name));

  const travel = useCallback(
    async (node) => {
      if (pending) return;
      if (node.tier !== "free" && node.tier !== "cost") return;

      const ok = await confirm({
        title: `Travel to the ${node.name}?`,
        message:
          node.tier === "free"
            ? `${here?.zoneName ?? "Nowhere"} → ${node.zoneName}. A short walk — you keep your Move this turn.`
            : `${here?.zoneName ?? "Nowhere"} → ${node.zoneName}. This spends your Move for the turn.`,
        confirmLabel: "Set out",
        cancelLabel: "Stay put",
      });
      if (!ok) return;

      startTransition(async () => {
        const result = await travelTo(node.id);
        if (result?.error) {
          setStatus({ error: result.error });
          return;
        }
        setStatus({
          message: result.free
            ? `Walked to the ${result.name}.`
            : `Travelled to the ${result.name}. Your Move is spent.`,
        });
        router.refresh();
      });
    },
    [confirm, here, pending, router],
  );

  return (
    <>
      <div className="panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="panel-header mb-0">{here ? here.name : "Off the map"}</div>
            <p className="mt-1 text-xs text-muted">
              {here
                ? `${here.zoneName} · ${destinations.length} road${destinations.length === 1 ? "" : "s"} out`
                : "Your character hasn't been placed anywhere yet."}
            </p>
          </div>
          <div className="segmented" role="group" aria-label="Map ground">
            {GROUNDS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => chooseGround(g)}
                aria-pressed={g.key === ground.key}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="map-plate" data-ground={ground.key}>
          {ground.src && (
            // A ground is a full-bleed decorative backdrop at a size the
            // layout already fixes, so next/image's sizing machinery buys
            // nothing here. Same call as CharacterSheet's avatar.
            // eslint-disable-next-line @next/next/no-img-element
            <img className="map-ground" src={ground.src} alt="" />
          )}

          {ground.pointcrawl && (
            <>
              <svg className="map-roads" viewBox="0 0 1000 750" aria-hidden="true">
                {/* Drawn twice: a dark casing beneath a lighter stroke. That
                    doubling is what makes a line read as a road over a
                    photograph instead of as a wireframe. */}
                {["casing", "line"].map((pass) => (
                  <g key={pass}>
                    {roads.map((road) => {
                      const a = byId.get(road.a);
                      const b = byId.get(road.b);
                      if (typeof a?.x !== "number" || typeof b?.x !== "number") return null;
                      const touches = road.a === currentId || road.b === currentId;
                      const other = road.a === currentId ? b : road.b === currentId ? a : null;
                      const width = (touches ? 2.6 : 1.5) + (pass === "casing" ? 3 : 0);
                      return (
                        <line
                          key={`${pass}-${road.a}-${road.b}`}
                          x1={a.x * 10}
                          y1={a.y * 7.5}
                          x2={b.x * 10}
                          y2={b.y * 7.5}
                          strokeWidth={width}
                          strokeLinecap="round"
                          strokeDasharray={road.tunnel ? "7 6" : undefined}
                          className={pass === "casing" ? "map-road-casing" : "map-road"}
                          data-tier={pass === "line" && other ? other.tier : undefined}
                          data-tunnel={road.tunnel ? "true" : "false"}
                        />
                      );
                    })}
                  </g>
                ))}
              </svg>

              {placed.map((node) => {
                const walkable = node.tier === "free" || node.tier === "cost";
                const Tag = walkable ? "button" : "div";
                return (
                  <Tag
                    key={node.id}
                    {...(walkable ? { type: "button", onClick: () => travel(node) } : {})}
                    className="map-node"
                    data-tier={node.tier}
                    style={{ left: `${node.x}%`, top: `${node.y}%` }}
                    title={`${node.name} — ${node.note}`}
                  >
                    <span className="map-label">{node.name}</span>
                    <span className="map-stem" />
                    <span className="map-rhomb" />
                  </Tag>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="panel p-4">
        <h2 className="panel-header">Where you can go</h2>

        {!hasCharacter && (
          <p className="text-sm text-muted">
            You have no living character, so the map is read-only.
          </p>
        )}
        {hasCharacter && !here && (
          <p className="text-sm text-muted">
            A GM hasn&apos;t placed your character anywhere yet, so there&apos;s nowhere to set out
            from.
          </p>
        )}
        {hasCharacter && here && destinations.length === 0 && (
          <p className="text-sm text-muted">Nowhere connects to where you stand.</p>
        )}

        {destinations.length > 0 && (
          <ul className="map-dests">
            {destinations.map((node) => {
              const walkable = node.tier === "free" || node.tier === "cost";
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    className="map-dest"
                    data-tier={node.tier}
                    disabled={!walkable || pending}
                    onClick={() => travel(node)}
                  >
                    <span className="map-dest-mark" />
                    <span className="map-dest-body">
                      <span className="map-dest-name">{node.name}</span>
                      <span className="map-dest-note">
                        {node.zoneName} · {node.note}
                      </span>
                    </span>
                    <span className="map-dest-tier">{TIER_LABEL[node.tier]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!turnOpen && here && (
          <p className="mt-3 text-xs text-muted">
            No turn is open, so anything that would spend a Move has to wait.
          </p>
        )}
        {status?.error && (
          <FormError className="mt-3">
            {status.error}
          </FormError>
        )}
        {status?.message && !status.error && (
          <p className="mt-3 text-sm" style={{ color: "var(--positive)" }} role="status">
            {status.message}
          </p>
        )}
      </div>
    </>
  );
}
