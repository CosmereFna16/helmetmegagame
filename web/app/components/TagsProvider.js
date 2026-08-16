"use client";

import { createContext, useContext, useEffect, useState } from "react";

const TagsContext = createContext({ tagsById: new Map(), tagsBySlug: new Map() });

export function useTags() {
  return useContext(TagsContext);
}

// Fetches the full tag list once per page load and makes it available
// anywhere in the tree via context, so {tag:id}/{tag:slug} references (see
// RichText.js) can resolve without every component threading tag data
// through props.
export default function TagsProvider({ children }) {
  const [tags, setTags] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tags")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setTags(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const tagsBySlug = new Map(tags.filter((t) => t.slug).map((t) => [t.slug, t]));

  return <TagsContext.Provider value={{ tagsById, tagsBySlug }}>{children}</TagsContext.Provider>;
}
