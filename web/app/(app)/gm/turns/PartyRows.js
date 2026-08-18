"use client";

import { useState } from "react";

let rowId = 0;

export default function PartyRows({ characters, initialRows = 1 }) {
  const [rows, setRows] = useState(() => Array.from({ length: initialRows }, () => ({ id: rowId++ })));

  function addRow() {
    setRows((prev) => [...prev, { id: rowId++ }]);
  }

  function removeRow(id) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.id} className="flex flex-col gap-2 rounded border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <select name="partyCharacterId" defaultValue="" className="flex-1">
              <option value="">Select recipient...</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {rows.length > 1 && (
              <button type="button" className="btn-quiet" onClick={() => removeRow(row.id)}>
                Remove
              </button>
            )}
          </div>
          <textarea name="partyMessage" rows={2} placeholder="Message..." />
        </div>
      ))}
      <button type="button" className="btn-quiet self-start" onClick={addRow}>
        + New Message
      </button>
    </div>
  );
}
