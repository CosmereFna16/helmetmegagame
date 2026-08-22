"use client";

import { createContext, useContext, useEffect, useState } from "react";

const PartySizeContext = createContext({ playerCount: 100, sizes: {} });

export function usePartySizes() {
  return useContext(PartySizeContext);
}

// Fetches the live-computed Cult party-size thresholds once per page load and
// makes them available anywhere in the tree via context, so {partysize:N}
// references (see RichText.js) can resolve without every component threading
// them through props. Mirrors ProductionRatesProvider.js, which mirrors
// TagsProvider.js.
export default function PartySizeProvider({ children }) {
  const [data, setData] = useState({ playerCount: 100, sizes: {} });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/party-sizes")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return <PartySizeContext.Provider value={data}>{children}</PartySizeContext.Provider>;
}
