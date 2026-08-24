import { SkeletonPage } from "@/app/components/PageShell";

export default function Loading() {
  return <SkeletonPage title="Gamemasters" panels={[[100, 100, 100, 100, 100]]} />;
}
