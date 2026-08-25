"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { sendGmMessage } from "../actions";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";

export default function MessagesToolbar({ characters }) {
  const router = useRouter();
  const [composerOpen, setComposerOpen] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState("");

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="field">
          <span className="field-label">Jump to conversation</span>
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) router.push(`/gm/messages/${e.target.value}`);
            }}
          >
            <option value="">Select a player...</option>
            {characters.map((c) => (
              <option key={c.discordUserId} value={c.discordUserId}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => setComposerOpen((open) => !open)}>
          {composerOpen ? "Cancel" : "Send message"}
        </button>
      </div>

      {composerOpen && (
        <form
          action={sendGmMessage}
          className="panel flex flex-col gap-3 p-4"
          onSubmit={() => {
            setComposerOpen(false);
            setSelected(new Set());
          }}
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="characterId" value={id} />
          ))}
          <label className="field">
            <span className="field-label">Find player</span>
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
            <textarea name="message" rows={3} required maxLength={GM_MESSAGE_MAX_LENGTH} />
          </label>
          <button type="submit" className="btn self-start" disabled={selected.size === 0}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}
