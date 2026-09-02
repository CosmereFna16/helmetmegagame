"use client";

import { useEffect, useId, useRef } from "react";

// The one modal shell every dialog in the app uses — backdrop, Escape,
// focus trap and focus restore all live here once. `panelClassName` lets a
// caller (the documents sheet) widen the panel without losing those.
// `onClose` fires for the backdrop, Escape and the close button alike; a
// caller that must not close mid-flight passes a no-op or guards inside it.
// Mount order is nesting order; DOM order is NOT — a module-level stack of
// mount tokens is the only reliable way to know which open Modal is topmost.
const openModals = [];

export default function Modal({
  open = true,
  title,
  onClose,
  width = "default",
  labelledBy,
  actions,
  panelClassName = "modal-panel",
  children,
}) {
  const panelRef = useRef(null);
  const restoreTo = useRef(null);
  // Whether the mouse actually WENT DOWN on the backdrop, not just came up
  // there. A drag-select of text that starts inside the panel and ends past
  // its edge (dragging out of a textarea, say) fires a `click` whose target
  // is the nearest common ancestor of the mousedown/mouseup targets — the
  // overlay itself — even though the panel's own stopPropagation() ran, so
  // the press must have started on the backdrop too before it counts as a
  // dismissal.
  const pressedBackdrop = useRef(false);
  const autoId = useId();
  const headingId = labelledBy ?? `modal-title-${autoId}`;

  // `onClose` is read through a ref so it can stay OUT of the effect below.
  // This is not a micro-optimisation, it is the whole correctness of the
  // dialog: almost every caller passes an inline arrow
  // (`onClose={() => !pending && close()}`), so its identity changes on every
  // render. With `onClose` in the deps, one keystroke in a field re-ran the
  // effect — cleanup restored focus out of the input, the body then focused
  // the first focusable in the panel — and a GM could type exactly one
  // character into the adjudication panel before focus jumped to the header.
  // If a lint rule ever asks you to add `onClose` back to line 92, don't.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;

    // Remember who had focus so it can go back there on close. Without this a
    // dialog opened from a table row dumps focus at the top of the document.
    restoreTo.current = document.activeElement;

    const token = {};
    openModals.push(token);

    const panel = panelRef.current;
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // Focus the first thing worth typing into, falling back to the panel so the
    // ring is never left behind on the page underneath. The header is skipped
    // on purpose: `actions` is a jump link, never what you opened the dialog
    // to fill in, and Tooltip wraps its content in a `tabIndex={0}` span that
    // would otherwise win the querySelector and pop its tooltip open.
    const candidates = [...(panel?.querySelectorAll(FOCUSABLE) ?? [])];
    // A caller can mark the one field it actually wants focus to land on
    // (`data-autofocus`) — otherwise the fallback below picks the first
    // focusable, which in a composer with prefilled chips is often a chip
    // whose click handler REMOVES it. Space or Enter right after opening
    // would silently drop it.
    const named = candidates.find((el) => el.hasAttribute("data-autofocus"));
    const initial = named ?? candidates.find((el) => !el.closest(".modal-header")) ?? candidates[0];
    (initial ?? panel)?.focus?.();

    const onKey = (e) => {
      if (e.key === "Escape") {
        // Only the topmost modal (by mount order, not DOM order) reacts —
        // otherwise one Escape closes a confirm dialog AND the panel it's
        // confirming over.
        if (openModals[openModals.length - 1] !== token) return;
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab" || !panel) return;

      // Trap: Tab off either end wraps to the other, so focus cannot walk out
      // of the dialog into the page it is covering.
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = openModals.indexOf(token);
      if (i !== -1) openModals.splice(i, 1);
      restoreTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !pressedBackdrop.current) return;
        pressedBackdrop.current = false;
        onClose?.();
      }}
    >
      <div
        ref={panelRef}
        className={panelClassName}
        data-width={width}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? headingId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className={`modal-header${actions ? " flex items-center justify-between gap-3" : ""}`}>
            {/* .section-title, not .panel-header: the heading sits beside
                something else here, so panel-header's border-bottom would
                underline just the text rather than span the panel. Four
                bespoke modals had this wrong. */}
            <h2 className="section-title" id={headingId}>
              {title}
            </h2>
            {actions}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
