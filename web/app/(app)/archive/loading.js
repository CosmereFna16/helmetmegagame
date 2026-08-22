import { SkeletonPage } from "@/app/components/PageShell";

// Width and title match page.js exactly, so arriving at the Archive doesn't
// re-flow — the whole reason SkeletonPage takes them rather than each skeleton
// picking its own.
export default function Loading() {
  return (
    <SkeletonPage
      width="wide"
      title="Archive"
      panels={[
        [30, 20, 25, 20],
        [45, 90, 80, 60, 85, 70],
      ]}
    />
  );
}
