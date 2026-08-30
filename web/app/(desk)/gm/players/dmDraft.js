// The conversation composer's draft lives in localStorage, read through
// useSyncExternalStore (see ConversationPane) — the textarea's value IS the
// store's value, so there is no setState-in-an-effect to seed it.
//
// It is shared here rather than kept private to the pane because the
// inspector's Canon tab writes into it: "Insert into reply" used to be a ref
// handed down from PersonShell, which only worked while the dossier and the
// composer were siblings. The inspector is a column of the desk SHELL now, so
// the two are no longer in the same tree — the store is the wire instead.

export function dmDraftKey(discordUserId) {
  return `messages-draft-${discordUserId}`;
}

export function writeDmDraft(discordUserId, value) {
  if (!discordUserId) return;
  try {
    if (value) window.localStorage.setItem(dmDraftKey(discordUserId), value);
    else window.localStorage.removeItem(dmDraftKey(discordUserId));
    // The storage event doesn't fire in the tab that wrote it — nudge the
    // subscriber manually so the composer updates immediately here too.
    window.dispatchEvent(new Event("storage"));
  } catch {
    /* private window / blocked site data */
  }
}
