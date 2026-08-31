"use client";

import useGatedRefreshPoll from "@/app/components/useGatedRefreshPoll";
import useReloadTelemetry from "@/app/components/useReloadTelemetry";

const REFRESH_MS = 30_000;

// Live inbox refresh — the same shared gated poll the adjudication desk
// runs (useGatedRefreshPoll.js): skipped while the tab is hidden, a modal is
// open, or anything has unsaved edits, and version-gated so a refresh never
// crosses a deploy boundary (that's a full browser navigation, and this
// desk's poll firing right after an inbound DM landed is exactly why "the
// page reloads whenever we receive a message"). Also hosts the temporary
// reload telemetry for this desk — see useReloadTelemetry.js.
export default function InboxPoller({ deployVersion }) {
  useGatedRefreshPoll(REFRESH_MS, deployVersion);
  useReloadTelemetry("players", deployVersion);
  return null;
}
