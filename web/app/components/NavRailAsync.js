"use client";

import { use } from "react";
import NavRail from "./NavRail";

// Reads a still-pending nav-items promise via use() inside the Suspense
// boundary in AppLayout, so the shell can paint immediately while the GM
// session check and Mortus-tag lookup stream in behind it. NavRail itself
// stays a plain, synchronous component with no changes.
export default function NavRailAsync({ itemsPromise }) {
  return <NavRail items={use(itemsPromise)} />;
}
