// The client-side merge algebra for staged tag ops, extracted from the Dev
// Character Panel so the adjudication workspace's effect composer stages ops
// with exactly the same rules. The op shape itself is documented in
// db/lib/tagOps.js (DEV-PANEL.md §5).
//
// One staged op per tag, because @@unique([characterId, tagId]) means one row
// per tag — but "what happens to the row" and "how the row is configured" are
// two different axes, and a GM will touch both.
//
//   presence  — add / remove
//   modifiers — equipped, expiry, quantity (carried by a `patch`)
//
// So a patch MERGES into whatever presence op is already staged rather than
// replacing it, and vice versa. Clobbering either way was a real bug: staging
// "remove this amulet" and then toggling Unequip used to throw the removal
// away, and Apply would only unequip it.
//
// Returns null when the two cancel out, which the caller deletes.
//
// `opts.stackable` is the catalog flag for THIS tag. It defaults to true only
// so a caller with no catalog in hand behaves as before; every real caller
// passes it, because it is what stops two "Add one" clicks summing into a
// stack on a tag that is a holds-it-or-doesn't flag. There is no GM override:
// a GM surface ignores requiredTag, group gates and the budget, but not
// stackable, which is a statement about the shape of the row (TAGS.md §5a).
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
