// The client-side merge algebra for staged tag ops, shared by the Dev
// Character Panel and the adjudication composer so both stage with exactly
// the same rules (op shape documented in db/lib/tagOps.js, DEV-PANEL.md §5).
// One staged op per tag (@@unique([characterId, tagId])), so a presence op
// (add/remove) and a modifier patch (equipped/expiry/quantity) must MERGE
// rather than clobber each other. Returns null when the two cancel out,
// which the caller deletes. `opts.stackable` defaults true only for a caller
// with no catalog in hand; every real caller passes it, because it's what
// stops repeated "Add one" clicks from stacking a holds-it-or-doesn't tag.
export function mergeTagOp(existing, incoming, { stackable = true } = {}) {
  const clamp = (op) =>
    op && op.op === "add" && !stackable && op.quantity !== 1 ? { ...op, quantity: 1 } : op;
  if (!existing) return clamp(incoming);

  // Modifiers land on the existing presence op, keeping its op and quantity.
  if (incoming.op === "patch" && existing.op !== "patch") {
    const { op: _drop, tagId: _also, ...modifiers } = incoming;
    void _drop;
    void _also;
    return clamp({ ...existing, ...modifiers });
  }
  // ...and a presence op inherits modifiers already staged.
  if (existing.op === "patch" && incoming.op !== "patch") {
    const { op: _drop, tagId: _also, quantity: _qty, ...modifiers } = existing;
    void _drop;
    void _also;
    void _qty;
    return clamp({ ...modifiers, ...incoming });
  }
  // Exact inverses cancel: granted it, then thought better of it.
  if (
    (existing.op === "add" && incoming.op === "remove") ||
    (existing.op === "remove" && incoming.op === "add")
  ) {
    return null;
  }
  // Same presence op twice on a stackable: accumulate, so clicking "Add one"
  // three times stages three rather than silently staying at one. A null
  // quantity means "the whole holding" and swallows any number. On a
  // non-stackable tag clamp() below pins the total back to 1 — the accumulate
  // is the whole reason the clamp lives here rather than at the call sites.
  if (existing.op === incoming.op) {
    const both = existing.quantity != null && incoming.quantity != null;
    return clamp({
      ...existing,
      ...incoming,
      quantity: both ? existing.quantity + incoming.quantity : null,
    });
  }
  return clamp(incoming);
}
