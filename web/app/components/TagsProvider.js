"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

const TagsContext = createContext({ tagsById: new Map(), tagsBySlug: new Map() });

export function useTags() {
  return useContext(TagsContext);
}

// Makes the caller-visible tag list available anywhere in the tree via
// context, so {tag:id}/{tag:slug} references (see RichText.js) can resolve
// without every component threading tag data through props.
//
// `tagsPromise` is created un-awaited in the root layout (see
// web/lib/referenceData.js) and streams in with the initial response, so
// there is no client round trip and first paint is not blocked. Resolved in
// an effect rather than use() on purpose: use() would suspend the whole app
// at the root, and chips rendering a beat late is the better failure.
export default function TagsProvider({ children, tagsPromise }) {
  const [tags, setTags] = useState([]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(tagsPromise)
      .then((data) => {
        if (!cancelled && data) setTags(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tagsPromise]);

  const value = useMemo(
    () => ({
      tagsById: new Map(tags.map((t) => [t.id, t])),
      tagsBySlug: new Map(tags.filter((t) => t.slug).map((t) => [t.slug, t])),
    }),
    [tags],
  );

  return <TagsContext.Provider value={value}>{children}</TagsContext.Provider>;
}
