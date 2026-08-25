"use client";

import { createContext, useContext, useEffect, useState } from "react";

const ProductionRatesContext = createContext({ rates: {}, coefficient: 1 });

export function useProductionRates() {
  return useContext(ProductionRatesContext);
}

// Makes the live-computed production rates available anywhere in the tree via
// context, so {resource:field:tier} references (see RichText.js) can resolve
// without every component threading rate data through props. Mirrors
// TagsProvider.js — the promise streams from the root layout.
export default function ProductionRatesProvider({ children, ratesPromise }) {
  const [data, setData] = useState({ rates: {}, coefficient: 1 });

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(ratesPromise)
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ratesPromise]);

  return <ProductionRatesContext.Provider value={data}>{children}</ProductionRatesContext.Provider>;
}
