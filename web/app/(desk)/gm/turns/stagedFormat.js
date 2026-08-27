// Human forms of staged rows, shared by the desk, the tray and the preview.
// Pure functions over DTOs — no server imports, safe in client components.

export function tagNameLookup(tagCatalog) {
  return new Map(tagCatalog.map((t) => [t.id, t.name]));
}

// "+3 ⬢ · +Explosion Burns · −Fine Meal ×2"
export function effectSummary(effect, tagNames) {
  const parts = [];
  if (effect.resources) parts.push(`${effect.resources > 0 ? "+" : ""}${effect.resources} ⬢`);
  for (const op of effect.tagOps ?? []) {
    const name = tagNames.get(op.tagId) ?? "a tag";
    const qty = op.quantity != null && op.quantity > 1 ? ` ×${op.quantity}` : "";
    parts.push(`${op.op === "add" ? "+" : "−"}${name}${qty}`);
  }
  return parts.join(" · ") || "nothing";
}

// The one-word state of a staged row, for a status pill.
export function effectState(effect) {
  if (effect.appliedError) return { label: "Errored", tone: "bad" };
  if (effect.applied) return { label: "Applied", tone: "good" };
  if (effect.missed) return { label: "Missed push", tone: "bad" };
  return { label: "Staged", tone: "warn" };
}

export function messageState(message) {
  if (message.sent && message.deliveryFailures) return { label: "Sent, some failed", tone: "bad" };
  if (message.sent) return { label: "Sent", tone: "good" };
  if (message.missed) return { label: "Missed push", tone: "bad" };
  return { label: "Staged", tone: "warn" };
}

export function truncate(text, limit = 120) {
  const clean = (text ?? "").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}
