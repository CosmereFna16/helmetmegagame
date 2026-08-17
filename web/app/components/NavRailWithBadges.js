"use client";

import { use } from "react";
import NavRail from "./NavRail";

// Reads a still-pending badges promise via use() inside the Suspense
// boundary in AppLayout, so the nav shell can paint immediately while the
// GM badge-count queries stream in behind it. NavRail itself stays a plain,
// synchronous component with no changes.
export default function NavRailWithBadges({ items, badgesPromise }) {
  const badges = use(badgesPromise);
  return <NavRail items={items} badges={badges} />;
}
