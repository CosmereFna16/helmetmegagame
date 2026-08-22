"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const MARGIN = 8;

// A hover/focus panel that renders into document.body instead of next to its
// trigger. This is the codebase's only portal, and it exists for one reason:
// an in-tree tooltip is clipped by every scrolling ancestor it happens to sit
// under — .doc-sheet, .table-scroll, .list-scroll, .message-list, .modal-panel,
// .app-rail. A tag chip near the top of an open document threw its tooltip
// into the sheet's own scroll region, so you saw the bottom half only.
//
// position: fixed alone does NOT fix that: .doc-card sets a transform on
// hover, and a transformed ancestor becomes the containing block even for
// fixed children. Escaping to document.body is the part that actually holds.
export default function HoverCard({ children, panel, className = "", ...triggerProps }) {
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const id = useId();

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const el = panelRef.current;
    if (!trigger || !el) return;

    const t = trigger.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Prefer above (where it has always opened); flip below when the space
    // isn't there.
    const roomAbove = t.top - GAP - MARGIN;
    const roomBelow = vh - t.bottom - GAP - MARGIN;
    const below = height > roomAbove && roomBelow > roomAbove;
    const preferred = below ? t.bottom + GAP : t.top - GAP - height;

    // Then clamp the whole panel into the viewport rather than squeezing it
    // into whichever side it was placed on. Squeezing produced a truncated
    // panel with an internal scrollbar the reader cannot use — the panel is
    // pointer-events:none, and reaching for it would close it anyway. Better
    // to slide it and overlap the chip a little than to hide half the text.
    const top = Math.min(Math.max(MARGIN, preferred), Math.max(MARGIN, vh - height - MARGIN));

    // Left-align with the trigger, then clamp so a chip at the right edge
    // doesn't push the panel off-screen.
    const left = Math.min(Math.max(MARGIN, t.left), Math.max(MARGIN, vw - width - MARGIN));

    // Only cap when the panel is genuinely taller than the viewport, which is
    // the one case sliding cannot solve.
    setPos({ top, left, maxHeight: vh - MARGIN * 2 });
  }, []);

  // Layout effect so the first paint is already in the right place — with a
  // plain effect the panel flashes at 0,0 before settling.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // Fixed positioning detaches on scroll, so close rather than chase it.
    const close = () => setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <span
        {...triggerProps}
        ref={triggerRef}
        className={`tag-hover ${className}`.trim()}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <span
            ref={panelRef}
            id={id}
            role="tooltip"
            className="tag-tooltip"
            style={
              pos
                ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight }
                : // Measured on the first layout pass; keep it off-screen until
                  // then rather than letting it flash in the corner.
                  { top: 0, left: 0, visibility: "hidden" }
            }
          >
            {panel}
          </span>,
          document.body,
        )}
    </>
  );
}
