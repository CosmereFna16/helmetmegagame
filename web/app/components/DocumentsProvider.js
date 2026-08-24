"use client";

import { createContext, useContext, useEffect, useState } from "react";

const DocumentsContext = createContext({ docsByKey: new Map() });

export function useDocuments() {
  return useContext(DocumentsContext);
}

// Fetches the document index once per page load so {document:key} references
// (see RichText.js) resolve anywhere in the tree without prop-threading —
// the same shape as TagsProvider.
//
// Global rather than scoped to /documents on purpose: a {document:…} written
// in a tag's description surfaces inside a TagChip tooltip, which can appear
// on almost any page.
//
// The index carries names for everything but bodies for nothing — see
// /api/documents for what is withheld and why.
export default function DocumentsProvider({ children }) {
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/documents")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setDocs(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const docsByKey = new Map(docs.map((d) => [d.key, d]));

  return <DocumentsContext.Provider value={{ docsByKey }}>{children}</DocumentsContext.Provider>;
}
