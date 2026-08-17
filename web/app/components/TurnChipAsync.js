"use client";

import { use } from "react";
import TurnChip from "./TurnChip";

// Reads a still-pending turn promise via use() inside the Suspense boundary
// in AppLayout, so the shell can paint immediately while the turn lookup
// streams in behind it.
export default function TurnChipAsync({ turnPromise }) {
  return <TurnChip turn={use(turnPromise)} />;
}
