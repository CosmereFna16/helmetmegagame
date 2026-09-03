"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";

import useDragPanel from "./useDragPanel";

// The one modal shell every dialog in the app uses — backdrop, Escape,
// focus trap and focus restore all live here once. `panelClassName` lets a
// caller (the documents sheet) widen the panel without losing those.
// `onClose` fires for the backdrop, Escape and the close button alike; a
// caller that must not close mid-flight passes a no-op or guards inside it.
// `modeless` opts a dialog out of being modal at all — no backdrop, no focus
// trap, clicks pass through to the page, and the header drags. That is for the
// GM desks, where the right-hand inspector exists to be browsed while a
// composer is open. A dialog that asks a question needing an answer (every
// useConfirm, Delete character) stays blocking.
// Mount order is nesting order; DOM order is NOT — a module-level stack of
// mount tokens is the only reliable way to know which open Modal is topmost.
const openModals = [];

// Modeless is desktop-only. Below this the desk collapses to one column and a
// floating panel over live content with no dim is worse than a modal, so the
// dialog degrades back to blocking. Read through useSyncExternalStore rather
// than an effect — `react-hooks/set-state-in-effect` is an error here.
const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const readWide = () => window.matchMedia(WIDE).matches;
// The server can't know the viewport. Answering "not wide" means a dialog
// rendered on the server is a plain modal until hydration, which is the safe
// way round: it can only ever get less blocking, never more.
const readWideServer = () => false;

// Shared by every Escape / keyboard-shortcut guard on the desks, which used to
// ask `document.querySelector(".modal-overlay")` and bail. A modeless dialog
// must NOT swallow a keystroke aimed at the page behind it — that page is
// still live, which is the whole point — unless focus is actually inside the
// panel, in which case its own handler has already run.
//
// Deliberately NOT used by useGatedRefreshPoll: a floating composer holding
// unsaved text still has to hold off a router.refresh(), modeless or not.
export function dialogHoldsKeyboard() {
  if (typeof document === "undefined") return false;
  if (document.querySelector('.modal-overlay:not([data-modeless="true"])')) return true;
  return Boolean(document.activeElement?.closest?.(".modal-overlay"));
}

export default function Modal({
  open = true,
  title,
  onClose,
  width = "default",
  labelledBy,
  actions,
  panelClassName = "modal-panel",
  modeless = false,
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
  // Whether focus has since walked OUT of a floating panel. Checking
  // `document.activeElement` in the cleanup can't answer this: by the time a
  // passive effect's destroy runs the panel is already detached and the
  // document has fallen back to <body>, which is exactly why the restore
  // below is unconditional in the first place. So track it live.
  const focusLeft = useRef(false);
  const autoId = useId();
  const headingId = labelledBy ?? `modal-title-${autoId}`;

  const wide = useSyncExternalStore(subscribeWide, readWide, readWideServer);
  const floating = modeless && wide;
  // Read through a ref for the same reason `onClose` is: the keydown effect
  // below must not re-run (and yank focus) when the viewport crosses 1024px
  // mid-edit.
  const floatingRef = useRef(floating);
  useEffect(() => {
    floatingRef.current = floating;
  });

  const { style: dragStyle, handleProps } = useDragPanel({
    enabled: floating,
    panelRef,
  });

  // `onClose` is read through a ref so it can stay OUT of the effect below.
  // This is not a micro-optimisation, it is the whole correctness of the
  // dialog: almost every caller passes an inline arrow
  // (`onClose={() => !pending && close()}`), so its identity changes on every
  // render. With `onClose` in the deps, one keystroke in a field re-ran the
  // effect — cleanup restored focus out of the input, the body then focused
  // the first focusable in the panel — and a GM could type exactly one
  // character into the adjudication panel before focus jumped to the header.
  // If a lint rule ever asks you to add `onClose` back to that effect, don't.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;

    // Remember who had focus so it can go back there on close. Without this a
    // dialog opened from a table row dumps focus at the top of the document.
    restoreTo.current = document.activeElement;

    const panel = panelRef.current;
    const token = { panel };
    openModals.push(token);

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
        // Exactly one open dialog reacts, and which one is decided by focus
        // first, mount order second.
        //
        // Focus first, because a modeless dialog does not own the keyboard: a
        // GM who has clicked out into the inspector and pressed Escape meant
        // it for what they are looking at, not for the composer they were
        // still filling in. Among the dialogs that DO contain focus the
        // innermost wins — Modal renders in-tree, so a dialog opened from
        // inside another is a DOM descendant of it and both would otherwise
        // close on one keypress.
        //
        // With focus in none of them, only a blocking dialog claims the key,
        // topmost by mount order (NOT DOM order — a confirm mounts at the app
        // root while the panel it is confirming over sits deep in a desk).
        const focused = openModals.filter((t) => t.panel?.contains(document.activeElement));
        if (focused.length) {
          if (focused[focused.length - 1] !== token) return;
        } else {
          if (floatingRef.current) return;
          if (openModals[openModals.length - 1] !== token) return;
        }
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      // No Tab trap while floating: walking out of the panel into the page
      // behind it is the whole point.
      if (e.key !== "Tab" || !panel || floatingRef.current) return;

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

    const onFocusIn = (e) => {
      focusLeft.current = !panel?.contains(e.target);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focusin", onFocusIn);
      const i = openModals.indexOf(token);
      if (i !== -1) openModals.splice(i, 1);
      // Only take focus back if the dialog still had it. A floating panel is
      // routinely closed after the GM has clicked away, and dragging focus
      // back out of the inspector then would be the jarring half of a fix
      // meant to keep the inspector usable. A blocking dialog always restores,
      // unchanged — its focus can't have left.
      if (!(floatingRef.current && focusLeft.current)) restoreTo.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      data-modeless={floating ? "true" : undefined}
      onMouseDown={(e) => {
        // There is no backdrop to press while floating — the overlay is
        // transparent and click-through, so anything landing on it went to
        // the page underneath instead.
        pressedBackdrop.current = !floating && e.target === e.currentTarget;
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
        style={dragStyle}
        role="dialog"
        aria-modal={floating ? undefined : "true"}
        aria-labelledby={title ? headingId : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="modal-header" {...(handleProps ?? {})}>
            {/* .section-title, not .panel-header: the heading sits beside
                something else here, so panel-header's border-bottom would
                underline just the text rather than span the panel. Four
                bespoke modals had this wrong. */}
            <h2 className="section-title" id={headingId}>
              {title}
            </h2>
            <div className="modal-header-actions">
              {actions}
              {/* The only exit a phone has. Escape needs a keyboard and the
                  backdrop is down to a 16px gutter once a `widest` panel is on
                  a 390px screen, so before this the Add Tag and Spend Tag
                  Points dialogs were genuinely inescapable there. `onClose`
                  is called straight, not through the ref: callers that must
                  not close mid-flight already guard inside their own handler
                  (`() => !pending && close()`). */}
              {onClose && (
                <button
                  type="button"
                  className="modal-close"
                  onClick={() => onClose()}
                  aria-label="Close"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
