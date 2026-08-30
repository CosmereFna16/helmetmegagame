"use client";

import { createContext, useCallback, useContext, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";

const RefreshContext = createContext(null);

// router.refresh() outside a transition drops React straight to the route's
// loading.js fallback for the length of the refetch — on a desk with a
// full-viewport skeleton (gm/turns, gm/audit) that's a visible blackout every
// time something is staged, resolved, or a background poll ticks. Wrapping
// the same call in a transition keeps the current tree mounted and lets
// React swap in the new data when it's ready instead.
//
// The transition has to be OWNED by something that outlives the refresh, and
// that is the whole reason this is a provider rather than a plain hook. A
// component that owns its own transition and is then removed BY that refresh
// — a modal that closes itself in the same handler, a staged row whose delete
// is what's being refreshed — unmounts the transition's owner mid-flight, the
// fallback comes back, and the route's whole client tree remounts. On
// /gm/turns that meant the adjudication desk blinked through its skeleton and
// came back having lost the GM's lens, filters, scroll position, inspector
// and tray state, since Workspace restores only `selected` (from the URL).
//
// RefreshProvider is mounted in the root layout, above every loading.js
// boundary in the app, so no caller can orphan the transition no matter where
// it sits or how quickly it unmounts itself.
export function RefreshProvider({ children }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);
  const value = useMemo(() => [refresh, refreshing], [refresh, refreshing]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

// Returns [refresh, refreshing]. Prefers the shared provider's transition;
// the local one is only a fallback for a tree mounted outside the provider.
export function useRefresh() {
  const shared = useContext(RefreshContext);
  const router = useRouter();
  const [localRefreshing, startTransition] = useTransition();
  const localRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);
  const local = useMemo(() => [localRefresh, localRefreshing], [localRefresh, localRefreshing]);
  return shared ?? local;
}
