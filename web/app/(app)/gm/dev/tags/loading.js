import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="wide" title panels={[[40], [80, 90, 70, 85]]} />;
}
