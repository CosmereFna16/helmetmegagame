"use client";

import { useEffect, useRef } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { applyDelta, getCursorMs } from "./liveInbox";
import { isDeskStale, noteDeskVersion } from "@/app/components/useDeskVersion";
import { playChime } from "@/app/components/chime";
import useChimeMuted from "@/app/components/useChimeMuted";

// The fast path of the player desk: every few seconds, ask
// /api/gm/inbox-delta what changed and fold it into liveInbox.js. It never
// calls router.refresh() — that's InboxPoller's job, every 30s, gated, and
// it stays as the backstop for everything this can't see (another GM's
// claim, staged effects, roster changes). A plain fetch can't reach Next's
// build-mismatch full reload no matter what the server answers.
//
// It keeps polling while the tab is hidden. Browsers already throttle a
// hidden page's timers to about one a minute, and the chime while a GM is
// off in Discord is the single most useful thing this delivers. Coming back
// to the tab fires a tick straight away.
//
// A setTimeout chain rather than setInterval, so ticks can't pile up behind
// a slow request. Errors back off; a version change latches the desk stale
// and stops the loop for good (the chip in the header takes over).
const POLL_MS = 3_000;
const BACKOFF_MS = [6_000, 12_000, 30_000, 60_000];
const FULL_EVERY = 20;
const TIMEOUT_MS = 8_000;

export default function LiveInboxPoller({ deployVersion }) {
  const segment = useSelectedLayoutSegment();
  const [muted] = useChimeMuted();

  // Read at fire time through refs, so a navigation between conversations
  // (or toggling the chime) doesn't tear the loop down and rebuild it.
  const segmentRef = useRef(segment);
  const mutedRef = useRef(muted);
  useEffect(() => {
    segmentRef.current = segment;
    mutedRef.current = muted;
  }, [segment, muted]);

  useEffect(() => {
    let timer = null;
    let inFlight = null;
    let stopped = false;
    let failures = 0;
    let ticks = 0;

    function schedule(ms) {
      if (stopped) return;
      clearTimeout(timer);
      timer = setTimeout(tick, ms);
    }

    async function tick() {
      if (stopped || inFlight) return;
      if (isDeskStale()) return;

      const params = new URLSearchParams();
      const cursor = getCursorMs();
      if (cursor > 0) params.set("since", String(Math.floor(cursor)));
      const open = segmentRef.current;
      if (open) params.set("open", open);
      const firstTick = ticks === 0;
      if (firstTick || ticks % FULL_EVERY === 0) params.set("full", "1");
      ticks += 1;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      inFlight = controller;
      try {
        const res = await fetch(`/api/gm/inbox-delta?${params}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (res.status === 204) {
          // Not a GM any more (or signed out). Nothing to poll for.
          stopped = true;
          return;
        }
        if (!res.ok) throw new Error(`inbox-delta ${res.status}`);
        const data = await res.json();
        if (data.version && data.version !== deployVersion) {
          noteDeskVersion(data.version, deployVersion);
          stopped = true;
          return;
        }
        failures = 0;
        const { inbound } = applyDelta(data, { sinceMs: cursor, announce: !firstTick });
        const hidden = document.visibilityState !== "visible";
        const ring = inbound.some((m) => hidden || m.discordUserId !== segmentRef.current);
        if (ring && !mutedRef.current) playChime();
        schedule(POLL_MS);
      } catch {
        // A switchover blip, a timeout, being offline — all "try again later",
        // never "reload". The cursor stays put so nothing is skipped.
        failures += 1;
        schedule(BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]);
      } finally {
        clearTimeout(timeout);
        inFlight = null;
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") schedule(0);
    }

    document.addEventListener("visibilitychange", onVisible);
    schedule(0);

    return () => {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [deployVersion]);

  return null;
}
