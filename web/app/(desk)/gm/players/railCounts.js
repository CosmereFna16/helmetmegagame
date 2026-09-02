// The two header numbers, lifted out of layout.js so the header and the rail
// can never disagree about what "unread" and "awaiting" mean. Plain
// functions, no React — the layout counts the server rows with them and
// DeskInboxCounts.js counts the live-merged ones.
export function countInbox(rows) {
  const unread = rows.filter((r) => !r.muted && r.unreadCount > 0).length;
  // Read but still theirs to answer: they wrote last, and it's not sitting in
  // the unread count any more. Same predicate the rail's row mark uses.
  const awaiting = rows.filter(
    (r) => !r.muted && !r.handled && r.unreadCount === 0 && r.lastDirection === "INBOUND",
  ).length;
  return { unread, awaiting };
}
