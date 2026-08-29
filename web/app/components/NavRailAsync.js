"use client";

import { use } from "react";
import NavRail from "./NavRail";
import InboxChime from "./InboxChime";

// Reads a still-pending nav-items promise via use() inside the Suspense
// boundary in AppLayout, so the shell can paint immediately while the GM
// session check and Mortus-tag lookup stream in behind it. NavRail itself
// stays a plain, synchronous component with no changes.
//
// InboxChime is mounted here rather than in NavRail so it only exists once
// the real unread count has resolved — mounting it against AppRail's
// fallback (badge-less GM_NAV) would seed 0 and chime on every page load.
export default function NavRailAsync({ itemsPromise }) {
  const items = use(itemsPromise);
  const unread = items.find((item) => item.href === "/gm/players")?.badge ?? 0;
  return (
    <>
      <NavRail items={items} />
      <InboxChime count={unread} />
    </>
  );
}
