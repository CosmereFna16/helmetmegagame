"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/app/components/Modal";
import FormError from "@/app/components/FormError";
import Select from "@/app/components/Select";
import { scoreMatch } from "@/lib/fuzzySearch";
import { GM_MESSAGE_MAX_LENGTH } from "@/lib/constants";
import { sendGmBroadcast } from "./actions";

// Bulk message composer — checkbox chips over every ALIVE character,
// filterable by name/role/faction/zone (same scoreMatch the inbox list
// uses), plus two segment selects that bulk-check a whole Zone or Faction at
// once. Selection stays editable after a segment pick — the select is a
// one-shot "check these" action, not a live filter.
export default function BulkComposer({ characters, onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  const zoneOptions = useMemo(
    () => [...new Set(characters.map((c) => c.zoneName).filter(Boolean))].sort(),
    [characters],
  );
  const factionOptions = useMemo(
    () => [...new Set(characters.map((c) => c.factionName).filter(Boolean))].sort(),
    [characters],
  );

  const rows = useMemo(() => {
    const q = query.trim();
    if (!q) return characters;
    return characters.filter((c) =>
      scoreMatch(q, { name: c.name, role: c.roleTitle, faction: c.factionName, zone: c.zoneName }),
    );
  }, [characters, query]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function checkZone(zoneName) {
    if (!zoneName) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of characters) if (c.zoneName === zoneName) next.add(c.id);
      return next;
    });
  }

  function checkFaction(factionName) {
    if (!factionName) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of characters) if (c.factionName === factionName) next.add(c.id);
      return next;
    });
  }

  const over = message.length > GM_MESSAGE_MAX_LENGTH;
  const canSend = selected.size > 0 && message.trim().length > 0 && !over;

  function submit() {
    if (!canSend) return;
    setError(null);
    startTransition(async () => {
      const res = await sendGmBroadcast({ characterIds: [...selected], message: message.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <Modal title="Message multiple players" onClose={() => !pending && onClose()} width="wide">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="field min-w-0 flex-1">
            <span className="field-label">Filter</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, role, faction, zone…" />
          </label>
          {zoneOptions.length > 0 && (
            <label className="field">
              <span className="field-label">Check zone</span>
              <Select value="" onChange={(e) => checkZone(e.target.value)}>
                <option value="">Pick a zone…</option>
                {zoneOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {factionOptions.length > 0 && (
            <label className="field">
              <span className="field-label">Check faction</span>
              <Select value="" onChange={(e) => checkFaction(e.target.value)}>
                <option value="">Pick a faction…</option>
                {factionOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>

        <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto p-1">
          {rows.map((c) => (
            <label key={c.id} className="chip" data-active={selected.has(c.id) || undefined}>
              <input
                type="checkbox"
                className="sr-only"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              {c.name}
            </label>
          ))}
          {rows.length === 0 && <p className="text-sm text-muted">No characters match.</p>}
        </div>

        <label className="field">
          <span className="field-label">
            Message ({selected.size} recipient{selected.size === 1 ? "" : "s"}, sent from Bascinet)
          </span>
          <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={over ? { color: "var(--danger)" } : { color: "var(--muted)" }}>
            {message.length} / {GM_MESSAGE_MAX_LENGTH}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-quiet" disabled={pending} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn" disabled={pending || !canSend} onClick={submit}>
              {pending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
        <FormError>{error}</FormError>
      </div>
    </Modal>
  );
}
