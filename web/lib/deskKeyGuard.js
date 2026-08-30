// Shared guard for the adjudication desk's window-level single-key shortcuts
// (QueueRail's j/k/arrows/m/r/c/h, Workspace's Escape). Two things used to be
// missing from the old inline check:
//
// - It allowlisted native form elements by tagName (INPUT/TEXTAREA/SELECT),
//   but `Select` (web/app/components/Select.js) is a custom listbox built on
//   a `<button role="combobox">` — its tagName is "BUTTON", so every one of
//   these shortcuts fired straight through a focused dropdown. Typing "m" in
//   a filter's typeahead flipped the whole rail to the Moves lens.
// - It never checked for a held modifier, so ⌘C to copy selected desk text
//   matched the "c" lens key, and ⌘K for the command palette also walked the
//   rail cursor.
export function isFieldFocused(activeElement) {
  if (!activeElement) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(activeElement.tagName)) return true;
  if (activeElement.isContentEditable) return true;
  return Boolean(activeElement.closest('[role="combobox"], [role="listbox"]'));
}

export function hasModifier(e) {
  return e.metaKey || e.ctrlKey || e.altKey;
}
