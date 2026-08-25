"use client";

// Catches anything thrown while rendering a page under (app), keeping the nav
// rail alive so a player can walk away from a broken route instead of hitting
// the back button.
//
// The app had no error boundary of any kind before this, so a bad query string
// — /archive?kind=anything, a garbage date on /gm/audit — took the whole route
// to Next's raw digest screen.
//
// Next 16 names the recovery prop `retry`, not `reset`.

import ErrorPanel from "@/app/components/ErrorPanel";

export default function AppError({ error, retry }) {
  return <ErrorPanel error={error} retry={retry} />;
}
