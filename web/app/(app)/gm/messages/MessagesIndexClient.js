"use client";

import { useState } from "react";
import BulkComposer from "./BulkComposer";

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function MessagesIndexClient({ characters, lastBroadcast }) {
  const [composerOpen, setComposerOpen] = useState(false);

  return (
    <div className="inbox-empty flex flex-col items-center gap-4">
      <p className="text-muted">Pick a conversation from the list.</p>
      <button type="button" className="btn" onClick={() => setComposerOpen(true)}>
        Message multiple players…
      </button>

      {lastBroadcast && (
        <div className="panel p-3 text-sm text-muted">
          Last broadcast ({relativeTime(lastBroadcast.sentAt)}): {lastBroadcast.total} sent
          {lastBroadcast.pending
            ? " · delivering…"
            : lastBroadcast.failedCount > 0
              ? ` · ${lastBroadcast.failedCount} failed (${lastBroadcast.failedNames.join(", ")})`
              : " · 0 failed"}
        </div>
      )}

      {composerOpen && <BulkComposer characters={characters} onClose={() => setComposerOpen(false)} />}
    </div>
  );
}
