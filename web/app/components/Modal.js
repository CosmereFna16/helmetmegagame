"use client";

import { useEffect, useId, useRef } from "react";

// The one modal shell. Every dialog in the app used to hand-roll this: eleven
// copies of the overlay/panel pair, each repeating the same
// onClick={(e) => e.stopPropagation()}, and between them ONE that bound Escape
// (RequestDialog), ONE that set role="dialog" (DocumentsBoard), and none that
// trapped focus. ConfirmProvider — the dialog behind all 15 useConfirm() call
// sites — was not the one with Escape, so Escape did nothing on almost every
// dialog a player or GM could open.
//
// Width is a named size rather than an inline maxWidth. There were six values
// in play (the CSS default plus 24/34/36/40/46rem), which is the same drift
// PageShell's narrow/default/wide already solved for pages.
//
// `panelClassName` exists for exactly one caller: the documents sheet is
// deliberately wider and more generously set than .modal-panel, because it is
// a page of prose rather than a dialog. It still wants the Escape, the focus
// trap and the focus restore, so it swaps the panel class rather than
// re-implementing the shell.
//
// `actions` is the slot for anything belonging beside the title — the Dev
// Panel jump button on the adjudication dialogs — mirroring PageHeader's own
// actions slot rather than inventing a second convention.
//
// `onClose` is called for the backdrop, Escape and the close button alike, so
// a caller that must not close mid-flight (a pending server action) simply
// passes a no-op or guards inside it — the same shape RequestDialog already
// used for its `busy` check.
// Mount order is nesting order; DOM order is NOT — ConfirmProvider mounts
// once in the root layout, so its overlay can sit anywhere in the tree
// relative to whatever dialog it's confirming over. A module-level stack of
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
    const initial = candidates.find((el) => !el.closest(".modal-header")) ?? candidates[0];
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
    <div className="modal-overlay" onClick={() => onClose?.()}>
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
