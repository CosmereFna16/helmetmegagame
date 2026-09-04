"use client";

import { createContext, useContext, useEffect, useState } from "react";

const CarryContext = createContext({ base: null, lines: {} });

export function useCarryReference() {
  return useContext(CarryContext);
}

// Makes the live carry caps available anywhere in the tree, so a
// {carry:slug} token in a tag description (see RichText.js) can say exactly
// what Pack Mule or Cart adds under the CURRENT GameConfig. Mirrors
// ProductionRatesProvider.js — the promise streams from the root layout.
export default function CarryProvider({ children, carryPromise }) {
  const [data, setData] = useState({ base: null, lines: {} });

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(carryPromise)
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [carryPromise]);

  return <CarryContext.Provider value={data}>{children}</CarryContext.Provider>;
}
