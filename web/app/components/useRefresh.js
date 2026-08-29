"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

// router.refresh() outside a transition drops React straight to the route's
// loading.js fallback for the length of the refetch — on a desk with a
// full-viewport skeleton (gm/turns, gm/audit) that's a visible blackout every
// time something is staged, resolved, or a background poll ticks. Wrapping
// the same call in a transition keeps the current tree mounted and lets
// React swap in the new data when it's ready instead. Call this from a
// component that stays mounted across the refresh — a modal that closes
// itself in the same handler unmounts the transition's owner along with it,
// and the fallback comes back.
export function useRefresh() {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);
  return [refresh, refreshing];
}
