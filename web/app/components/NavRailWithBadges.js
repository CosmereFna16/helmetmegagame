"use client";

import { use } from "react";
import NavRail from "./NavRail";

// Reads a still-pending nav-data promise via use() inside the Suspense
// boundary in AppLayout, so the shell can paint immediately while the GM
// session check, Mortus-tag lookup, and badge-count queries stream in behind
// it. NavRail itself stays a plain, synchronous component with no changes.
export default function NavRailWithBadges({ navDataPromise }) {
  const { items, badges } = use(navDataPromise);
  return <NavRail items={items} badges={badges} />;
}
