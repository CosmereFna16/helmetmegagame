import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="wide" title="Player Handbook" panels={[[70, 100, 100, 90, 60]]} />;
}
