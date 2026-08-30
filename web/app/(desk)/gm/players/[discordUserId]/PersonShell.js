"use client";

import ConversationPane from "./ConversationPane";

// The person view: the conversation, and only the conversation.
//
// It used to split the pane with DossierColumn and wire that column's
// "Insert into reply" buttons into the composer through a ref, which is the
// only reason it was a client component at all. The dossier is gone — the
// shared inspector (components/InspectorColumn.js, mounted by the desk
// layout's InspectorHost) covers it on both desks now, and the Canon tab
// writes the draft through localStorage (players/dmDraft.js) instead of a ref
// across a tree the two no longer share.
//
// The component stays as the one place that names the person view's layout
// class, so the route's loading.js and this render the same wrapper.
export default function PersonShell(props) {
  return (
    <div className="desk-person">
      <ConversationPane {...props} />
    </div>
  );
}
