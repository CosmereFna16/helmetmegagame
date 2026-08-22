import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage width="wide" title="Map" panels={[[40, 100, 100, 100, 70], [80, 60, 65]]} />;
}
