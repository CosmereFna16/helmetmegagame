"use client";

import { useState } from "react";
import useSessionState from "@/app/components/useSessionState";
import CharacterMentionsProvider from "@/app/components/CharacterMentionsProvider";
import JournalList from "./JournalList";
import StarredList from "./StarredList";
import JournalComposer from "./JournalComposer";

// Constant reference — useSessionState.js requires a STABLE fallback, since
// its snapshot has to stay reference-equal across renders whenever nothing
// has actually changed.
const DEFAULT_TAB = "journal";

// The Journal and Starred tabs never share state: different row shapes,
// different sort keys, different verbs. Keeping two independent
// useTableState instances (one inside each child list) is what keeps this
// page's paging and sorting honest — an interleaved single list was
// considered and rejected during design for exactly that reason.
export default function NotesBoard({ starred, journal, roster, currentTurnNumber }) {
  // Per-tab, not per-entry: which of the two boards is showing. Session-
  // scoped so a mid-deploy hard reload (this repo redeploys several times a
  // day) doesn't silently switch a player back to Journal.
  const [tab, setTab] = useSessionState("notes-tab", DEFAULT_TAB);
  const [composerEntry, setComposerEntry] = useState(null); // null closed, {} new, {...} editing
  const [composerOpen, setComposerOpen] = useState(false);

  function openComposer(entry) {
    setComposerEntry(entry ?? {});
    setComposerOpen(true);
  }

  return (
    <CharacterMentionsProvider characters={roster}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="segmented" role="group" aria-label="Notes view">
            <button type="button" aria-pressed={tab === "journal"} onClick={() => setTab("journal")}>
              Journal
            </button>
            <button type="button" aria-pressed={tab === "starred"} onClick={() => setTab("starred")}>
              Starred
            </button>
          </div>
          {tab === "journal" && (
            <button type="button" className="btn" onClick={() => openComposer(null)}>
              + New entry
            </button>
          )}
        </div>

        {tab === "journal" ? (
          <JournalList entries={journal} onEdit={openComposer} />
        ) : (
          <StarredList notes={starred} />
        )}
      </div>

      <JournalComposer
        open={composerOpen}
        entry={composerEntry}
        roster={roster}
        currentTurnNumber={currentTurnNumber}
        onClose={() => setComposerOpen(false)}
      />
    </CharacterMentionsProvider>
  );
}
