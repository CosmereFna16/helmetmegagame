"use client";

import FormError from "@/app/components/FormError";
import InfoIcon from "@/app/components/InfoIcon";
import Switch from "@/app/components/Switch";
import {
  useCallback,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { travelTo } from "./travelActions";

// The drawn Ravenheart plate. It is the only ground — the Bare/Plate toggle
// went with the old pointcrawl. What came back over it is the pointcrawl's
// readable half: four rhombi and the lines between them, laid on the art
// rather than instead of it.
const PLATE_SRC = "/assets/Map_Basic.png";

// Gunboat's wording, verbatim. It describes the cave system the way a player
// talks about it rather than the way zoneConnections stores it — leave it
// alone.
const ROUTES_HELP =
  "The Railroad connects to the Fortress and the Windlands. The Caverns connect to the Town. All three Caves connect. Windlands and the Fortress do not connect.";

const STORAGE_KEY = "lifeweb:map-routes";

// The remembered overlay choice is read through useSyncExternalStore rather
// than an effect: localStorage doesn't exist on the server, so the server
// snapshot is null (which reads as the default, on) and React re-renders with
// the real value after hydration — no mismatch, and no setState inside an
// effect, which is an error in this repo (react-hooks/set-state-in-effect).
// Nothing outside this tab ever writes the key, so there is nothing to
// subscribe to.
const noSubscription = () => () => {};

function readStoredRoutes() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and browsers set to block site data both throw here.
    return null;
  }
}

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
  nodes,
  edges,
  currentId,
  hasCharacter,
  unplaced,
  turnOpen,
}) {
  const confirm = useConfirm();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The "you are here" mark moves the moment travel is confirmed, instead of
  // waiting out the server action + refresh round trip. Reverts on its own if
  // the action errors (the transition ends without currentId changing). The
  // lines still describe the OLD position until the refresh lands — they are
  // recomputed a second later.
  const [optimisticId, setOptimisticId] = useOptimistic(currentId);
  const [status, setStatus] = useState(null);
  const [chosenRoutes, setChosenRoutes] = useState(null);
  const storedRoutes = useSyncExternalStore(noSubscription, readStoredRoutes, () => null);
  const showRoutes = (chosenRoutes ?? storedRoutes ?? "on") !== "off";
  const stripRef = useRef(null);

  const chooseRoutes = (next) => {
    setChosenRoutes(next ? "on" : "off");
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* ignore */
    }
  };

  const here = optimisticId ? regions.find((r) => r.id === optimisticId) ?? null : null;
  const destinations = regions
    .filter((r) => r.tier === "cost" || r.tier === "spent")
    .sort((a, b) => a.name.localeCompare(b.name));
  const cavesNode = nodes.find((n) => n.levels) ?? null;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Tiers come from the server relative to currentId, so while the optimistic
  // position differs the destination reads "here" and the origin reads
  // "spent" — nothing is walkable until the refresh recomputes the real tiers
  // anyway.
  const displayTier = (entry, zoneIds = [entry.id]) => {
    if (optimisticId === currentId) return entry.tier;
    if (zoneIds.includes(optimisticId)) return "here";
    return entry.tier === "here" ? "spent" : entry.tier;
  };

  const focusStrip = () => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    el.focus({ preventScroll: true });
  };

  const travel = useCallback(
    async (target) => {
      if (pending) return;
      if (!isReachable(target.tier)) return;

      const ok = await confirm({
        title: `Travel to ${target.name}?`,
        message: unplaced
          ? `You haven't been placed yet, so arriving in ${target.name} is free — it doesn't spend your Move.`
          : `${here?.name ?? "Nowhere"} → ${target.name}. This spends your Move for the turn.`,
        confirmLabel: "Set out",
        cancelLabel: "Stay put",
      });
      if (!ok) return;

      startTransition(async () => {
        setOptimisticId(target.id);
        const result = await travelTo(target.id);
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
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="panel-header mb-0">{here ? here.name : "Off the map"}</div>
            {here ? (
              <p className="map-zone-desc mt-2 max-w-prose text-sm">{here.description}</p>
            ) : (
              <p className="mt-2 text-sm text-muted">
                Your character hasn&apos;t been placed anywhere yet.
              </p>
            )}
          </div>
          <Switch
            className="map-routes-toggle"
            checked={showRoutes}
            onChange={(e) => chooseRoutes(e.target.checked)}
          >
            Show routes
          </Switch>
        </div>

        {/* The overlay is decorative twice over: it is aria-hidden, and every
            control in it carries tabIndex={-1}. The destination list below is
            the keyboard and screen-reader path, and the depth strip is the
            reachable twin of the Caves node. */}
        <div className="map-plate">
          {/* A ground is a full-bleed decorative backdrop at a size the layout
              already fixes, so next/image's sizing machinery buys nothing
              here. Same call as CharacterSheet's avatar. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="map-ground" src={PLATE_SRC} alt="" />

          {showRoutes && (
            <div className="map-overlay" aria-hidden="true">
              {/* A 0-100 viewBox with preserveAspectRatio="none" makes a
                  coordinate literally the percentage stored in zones.yaml,
                  whatever width the plate is drawn at. Strokes opt out of that
                  stretch with vector-effect, or they would be thicker across
                  than down. */}
              <svg className="map-routes" viewBox="0 0 100 100" preserveAspectRatio="none">
                {/* Drawn twice: a dark casing beneath a lighter stroke. That
                    doubling is what makes a line read as a route over a
                    painting instead of as a wireframe. */}
                {["casing", "line"].map((pass) => (
                  <g key={pass}>
                    {edges.map((edge) => {
                      const a = nodeById.get(edge.a);
                      const b = nodeById.get(edge.b);
                      if (!a || !b) return null;
                      return (
                        <line
                          key={`${pass}-${edge.a}-${edge.b}`}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          vectorEffect="non-scaling-stroke"
                          strokeWidth={(edge.adjacent ? 2.6 : 1.6) + (pass === "casing" ? 3 : 0)}
                          strokeLinecap="round"
                          strokeDasharray={edge.adjacent ? undefined : "6 6"}
                          className={pass === "casing" ? "map-route-casing" : "map-route"}
                          data-adjacent={edge.adjacent ? "true" : "false"}
                        />
                      );
                    })}
                  </g>
                ))}
              </svg>

              {nodes.map((node) => {
                const tier = displayTier(node, node.zoneIds);
                // The Caves node never travels: it hands you to the depth
                // strip, which is where the three levels are told apart.
                const clickable = node.levels ? true : isReachable(tier);
                const Tag = clickable ? "button" : "div";
                return (
                  <Tag
                    key={node.id}
                    {...(clickable
                      ? {
                          type: "button",
                          tabIndex: -1,
                          onClick: () => (node.levels ? focusStrip() : travel(node)),
                        }
                      : {})}
                    className="map-node"
                    data-tier={tier}
                    style={{ left: `${node.x}%`, top: `${node.y}%` }}
                    title={`${node.name} — ${node.note}`}
                  >
                    <span className="map-label">{node.name}</span>
                    <span className="map-stem" />
                    <span className="map-rhomb" />
                  </Tag>
                );
              })}
            </div>
          )}
        </div>

        {cavesNode && (
          <div className="map-depths" ref={stripRef} tabIndex={-1}>
            <span className="map-depths-label">Down the Caves</span>
            <div className="segmented map-depth-strip" role="group" aria-label="Cave levels">
              {cavesNode.levels.map((level) => {
                const tier = displayTier(level);
                return (
                  <button
                    key={level.id}
                    type="button"
                    data-tier={tier}
                    aria-pressed={tier === "here"}
                    disabled={!isReachable(tier) || pending}
                    title={`${level.name} — ${level.note}`}
                    onClick={() => travel(level)}
                  >
                    {level.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="panel p-4">
        <h2 className="panel-header panel-header--with-icon">
          Where you can go
          <InfoIcon text={ROUTES_HELP} />
        </h2>

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
