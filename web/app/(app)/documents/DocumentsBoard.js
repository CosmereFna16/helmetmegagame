"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Modal from "@/app/components/Modal";
import DocumentMarkdown from "../../components/DocumentMarkdown";
import ChipText from "../../components/ChipText";

// One card in the pinned board. Collapsed it shows its title, its source and
// a few lines of the text bleeding out under a fade; clicking opens the full
// sheet. The fade is a mask rather than a gradient overlay so it works on
// both themes without knowing the surface colour behind it.
function DocumentCard({ doc, onOpen }) {
  return (
    <button
      type="button"
      className={doc.pinned ? "doc-card doc-card--pinned" : "doc-card"}
      onClick={() => onOpen(doc)}
    >
      <span className="doc-card-source">
        {doc.pinned && <span aria-hidden="true">⌗ </span>}
        {doc.source}
      </span>
      <span className="doc-card-title">{doc.name}</span>
      {/* ChipText, not DocumentMarkdown: the card is a <button>, so a
          {tag:…} here has to be a plain label rather than a focusable chip,
          and Markdown's own <a>/<table> aren't legal inside one either.
          doc.previewText (see lib/documentPreview.js) is already flattened
          to plain prose server-side. The open sheet below is free to use
          the real thing. */}
      <ChipText text={doc.previewText} className="doc-card-body" />
    </button>
  );
}

function DocumentSheet({ doc, onClose }) {
  return (
    <Modal panelClassName="doc-sheet" onClose={onClose}>
      <div className="doc-sheet-head">
        <div>
          <p className="doc-card-source">{doc.source}</p>
          <h2 className="section-title">{doc.name}</h2>
        </div>
        <button type="button" className="btn-quiet" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="doc-sheet-body">
        <DocumentMarkdown text={doc.description} />
      </div>
    </Modal>
  );
}

export default function DocumentsBoard({
  publicDocs,
  assignedDocs,
  gmDocs = [],
  secretDocs = [],
  hasCharacter,
}) {
  // Without a character there is no ASSIGNED tab at all, so PUBLIC is the
  // only thing to land on. GAMEMASTER only exists when the server sent GM
  // papers, which it only does for an actual GM — the tab is never a hint
  // that something is being withheld.
  const router = useRouter();
  const params = useSearchParams();

  // ?doc=<key> opens that sheet on load, so a {document:key} chip elsewhere
  // in the app has somewhere to point and a document can be linked to
  // directly. Resolved against the lists the server already sent, so an
  // unreadable key simply does nothing rather than revealing that it exists.
  //
  // Both bits of state are seeded in their useState initialisers rather than
  // synced from an effect: react-hooks/set-state-in-effect is an error in
  // this repo, and the effect version would flash the board before the sheet.
  const requested = params.get("doc");
  const found =
    (requested && [
      ["assigned", assignedDocs],
      ["public", publicDocs],
      ["gamemaster", gmDocs],
      ["secret", secretDocs],
    ].map(([name, list]) => [name, list.find((d) => d.key === requested)])
      .find(([, doc]) => doc)) ||
    null;

  const [tab, setTab] = useState(found ? found[0] : hasCharacter ? "assigned" : "public");
  const [open, setOpen] = useState(found ? found[1] : null);

  // Drop the param on close so a refresh lands on the board rather than
  // reopening what you just dismissed. replace, not push, so Back leaves
  // /documents instead of stepping through the sheet again.
  const close = () => {
    setOpen(null);
    if (requested) router.replace("/documents");
  };

  const docs =
    tab === "assigned" ? assignedDocs
      : tab === "gamemaster" ? gmDocs
        : tab === "secret" ? secretDocs
          : publicDocs;

  return (
    <div className="flex flex-col gap-4">
      <div className="tab-bar">
        {hasCharacter && (
          <button
            type="button"
            className="tab-item"
            data-active={tab === "assigned"}
            onClick={() => setTab("assigned")}
          >
            Assigned ({assignedDocs.length})
          </button>
        )}
        <button
          type="button"
          className="tab-item"
          data-active={tab === "public"}
          onClick={() => setTab("public")}
        >
          Public ({publicDocs.length})
        </button>
        {gmDocs.length > 0 && (
          <button
            type="button"
            className="tab-item"
            data-active={tab === "gamemaster"}
            onClick={() => setTab("gamemaster")}
          >
            Gamemaster ({gmDocs.length})
          </button>
        )}
        {secretDocs.length > 0 && (
          <button
            type="button"
            className="tab-item"
            data-active={tab === "secret"}
            onClick={() => setTab("secret")}
          >
            Secret ({secretDocs.length})
          </button>
        )}
      </div>

      {docs.length === 0 ? (
        <p className="panel p-4 empty-state">
          {tab === "assigned"
            ? "Nothing has been handed to you yet. Your role, your tags and your faction each bring their own papers."
            : tab === "gamemaster"
              ? "No gamemaster papers have been written yet."
              : tab === "secret"
                ? "No secret documents have been written yet."
                : "No public documents have been posted yet."}
        </p>
      ) : (
        <div className="doc-board">
          {docs.map((d) => (
            <DocumentCard key={d.key} doc={d} onOpen={setOpen} />
          ))}
        </div>
      )}

      {open && <DocumentSheet doc={open} onClose={close} />}
    </div>
  );
}
