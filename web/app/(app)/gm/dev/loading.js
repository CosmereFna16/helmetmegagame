import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage title="Loading…" panels={[[55, 80], [55, 90], [60, 100, 70]]} />;
}
