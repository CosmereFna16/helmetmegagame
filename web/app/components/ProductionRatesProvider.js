"use client";

import { createContext, useContext, useEffect, useState } from "react";

const ProductionRatesContext = createContext({ rates: {}, hunting: {}, coefficient: 1 });

export function useProductionRates() {
  return useContext(ProductionRatesContext);
}

// Fetches the live-computed production rates once per page load and makes
// them available anywhere in the tree via context, so {resource:field:tier}
// references (see RichText.js) can resolve without every component
// threading rate data through props. Mirrors TagsProvider.js.
export default function ProductionRatesProvider({ children }) {
  const [data, setData] = useState({ rates: {}, hunting: {}, coefficient: 1 });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/production-rates")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return <ProductionRatesContext.Provider value={data}>{children}</ProductionRatesContext.Provider>;
}
