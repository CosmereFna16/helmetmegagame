import { SkeletonBar } from "@/app/components/PageShell";

// Renders inside layout.js's already-painted inbox-shell (the list pane
// doesn't re-suspend on a thread navigation) — so this is just the thread
// pane's own skeleton, not a full page shell.
export default function Loading() {
  return (
    <div className="panel animate-pulse flex flex-col gap-3 p-4">
      <SkeletonBar width="40%" />
      <SkeletonBar width="80%" />
      <SkeletonBar width="55%" />
      <SkeletonBar width="90%" />
      <SkeletonBar width="45%" />
    </div>
  );
}
