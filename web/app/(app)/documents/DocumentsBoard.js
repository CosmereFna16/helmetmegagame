"use client";

import { useState } from "react";
import RichText from "../../components/RichText";

// One card in the pinned board. Collapsed it shows its title, its source and
// a few lines of the text bleeding out under a fade; clicking opens the full
// sheet. The fade is a mask rather than a gradient overlay so it works on
// both themes without knowing the surface colour behind it.
function DocumentCard({ doc, onOpen }) {
  return (
    <button type="button" className="doc-card" onClick={() => onOpen(doc)}>
      <span className="doc-card-source">{doc.source}</span>
      <span className="doc-card-title">{doc.name}</span>
      <span className="doc-card-body">
        <RichText text={doc.description} />
      </span>
    </button>
  );
}

function DocumentSheet({ doc, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="doc-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
          {doc.description.split(/\n{2,}/).map((para, i) => (
            <p key={i}>
              <RichText text={para} />
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DocumentsBoard({ publicDocs, assignedDocs, hasCharacter }) {
  // Without a character there is no ASSIGNED tab at all, so PUBLIC is the
  // only thing to land on.
  const [tab, setTab] = useState(hasCharacter ? "assigned" : "public");
  const [open, setOpen] = useState(null);

  const docs = tab === "assigned" ? assignedDocs : publicDocs;

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
      </div>

      {docs.length === 0 ? (
        <p className="panel p-4 text-sm text-muted">
          {tab === "assigned"
            ? "Nothing has been handed to you yet. Your role, your tags and your faction each bring their own papers."
            : "No public documents have been posted yet."}
        </p>
      ) : (
        <div className="doc-board">
          {docs.map((d) => (
            <DocumentCard key={d.key} doc={d} onOpen={setOpen} />
          ))}
        </div>
      )}

      {open && <DocumentSheet doc={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
