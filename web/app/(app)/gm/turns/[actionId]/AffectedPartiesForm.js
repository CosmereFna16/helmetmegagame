"use client";

import { useMemo, useState } from "react";
import { sendGmMessage } from "../../actions";

export default function AffectedPartiesForm({ characters }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());

  const filtered = useMemo(
    () => characters.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())),
    [characters, query],
  );

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={sendGmMessage} className="flex flex-col gap-3" onSubmit={() => setSelected(new Set())}>
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="characterId" value={id} />
      ))}
      <label className="field">
        <span className="field-label">Find character</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name..." />
      </label>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {filtered.map((c) => (
          <label key={c.id} className="chip" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={selected.has(c.id)}
              onChange={() => toggle(c.id)}
              className="mr-1"
            />
            {c.name}
          </label>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Message ({selected.size} selected)</span>
        <textarea name="message" rows={2} required />
      </label>
      <button type="submit" className="btn self-start" disabled={selected.size === 0}>
        Send
      </button>
    </form>
  );
}
