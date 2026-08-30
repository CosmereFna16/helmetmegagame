"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Modal from "@/app/components/Modal";
import CheckField from "@/app/components/CheckField";
import FormError from "@/app/components/FormError";
import RichText from "@/app/components/RichText";
import CharacterAvatar from "@/app/components/CharacterAvatar";
import useDirtyGuard from "@/app/components/useDirtyGuard";
import { JOURNAL_TITLE_MAX_LENGTH, JOURNAL_BODY_MAX_LENGTH, JOURNAL_MAX_LABELS } from "@/lib/constants";
import { createEntry, updateEntry } from "./journalActions";
import { findMentionQuery, rankRoster, insertMention } from "./mention";

// Only ever mounted while the modal is actually open — see the shell below.
// That means every `useState` here initializes fresh on each open, exactly
// the pattern RequestDialog.js already uses ("the shell only mounts its body
// while open, so fields reset between openings for free — no effect syncing
// state to the open flag"). No key trick, no reset effect, nothing that
// could trip react-hooks/set-state-in-effect.
export default function JournalComposer({ open, ...props }) {
  if (!open) return null;
  return <JournalComposerBody {...props} />;
}

function JournalComposerBody({ entry, roster, currentTurnNumber, onClose }) {
  const isEditing = Boolean(entry?.id);

  const [title, setTitle] = useState(entry?.title ?? "");
  const [value, setValue] = useState(entry?.body ?? "");
  const [labels, setLabels] = useState(entry?.labels ?? []);
  const [labelDraft, setLabelDraft] = useState("");
  const [pinned, setPinned] = useState(entry?.pinned ?? false);
  const [error, setError] = useState(null);
  const [pending, startTransition] = useTransition();

  // Mention menu state. `caret`/`cursor`/`focused`/`dismissedStart` are the
  // only pieces actually stored — everything else (the active query, the
  // ranked matches, whether the menu is open) is DERIVED from them on every
  // render rather than kept in sync by an effect, which is what keeps this
  // free of react-hooks/set-state-in-effect and of the drift bugs that come
  // from storing something you could recompute.
  const [caret, setCaret] = useState(value.length);
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const [dismissedStart, setDismissedStart] = useState(null);
  const taRef = useRef(null);
  const pendingCaret = useRef(null);

  const { markDirty, guardedClose } = useDirtyGuard();

  const active = useMemo(() => findMentionQuery(value, caret), [value, caret]);
  const matches = useMemo(() => (active ? rankRoster(roster, active.query) : []), [roster, active]);
  const menuOpen = focused && Boolean(active) && matches.length > 0 && dismissedStart !== active.start;
  const idx = matches.length ? Math.min(cursor, matches.length - 1) : 0;

  // Restores the caret after an insertion. Must be a layout effect: setting
  // selectionRange in the click/keydown handler itself does nothing, because
  // React hasn't yet written the new `value` into the DOM node at that point
  // — the browser would just park the caret at the end once it does. No dep
  // array; the ref guard makes every other commit a no-op, so this only ever
  // fires right after `insert()` sets `pendingCaret.current`.
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el || pendingCaret.current == null) return;
    el.focus();
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  function handleChange(e) {
    const next = e.target.value;
    const nextCaret = e.target.selectionStart;
    setValue(next);
    setCaret(nextCaret);
    setCursor(0);
    markDirty();
    // An Escape dismissal only survives while the caret stays inside that
    // same @-run; move off it (or start a new one) and the menu can reopen.
    const a = findMentionQuery(next, nextCaret);
    if (!a || a.start !== dismissedStart) setDismissedStart(null);
  }

  function insert(character) {
    const el = taRef.current;
    // Recomputed straight from the live DOM node rather than trusted from
    // render-time state — the mousedown that picked this row happens after
    // whatever the last render saw, and el.value/el.selectionStart are the
    // only values guaranteed current at the moment of the click.
    const a = el ? findMentionQuery(el.value, el.selectionStart) : active;
    if (!a || !character) return;
    const next = insertMention(el ? el.value : value, a, character);
    setValue(next.text);
    setCaret(next.caret);
    setCursor(0);
    setDismissedStart(null);
    markDirty();
    pendingCaret.current = next.caret;
  }

  function onKeyDown(e) {
    if (!menuOpen) return; // menu closed: let Modal's own Escape/Tab handling run
    if (e.nativeEvent.isComposing) return; // IME candidate commit, not ours
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.min(idx + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(idx - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      // stopPropagation is load-bearing, not defensive: Modal.js binds its
      // own Escape/Tab handling on `window`, which still runs after
      // preventDefault() alone. Without this, Enter/Tab here would ALSO
      // trigger Modal's focus-trap wrap, and Escape below would ALSO close
      // the whole composer (tripping the dirty-guard's discard prompt) —
      // both confirmed against Modal.js's window-level keydown listener.
      e.preventDefault();
      e.stopPropagation();
      insert(matches[idx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissedStart(active.start);
    }
  }

  function addLabel() {
    const label = labelDraft.trim();
    if (!label || labels.length >= JOURNAL_MAX_LABELS) return;
    if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) {
      setLabels((prev) => [...prev, label]);
      markDirty();
    }
    setLabelDraft("");
  }

  function removeLabel(label) {
    setLabels((prev) => prev.filter((l) => l !== label));
    markDirty();
  }

  function submit(e) {
    e.preventDefault();
    setError(null);
    const fields = {
      title,
      body: value,
      labels,
      pinned,
      turnNumber: isEditing ? entry.turnNumber : currentTurnNumber,
    };
    startTransition(async () => {
      const res = isEditing ? await updateEntry(entry.id, fields) : await createEntry(fields);
      if (!res?.ok) {
        setError(res?.error ?? "Something went wrong.");
        return;
      }
      onClose();
    });
  }

  return (
    <Modal
      title={isEditing ? "Edit entry" : "New entry"}
      onClose={() => !pending && guardedClose(onClose)}
    >
      <form className="mt-3 flex flex-col gap-3" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Title</span>
          <input
            value={title}
            maxLength={JOURNAL_TITLE_MAX_LENGTH}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            data-autofocus
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Entry</span>
          <div className="relative">
            <textarea
              ref={taRef}
              rows={6}
              value={value}
              maxLength={JOURNAL_BODY_MAX_LENGTH}
              onChange={handleChange}
              onSelect={(e) => setCaret(e.target.selectionStart)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              placeholder="Write here. Type @ to mention a character."
              required
            />
            {menuOpen && (
              <div className="mention-menu" role="listbox">
                {matches.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    className="mention-row"
                    role="option"
                    aria-selected={i === idx}
                    data-active={i === idx ? "true" : "false"}
                    // mousedown, not click — this fires BEFORE the textarea's
                    // blur, so focus never leaves it and there is no
                    // blur-vs-click race to lose the selection to.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insert(c);
                    }}
                    onMouseEnter={() => setCursor(i)}
                  >
                    <CharacterAvatar characterId={c.id} name={c.name} version={c.updatedAt} size={18} />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        {value.includes("{char:") && (
          <div className="panel p-3 text-sm">
            <RichText text={value} />
          </div>
        )}

        <label className="field">
          <span className="field-label">Labels</span>
          <div className="flex flex-wrap items-center gap-2">
            {labels.map((label) => (
              <span key={label} className="chip">
                {label}
                <button
                  type="button"
                  className="btn-quiet"
                  style={{ padding: 0 }}
                  aria-label={`Remove label ${label}`}
                  onClick={() => removeLabel(label)}
                >
                  ×
                </button>
              </span>
            ))}
            {labels.length < JOURNAL_MAX_LABELS && (
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addLabel();
                  }
                }}
                onBlur={addLabel}
                placeholder="Add a label…"
                style={{ minWidth: "8rem", flex: "1 1 8rem" }}
              />
            )}
          </div>
        </label>

        <CheckField
          checked={pinned}
          onChange={(e) => {
            setPinned(e.target.checked);
            markDirty();
          }}
        >
          Pin to top
        </CheckField>

        <FormError>{error}</FormError>

        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={() => guardedClose(onClose)} disabled={pending}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
