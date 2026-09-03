"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Drag a modeless dialog around by its header. Used only by Modal.js, and
// only once Modal has decided the dialog is actually modeless — a blocking
// dialog stays where the overlay's flex centring puts it.
//
// Position is per-mount and deliberately not persisted: a fresh dialog opens
// centred. Remembering it would need a storage key per dialog, and the panels
// differ enough in size that one remembered corner suits none of them.

// Keep at least this much of the panel's top-left on screen, so a panel can
// never be dragged somewhere it can't be dragged back from.
const KEEP_VISIBLE = 48;

function clamp(pos, size) {
  const maxLeft = Math.max(0, window.innerWidth - KEEP_VISIBLE);
  const maxTop = Math.max(0, window.innerHeight - KEEP_VISIBLE);
  return {
    top: Math.min(Math.max(pos.top, 0), maxTop),
    left: Math.min(Math.max(pos.left, KEEP_VISIBLE - size.width), maxLeft),
    width: size.width,
  };
}

export default function useDragPanel({ enabled, panelRef }) {
  // null until the first drag — until then the overlay centres the panel, so
  // there is nothing to jump away from.
  const [placed, setPlaced] = useState(null);
  const drag = useRef(null);
  const isPlaced = placed !== null;

  // A window resize can strand a placed panel off the new viewport. Re-clamp
  // it rather than leaving it unreachable.
  useEffect(() => {
    if (!isPlaced) return undefined;
    const onResize = () =>
      setPlaced((p) => (p ? clamp(p, { width: p.width }) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isPlaced]);

  const onPointerDown = useCallback(
    (e) => {
      if (!enabled || e.button !== 0) return;
      // The ✕ and whatever a caller passed as `actions` still have to click.
      if (e.target.closest("button, a, input, select, textarea")) return;
      const panel = panelRef.current;
      if (!panel) return;

      // Freeze the rect HERE, not on mount. Up to this point the panel is
      // flex-centred and `width: 100%` against the overlay; once it goes
      // `position: fixed` that width would resolve against the viewport
      // instead, so the measured width is pinned along with the corner.
      const rect = panel.getBoundingClientRect();
      const start = { top: rect.top, left: rect.left, width: rect.width };
      drag.current = { start, x: e.clientX, y: e.clientY };
      setPlaced(start);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [enabled, panelRef],
  );

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    setPlaced(
      clamp(
        { top: d.start.top + (e.clientY - d.y), left: d.start.left + (e.clientX - d.x) },
        { width: d.start.width },
      ),
    );
  }, []);

  const endDrag = useCallback((e) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  return {
    // `position: fixed` with top/left, never a transform: a transformed
    // ancestor becomes the containing block for `position: fixed` children,
    // and HoverCard pins itself that way from inside dialogs (globals.css,
    // the .hover-card block). Same reasoning that keeps .desk-shell
    // unpositioned.
    // Dropping out of modeless (the viewport narrowed past the gate) hands the
    // panel straight back to the overlay's centring — the frozen rect is just
    // ignored rather than cleared, so widening again restores where it sat.
    style:
      enabled && placed
        ? {
            position: "fixed",
            top: placed.top,
            left: placed.left,
            width: placed.width,
            margin: 0,
          }
        : undefined,
    handleProps: enabled
      ? { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag }
      : null,
  };
}
