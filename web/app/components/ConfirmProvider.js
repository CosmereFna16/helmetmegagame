"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

import Modal from "./Modal";

const ConfirmContext = createContext(null);

// Promise-based confirm dialog usable from any client component:
//   const confirm = useConfirm();
//   if (!(await confirm({ title: "Delete this?", message: "This can't be undone." }))) return;
// Renders one shared modal here instead of every caller rolling its own
// modal-overlay/modal-panel markup.
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}

export default function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({
        title: options.title ?? "Are you sure?",
        message: options.message ?? "",
        confirmLabel: options.confirmLabel ?? "Confirm",
        cancelLabel: options.cancelLabel ?? "Cancel",
      });
    });
  }, []);

  const settle = useCallback((result) => {
    resolver.current?.(result);
    resolver.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title} width="narrow" onClose={() => settle(false)}>
          {state.message && (
            <p className="mt-3 text-sm text-muted">
              {state.message}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn-quiet" onClick={() => settle(false)}>
              {state.cancelLabel}
            </button>
            <button type="button" className="btn" onClick={() => settle(true)}>
              {state.confirmLabel}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
