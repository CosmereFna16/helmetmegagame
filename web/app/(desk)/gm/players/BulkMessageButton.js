"use client";

import { useState } from "react";
import BulkComposer from "./BulkComposer";

// The desk-header door to the bulk composer. BulkComposer was a finished
// modal that nothing imported — the only reachable path was the roster tab's
// checkboxes and inline textarea, which is no use to a GM sitting in the
// Inbox lens. That inline path still works; this is the second door.
export default function BulkMessageButton({ characters }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-quiet" onClick={() => setOpen(true)}>
        Bulk message
      </button>
      {open && <BulkComposer characters={characters} onClose={() => setOpen(false)} />}
    </>
  );
}
