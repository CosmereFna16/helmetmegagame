"use client";

import { useEffect, useState, useTransition } from "react";
import FormError from "@/app/components/FormError";
import GmAvatar from "@/app/components/GmAvatar";
import useSubmitOnEnter from "@/app/components/useSubmitOnEnter";
import { listGmNotes, addGmNote, deleteGmNote } from "./actions";

// What a GM knows about a player that isn't anywhere else: what they're
// scheming, what they're owed, what they were promised three turns ago.
//
// Append-only and attributed rather than one shared textarea — five GMs
// editing a single field race each other and the loser's paragraph vanishes
// without a trace of who ate it. You can delete your own; you cannot delete
// anyone else's.
export default function NotesTab({ characterId, gmProfiles, myDiscordUserId }) {
  const [notes, setNotes] = useState(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // setNotes lands after the await, never synchronously in the effect body
  // (react-hooks/set-state-in-effect is an error in this repo).
  useEffect(() => {
    if (!characterId) return undefined;
    let cancelled = false;
    (async () => {
      const res = await listGmNotes({ characterId });
      if (cancelled) return;
      if (res?.ok) setNotes(res.notes);
      else setError(res?.error ?? "Couldn't load notes.");
    })();
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  function submit(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setError(null);
    startTransition(async () => {
      const res = await addGmNote({ characterId, content });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotes((prev) => [res.note, ...(prev ?? [])]);
      setDraft("");
    });
  }

  function remove(noteId) {
    startTransition(async () => {
      const res = await deleteGmNote({ noteId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotes((prev) => (prev ?? []).filter((n) => n.id !== noteId));
    });
  }

  const onKeyDown = useSubmitOnEnter();

  return (
    <div className="flex flex-col gap-3 p-3">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="field">
          <span className="sr-only">Add a note</span>
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="What should the next GM know?"
          />
        </label>
        <button type="submit" className="btn self-start" disabled={pending || !draft.trim()}>
          {pending ? "Saving…" : "Add note"}
        </button>
      </form>

      <FormError>{error}</FormError>

      {notes === null && <p className="text-sm text-muted">Loading…</p>}
      {notes?.length === 0 && <p className="text-sm text-muted">No notes on this player yet.</p>}

      {notes?.map((n) => (
        <div key={n.id} className="panel flex flex-col gap-1 p-3">
          <p className="text-sm whitespace-pre-wrap">{n.content}</p>
          <div className="flex items-center gap-2">
            <GmAvatar profile={gmProfiles?.[n.authorDiscordUserId]} size={16} />
            <span className="text-xs text-muted mono">
              {new Date(n.createdAt).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {n.authorDiscordUserId === myDiscordUserId && (
              <button
                type="button"
                className="btn-quiet ml-auto"
                disabled={pending}
                onClick={() => remove(n.id)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
