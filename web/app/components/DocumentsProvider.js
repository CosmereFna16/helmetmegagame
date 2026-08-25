"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const DocumentsContext = createContext({ docsByKey: new Map() });

export function useDocuments() {
  return useContext(DocumentsContext);
}

// Makes the document index available anywhere in the tree so {document:key}
// references (see RichText.js) resolve without prop-threading — the same
// shape as TagsProvider, promise streamed from the root layout.
//
// Global rather than scoped to /documents on purpose: a {document:…} written
// in a tag's description surfaces inside a TagChip tooltip, which can appear
// on almost any page.
//
// The index carries names for everything but bodies for nothing — see
// getDocumentIndex in web/lib/referenceData.js for what is withheld and why.
export default function DocumentsProvider({ children, docsPromise }) {
  const [docs, setDocs] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(docsPromise)
      .then((data) => {
        if (!cancelled && data) setDocs(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docsPromise]);

  const value = useMemo(() => ({ docsByKey: new Map(docs.map((d) => [d.key, d])) }), [docs]);

  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>;
}
